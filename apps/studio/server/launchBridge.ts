import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { Plugin } from "vite";

export const STUDIO_SESSION_ENDPOINT = "/api/studio-session";
export const DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export interface LaunchBridgeOptions {
  sourcePath: string;
  token: string;
  maxSourceBytes?: number;
}

interface SessionResponse {
  fileName: string;
  sourcePath: string;
  html: string;
  revision: string;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
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

export function createLaunchBridgePlugin(options?: Partial<LaunchBridgeOptions>): Plugin {
  const configuredSource = options?.sourcePath ?? process.env.SLIDES_STUDIO_INITIAL_DECK ?? "";
  const sourcePath = configuredSource ? resolve(configuredSource) : "";
  const token = options?.token ?? process.env.SLIDES_STUDIO_SESSION_TOKEN ?? "";
  const envLimit = Number(process.env.SLIDES_STUDIO_MAX_SOURCE_BYTES);
  const maxSourceBytes = options?.maxSourceBytes ?? (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_MAX_SOURCE_BYTES);

  return {
    name: "slides-studio-launch-bridge",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== STUDIO_SESSION_ENDPOINT) return next();
        if (!sourcePath || !token) return json(res, 404, { error: "No Studio launch session is configured." });
        if (!isLoopbackBrowserRequest(req)) return json(res, 403, { error: "Studio launch bridge accepts only loopback browser requests." });
        if (!tokenMatches(requestToken(req, url), token)) return json(res, 401, { error: "Invalid Studio launch session token." });

        try {
          if (req.method === "GET" || req.method === "HEAD") {
            const payload = await sessionPayload(sourcePath, maxSourceBytes);
            if (req.method === "HEAD") return json(res, 200, { fileName: payload.fileName, sourcePath: payload.sourcePath, revision: payload.revision });
            return json(res, 200, payload);
          }
          if (req.method === "PUT") {
            const raw = await readBody(req, maxSourceBytes + 1024);
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (Object.keys(parsed).length !== 1 || typeof parsed.html !== "string") return json(res, 400, { error: "Save payload must contain only an html string." });
            if (Buffer.byteLength(parsed.html, "utf8") > maxSourceBytes) return json(res, 413, { error: "Studio save payload exceeds the configured size limit." });
            const revision = await atomicSave(sourcePath, parsed.html);
            return json(res, 200, { saved: true, sourcePath, revision });
          }
          res.setHeader("allow", "GET, HEAD, PUT");
          return json(res, 405, { error: "Method not allowed." });
        } catch (error) {
          if (error instanceof RangeError) return json(res, 413, { error: error.message });
          if (error instanceof SyntaxError) return json(res, 400, { error: "Save payload must be valid JSON." });
          return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
