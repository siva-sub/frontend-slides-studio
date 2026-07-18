/**
 * @slides-studio/media-kit — browser file-only descriptor helper.
 *
 * Browser-safe. Accepts a `File`/`Blob`, validates it with the shared sniffer,
 * and emits a self-contained data-URL/blob descriptor with an explicit size
 * warning. Folder staging stays relative: this helper never writes to disk; the
 * Node-only `@slides-studio/media-kit/node` entry performs on-disk staging.
 */

import type { MediaAsset } from "@slides-studio/protocol";
import { validateMediaBytes, type ValidatedMedia } from "./sniff.js";

export interface FileDescriptorOptions {
  /** Declared MIME (e.g. from `file.type`); validated against the sniffed type. */
  declaredMime?: string;
  /** Reject payloads larger than this many bytes. */
  maxBytes?: number;
  /** Reject images whose width*height exceeds this many pixels. */
  maxPixels?: number;
  /** Emit a size warning when the payload exceeds this many bytes. */
  warnBytes?: number;
}

/** Warn when an in-browser descriptor exceeds this size (10 MiB by default). */
export const DEFAULT_WARN_BYTES = 10 * 1024 * 1024;

export interface BrowserWritableFile {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserWritableFile>;
}

export interface BrowserDirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle>;
}

export interface BrowserStagingManifestEntry extends MediaAsset {
  originalPath: string;
  stagedAt: string;
  derived: [];
}

export interface BrowserStagingManifest {
  schemaVersion: 1;
  basePath: "assets/user-media";
  entries: BrowserStagingManifestEntry[];
}

export interface BrowserStageResult {
  path: string;
  entry: BrowserStagingManifestEntry;
  manifest: BrowserStagingManifest;
  deduplicated: boolean;
  warning?: string;
}

export interface FileDescriptor extends ValidatedMedia {
  /** Original file name (Unicode, as supplied). */
  name: string;
  /** `data:` URL embedding the full payload, suitable for `<img src>`. */
  dataUrl: string;
  /** Optional object-URL alternative; populated only when `useObjectUrl` is set. */
  objectUrl?: string;
  /** Present only when the payload exceeds `warnBytes`. */
  warning?: string;
}

function readArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/**
 * Build a descriptor for a browser `File`/`Blob`. Uses `data:` URLs by default
 * so the descriptor is self-contained and survives serialization. Pass
 * `useObjectUrl: true` to use `URL.createObjectURL` instead (caller owns the
 * lifetime of the object URL).
 */
export async function createFileDescriptor(
  blob: Blob,
  name: string,
  options: FileDescriptorOptions & { useObjectUrl?: boolean } = {},
): Promise<FileDescriptor> {
  if (typeof blob === "undefined" || blob === null || typeof blob.arrayBuffer !== "function") {
    throw new TypeError("createFileDescriptor expects a Blob/File");
  }
  const buffer = await readArrayBuffer(blob);
  const bytes = new Uint8Array(buffer);
  // Build validation options without explicit `undefined` so the call satisfies
  // exactOptionalPropertyTypes (optional props do not accept undefined values).
  const validationOptions: { declaredMime?: string; maxBytes?: number; maxPixels?: number } = {};
  if (options.declaredMime !== undefined) validationOptions.declaredMime = options.declaredMime;
  if (options.maxBytes !== undefined) validationOptions.maxBytes = options.maxBytes;
  if (options.maxPixels !== undefined) validationOptions.maxPixels = options.maxPixels;
  const validated = validateMediaBytes(bytes, validationOptions);
  const warnBytes = options.warnBytes ?? DEFAULT_WARN_BYTES;
  const warning = bytes.length > warnBytes
    ? `payload is ${(bytes.length / 1024 / 1024).toFixed(2)} MiB; consider staging via @slides-studio/media-kit/node before embedding`
    : undefined;
  if (options.useObjectUrl && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const objectUrl = URL.createObjectURL(blob);
    const descriptor: FileDescriptor = {
      ...validated,
      name,
      dataUrl: objectUrl,
      objectUrl,
    };
    return warning === undefined ? descriptor : { ...descriptor, warning };
  }
  // Build a base64 data URL. `btoa` over a binary string works in browsers.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = typeof btoa === "function" ? btoa(binary) : BufferCompat.from(binary, "binary").toString("base64");
  const dataUrl = `data:${validated.mime};base64,${base64}`;
  const descriptor: FileDescriptor = {
    ...validated,
    name,
    dataUrl,
  };
  return warning === undefined ? descriptor : { ...descriptor, warning };
}

const MIME_EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

function safeStem(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "media";
  const withoutExtension = base.replace(/\.[^.]+$/, "");
  return withoutExtension.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "media";
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function directoryAt(root: BrowserDirectoryHandle, segments: string[], create: boolean): Promise<BrowserDirectoryHandle> {
  let directory = root;
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create });
  return directory;
}

async function readManifest(root: BrowserDirectoryHandle): Promise<BrowserStagingManifest> {
  try {
    const directory = await directoryAt(root, ["assets", "user-media"], false);
    const file = await (await directory.getFileHandle("manifest.json")).getFile();
    const parsed = JSON.parse(await file.text()) as BrowserStagingManifest;
    if (parsed.schemaVersion !== 1 || parsed.basePath !== "assets/user-media" || !Array.isArray(parsed.entries)) throw new Error("invalid browser staging manifest");
    return parsed;
  } catch (error) {
    if ((error as DOMException)?.name !== "NotFoundError") throw error;
    return { schemaVersion: 1, basePath: "assets/user-media", entries: [] };
  }
}

async function writeFile(root: BrowserDirectoryHandle, relativePath: string, data: Blob | BufferSource | string): Promise<void> {
  const segments = relativePath.split("/");
  const name = segments.pop();
  if (!name) throw new Error("staging target has no file name");
  const directory = await directoryAt(root, segments, true);
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  await writable.write(data);
  await writable.close();
}

/** Stage one validated browser file into a folder workspace with hash dedupe. */
export async function stageBrowserMedia(
  root: BrowserDirectoryHandle,
  blob: Blob,
  name: string,
  options: FileDescriptorOptions & { now?: () => string } = {},
): Promise<BrowserStageResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const validationOptions: { declaredMime?: string; maxBytes?: number; maxPixels?: number } = {};
  if (options.declaredMime !== undefined) validationOptions.declaredMime = options.declaredMime;
  if (options.maxBytes !== undefined) validationOptions.maxBytes = options.maxBytes;
  if (options.maxPixels !== undefined) validationOptions.maxPixels = options.maxPixels;
  const validated = validateMediaBytes(bytes, validationOptions);
  const hash = await digest(bytes);
  const manifest = await readManifest(root);
  const existing = manifest.entries.find((entry) => entry.hash.algorithm === "sha256" && entry.hash.value === hash);
  if (existing) return { path: existing.path, entry: existing, manifest, deduplicated: true };
  const extension = MIME_EXTENSION[validated.mime] ?? ".bin";
  const path = `assets/user-media/${hash.slice(0, 2)}/${safeStem(name)}-${hash.slice(0, 8)}${extension}`;
  await writeFile(root, path, blob);
  const entry: BrowserStagingManifestEntry = {
    schemaVersion: 1,
    id: `media-${hash.slice(0, 16)}`,
    path,
    hash: { algorithm: "sha256", value: hash },
    mimeType: validated.mime,
    ...(validated.width ? { width: validated.width } : {}),
    ...(validated.height ? { height: validated.height } : {}),
    bytes: validated.bytes,
    evidence: [],
    originalPath: path,
    stagedAt: (options.now ?? (() => new Date().toISOString()))(),
    derived: [],
  };
  const nextManifest: BrowserStagingManifest = { ...manifest, entries: [...manifest.entries, entry].toSorted((left, right) => left.path.localeCompare(right.path)) };
  await writeFile(root, "assets/user-media/manifest.json", `${JSON.stringify(nextManifest, null, 2)}\n`);
  const warnBytes = options.warnBytes ?? DEFAULT_WARN_BYTES;
  const warning = bytes.length > warnBytes ? `payload is ${(bytes.length / 1024 / 1024).toFixed(2)} MiB` : undefined;
  return warning ? { path, entry, manifest: nextManifest, deduplicated: false, warning } : { path, entry, manifest: nextManifest, deduplicated: false };
}

// Minimal Buffer shim so base64 encoding works in a non-browser bundler test
// environment without pulling in node:buffer at the type level.
const BufferCompat: { from(data: string, encoding: string): { toString(encoding: string): string } } =
  (globalThis as { Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } } }).Buffer
    ?? { from: () => { throw new Error("btoa and Buffer are both unavailable"); } };
