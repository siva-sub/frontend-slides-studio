import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { Plugin } from "vite";

export const STUDIO_SESSION_ENDPOINT = "/api/studio-session";
export const PRESENTATION_SESSIONS_ENDPOINT = "/api/presentation-sessions";
export const PRESENTATION_ASSETS_PREFIX = "/api/presentation-assets";
export const DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_PRESENTATION_ASSET_BYTES = 100 * 1024 * 1024;

export interface LaunchBridgeOptions {
  sourcePath: string;
  token: string;
  maxSourceBytes?: number;
  maxPresentationAssetBytes?: number;
}

interface SessionResponse {
  fileName: string;
  sourcePath: string;
  html: string;
  revision: string;
}

interface PresentationSnapshot {
  id: string;
  sourcePath: string;
  rootPath: string;
  deckId: string;
  revision: string;
  html: string;
  audienceHtml: string;
  audienceToken: string;
  presenterToken: string;
  createdAt: number;
}

const PRESENTATION_EXTENSIONS = new Set([
  ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
  ".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".ogg", ".m4a",
  ".woff", ".woff2", ".ttf", ".otf", ".wasm", ".pdf",
]);

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".wasm": "application/wasm", ".pdf": "application/pdf",
};

const SCRIPT_ELEMENT = /<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi;

export function stripSpeakerNotesFromHtml(html: string): string {
  const sanitized = html.replace(SCRIPT_ELEMENT, (element, attributes: string) => /(?:^|\s)data-speaker-notes(?:\s|=|$)/i.test(attributes) ? "" : element);
  if (/data-speaker-notes/i.test(sanitized)) throw new Error("Audience HTML still contains speaker-note metadata after sanitization.");
  return sanitized;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(`${JSON.stringify(value)}\n`);
}

function loopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isLoopbackBrowserRequest(req: IncomingMessage): boolean {
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (origin) return loopbackUrl(origin);
  const referer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
  return loopbackUrl(referer);
}

function requestToken(req: IncomingMessage, url: URL): string {
  const header = req.headers["x-slides-studio-session"];
  return (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get("token") ?? "";
}

function presentationToken(req: IncomingMessage, url: URL): string {
  const header = req.headers["x-slides-studio-presentation"];
  return (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get("capability") ?? "";
}

function tokenMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > limit) throw new RangeError("Studio save payload exceeds the configured size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function revisionFor(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}

async function sessionPayload(sourcePath: string, maxSourceBytes: number): Promise<SessionResponse> {
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) throw new Error("Configured Studio source is not a regular file.");
  if (sourceStat.size > maxSourceBytes) throw new RangeError("Configured Studio source exceeds the size limit.");
  const html = await readFile(sourcePath, "utf8");
  return { fileName: basename(sourcePath), sourcePath, html, revision: revisionFor(html) };
}

async function atomicSave(sourcePath: string, html: string): Promise<string> {
  const sourceStat = await stat(sourcePath);
  const temporary = join(dirname(sourcePath), `.${basename(sourcePath)}.slides-studio-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, html, { encoding: "utf8", flag: "wx", mode: sourceStat.mode });
    await chmod(temporary, sourceStat.mode);
    await rename(temporary, sourcePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return revisionFor(html);
}

function randomCapability(): string { return randomBytes(32).toString("base64url"); }

async function createPresentationSnapshot(sourcePath: string, maxSourceBytes: number): Promise<PresentationSnapshot> {
  const source = await sessionPayload(sourcePath, maxSourceBytes);
  const resolvedSource = await realpath(sourcePath);
  return {
    id: randomUUID(),
    sourcePath: resolvedSource,
    rootPath: await realpath(dirname(resolvedSource)),
    deckId: `${source.fileName}:${source.revision.slice(0, 12)}`,
    revision: source.revision,
    html: source.html,
    audienceHtml: stripSpeakerNotesFromHtml(source.html),
    audienceToken: randomCapability(),
    presenterToken: randomCapability(),
    createdAt: Date.now(),
  };
}

function presentationRole(snapshot: PresentationSnapshot, capability: string): "audience" | "presenter" | null {
  if (tokenMatches(capability, snapshot.audienceToken)) return "audience";
  if (tokenMatches(capability, snapshot.presenterToken)) return "presenter";
  return null;
}

function roleUrl(role: "audience" | "presenter", snapshot: PresentationSnapshot): string {
  const capability = role === "audience" ? snapshot.audienceToken : snapshot.presenterToken;
  return `/?view=${role}&presentation=${encodeURIComponent(snapshot.id)}&capability=${encodeURIComponent(capability)}`;
}

function presentationBootstrap(snapshot: PresentationSnapshot, role: "audience" | "presenter") {
  const capability = role === "audience" ? snapshot.audienceToken : snapshot.presenterToken;
  return {
    sessionId: snapshot.id,
    deckId: snapshot.deckId,
    revision: snapshot.revision,
    role,
    html: role === "audience" ? snapshot.audienceHtml : snapshot.html,
    assetBaseUrl: `${PRESENTATION_ASSETS_PREFIX}/${encodeURIComponent(snapshot.id)}/${encodeURIComponent(capability)}/`,
    ...(role === "presenter" ? { audienceUrl: roleUrl("audience", snapshot) } : {}),
  };
}

function safeAssetRelativePath(encoded: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(encoded); } catch { return null; }
  if (!decoded || decoded.includes("\0") || decoded.includes("\\") || decoded.startsWith("/") || decoded.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return decoded;
}

async function servePresentationAsset(res: ServerResponse, snapshot: PresentationSnapshot, encodedPath: string, maxBytes: number, head: boolean): Promise<void> {
  const relativePath = safeAssetRelativePath(encodedPath);
  if (!relativePath) return json(res, 400, { error: "Invalid presentation asset path." });
  const extension = extname(relativePath).toLowerCase();
  if (!PRESENTATION_EXTENSIONS.has(extension)) return json(res, 403, { error: "Presentation asset type is not allowed." });
  const candidate = resolve(snapshot.rootPath, relativePath);
  let actual: string;
  try { actual = await realpath(candidate); } catch { return json(res, 404, { error: "Presentation asset was not found." }); }
  if (actual === snapshot.sourcePath || (actual !== snapshot.rootPath && !actual.startsWith(`${snapshot.rootPath}${sep}`))) return json(res, 403, { error: "Presentation asset escapes the configured deck root." });
  const info = await stat(actual);
  if (!info.isFile()) return json(res, 404, { error: "Presentation asset is not a regular file." });
  if (info.size > maxBytes) return json(res, 413, { error: "Presentation asset exceeds the size limit." });
  const body = head ? null : await readFile(actual);
  res.statusCode = 200;
  res.setHeader("content-type", MIME_TYPES[extension] ?? "application/octet-stream");
  res.setHeader("content-length", String(info.size));
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(body);
}

export function createLaunchBridgePlugin(options?: Partial<LaunchBridgeOptions>): Plugin {
  const configuredSource = options?.sourcePath ?? process.env.SLIDES_STUDIO_INITIAL_DECK ?? "";
  const sourcePath = configuredSource ? resolve(configuredSource) : "";
  const token = options?.token ?? process.env.SLIDES_STUDIO_SESSION_TOKEN ?? "";
  const envLimit = Number(process.env.SLIDES_STUDIO_MAX_SOURCE_BYTES);
  const maxSourceBytes = options?.maxSourceBytes ?? (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_MAX_SOURCE_BYTES);
  const envAssetLimit = Number(process.env.SLIDES_STUDIO_MAX_PRESENTATION_ASSET_BYTES);
  const maxPresentationAssetBytes = options?.maxPresentationAssetBytes ?? (Number.isFinite(envAssetLimit) && envAssetLimit > 0 ? envAssetLimit : DEFAULT_MAX_PRESENTATION_ASSET_BYTES);
  const presentations = new Map<string, PresentationSnapshot>();

  return {
    name: "slides-studio-launch-bridge",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const presentationMatch = /^\/api\/presentation-sessions\/([^/]+)$/.exec(url.pathname);
        const assetMatch = /^\/api\/presentation-assets\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
        const knownEndpoint = url.pathname === STUDIO_SESSION_ENDPOINT || url.pathname === PRESENTATION_SESSIONS_ENDPOINT || Boolean(presentationMatch) || Boolean(assetMatch);
        if (!knownEndpoint) return next();
        if (!sourcePath || !token) return json(res, 404, { error: "No Studio launch session is configured." });
        // Sandboxed srcdoc frames have an opaque Origin and may omit Referer on asset requests.
        // The unguessable role capability and contained read-only path remain mandatory below.
        if (!assetMatch && !isLoopbackBrowserRequest(req)) return json(res, 403, { error: "Studio launch bridge accepts only loopback browser requests." });

        try {
          if (url.pathname === STUDIO_SESSION_ENDPOINT) {
            if (!tokenMatches(requestToken(req, url), token)) return json(res, 401, { error: "Invalid Studio launch session token." });
            if (req.method === "GET" || req.method === "HEAD") {
              const payload = await sessionPayload(sourcePath, maxSourceBytes);
              if (req.method === "HEAD") return json(res, 200, { fileName: payload.fileName, sourcePath: payload.sourcePath, revision: payload.revision });
              return json(res, 200, payload);
            }
            if (req.method === "PUT") {
              const raw = await readBody(req, maxSourceBytes + 1024);
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              if (Object.keys(parsed).length !== 1 || typeof parsed.html !== "string") return json(res, 400, { error: "Save payload must contain only an html string." });
              if (Buffer.byteLength(parsed.html, "utf8") > maxSourceBytes) return json(res, 413, { error: "Studio save payload exceeds the size limit." });
              const revision = await atomicSave(sourcePath, parsed.html);
              return json(res, 200, { saved: true, sourcePath, revision });
            }
            res.setHeader("allow", "GET, HEAD, PUT");
            return json(res, 405, { error: "Method not allowed." });
          }

          if (url.pathname === PRESENTATION_SESSIONS_ENDPOINT) {
            if (req.method !== "POST") { res.setHeader("allow", "POST"); return json(res, 405, { error: "Method not allowed." }); }
            if (!tokenMatches(requestToken(req, url), token)) return json(res, 401, { error: "Invalid Studio launch session token." });
            const snapshot = await createPresentationSnapshot(sourcePath, maxSourceBytes);
            presentations.set(snapshot.id, snapshot);
            const ordered = [...presentations.values()].sort((left, right) => right.createdAt - left.createdAt);
            for (const stale of ordered.slice(12)) presentations.delete(stale.id);
            return json(res, 201, { sessionId: snapshot.id, deckId: snapshot.deckId, revision: snapshot.revision, presenterUrl: roleUrl("presenter", snapshot), audienceUrl: roleUrl("audience", snapshot) });
          }

          if (presentationMatch) {
            if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("allow", "GET, HEAD"); return json(res, 405, { error: "Method not allowed." }); }
            const snapshot = presentations.get(decodeURIComponent(presentationMatch[1]!));
            if (!snapshot) return json(res, 404, { error: "Presentation session was not found." });
            const role = presentationRole(snapshot, presentationToken(req, url));
            if (!role) return json(res, 401, { error: "Invalid presentation capability." });
            const payload = presentationBootstrap(snapshot, role);
            return json(res, 200, req.method === "HEAD" ? { sessionId: payload.sessionId, deckId: payload.deckId, revision: payload.revision, role: payload.role } : payload);
          }

          if (assetMatch) {
            if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("allow", "GET, HEAD"); return json(res, 405, { error: "Method not allowed." }); }
            const snapshot = presentations.get(decodeURIComponent(assetMatch[1]!));
            if (!snapshot) return json(res, 404, { error: "Presentation session was not found." });
            const capability = decodeURIComponent(assetMatch[2]!);
            if (!presentationRole(snapshot, capability)) return json(res, 401, { error: "Invalid presentation capability." });
            return await servePresentationAsset(res, snapshot, assetMatch[3]!, maxPresentationAssetBytes, req.method === "HEAD");
          }
        } catch (error) {
          if (error instanceof RangeError) return json(res, 413, { error: error.message });
          if (error instanceof SyntaxError) return json(res, 400, { error: "Request payload must be valid JSON." });
          return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
