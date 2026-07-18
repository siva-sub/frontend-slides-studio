/**
 * @slides-studio/media-kit — byte-level MIME sniffing and validation.
 *
 * Browser-safe: works on a `Uint8Array` with no Node dependencies. Detects the
 * real format from magic bytes, rejects MIME spoofing (declared type that does
 * not match the sniffed type), unsafe active SVG, unsupported types, oversized
 * byte/pixel payloads, and reads intrinsic image dimensions where feasible.
 */

import type { Dimensions } from "./geometry.js";

/** Supported sniffable MIME types. */
export const IMAGE_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
} as const;
export const VIDEO_MIME = {
  mp4: "video/mp4",
  webm: "video/webm",
} as const;

export const SUPPORTED_MIME: ReadonlySet<string> = new Set<string>([
  IMAGE_MIME.png,
  IMAGE_MIME.jpeg,
  IMAGE_MIME.gif,
  IMAGE_MIME.webp,
  IMAGE_MIME.avif,
  IMAGE_MIME.svg,
  VIDEO_MIME.mp4,
  VIDEO_MIME.webm,
]);

/** Canonical file extensions used when deriving POSIX names. */
export const MIME_EXTENSION: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 0x1000000) + (((bytes[offset + 1] ?? 0) << 16) >>> 0) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);
}
function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) + (bytes[offset + 1] ?? 0);
}
function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const b = bytes[offset + i];
    if (b === undefined) return out;
    out += String.fromCharCode(b);
  }
  return out;
}

/**
 * Sniff the real MIME type from magic bytes. Returns the canonical MIME string
 * or throws for unrecognized/unsupported payloads.
 */
export function sniffMime(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("sniffMime expects a Uint8Array");
  }
  if (bytes.length === 0) {
    throw new RangeError("cannot sniff an empty byte sequence");
  }
  // PNG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return IMAGE_MIME.png;
  }
  // JPEG
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return IMAGE_MIME.jpeg;
  }
  // GIF
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && ascii(bytes, 0, 6).startsWith("GIF8")) {
    return IMAGE_MIME.gif;
  }
  // RIFF container -> WebP
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return IMAGE_MIME.webp;
  }
  // ISO BMFF container (MP4 / AVIF) via ftyp box
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return IMAGE_MIME.avif;
    if (brand === "mp41" || brand === "mp42" || brand === "isom" || brand === "iso2" || brand === "avc1" || brand === "dash" || brand === "mmp4") {
      return VIDEO_MIME.mp4;
    }
  }
  // EBML -> WebM
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return VIDEO_MIME.webm;
  }
  // SVG (text). Tolerate a leading BOM and stray whitespace before the root.
  const head = ascii(bytes, 0, Math.min(bytes.length, 512)).trimStart().replace(/^\ufeff/, "");
  if ((head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!DOCTYPE svg")) && containsSvgTag(bytes)) {
    return IMAGE_MIME.svg;
  }
  throw new RangeError("unrecognized or unsupported media type (magic bytes did not match a supported format)");
}

function containsSvgTag(bytes: Uint8Array): boolean {
  // Cheap, encoding-tolerant scan for an <svg open tag within the first bytes.
  const limit = Math.min(bytes.length, 65536);
  const text = ascii(bytes, 0, limit);
  return /<svg[\s>]/i.test(text);
}

/**
 * Reject active/unsafe SVG comprehensively: DOCTYPE/entity declarations (XXE),
 * script/foreignObject/style active elements, inline event handlers, dangerous
 * URL schemes (javascript/vbscript/data), external href/xlink:href/src,
 * CSS @import/url(), and resource-bearing <use>/<image> constructs unless they
 * reference a safe internal fragment ("#id"). Throws on the first unsafe
 * construct found.
 */
export function assertSafeSvg(text: string): void {
  if (/<!DOCTYPE/i.test(text)) {
    throw new RangeError("unsafe SVG: DOCTYPE declarations are not allowed");
  }
  if (/<!ENTITY/i.test(text)) {
    throw new RangeError("unsafe SVG: entity declarations are not allowed");
  }
  if (/<script[\s/>]/i.test(text)) {
    throw new RangeError("unsafe SVG: <script> elements are not allowed");
  }
  if (/<foreignObject[\s/>]/i.test(text)) {
    throw new RangeError("unsafe SVG: <foreignObject> is not allowed");
  }
  if (/<style[\s/>]/i.test(text)) {
    throw new RangeError("unsafe SVG: <style> elements are not allowed (CSS import/url)");
  }
  if (/\son[a-z]+\s*=/i.test(text)) {
    throw new RangeError("unsafe SVG: inline event handler attributes are not allowed");
  }
  if (/\b(?:javascript|vbscript|data):/i.test(text)) {
    throw new RangeError("unsafe SVG: javascript/vbscript/data URLs are not allowed");
  }
  if (/@import\b/i.test(text)) {
    throw new RangeError("unsafe SVG: CSS @import is not allowed");
  }
  if (/url\(/i.test(text)) {
    throw new RangeError("unsafe SVG: CSS url() is not allowed");
  }
  // External references via href/xlink:href/src to absolute/protocol/file refs.
  if (/(?:xlink:href|href|src)\s*=\s*["']\s*(?:https?:|file:|\/\/)/i.test(text)) {
    throw new RangeError("unsafe SVG: external references are not allowed");
  }
  // Resource-bearing <use>/<image> constructs: allow only pure internal
  // fragment references ("#id"); reject anything external or scheme-bearing.
  assertSafeResourceElements(text);
}

function assertSafeResourceElements(text: string): void {
  const tagRe = /<(use|image)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(text)) !== null) {
    const tag = match[0];
    const tagName = match[1] ?? "";
    const refRe = /(?:xlink:href|href|src)\s*=\s*(["'])([\s\S]*?)\1/gi;
    let ref: RegExpExecArray | null;
    while ((ref = refRe.exec(tag)) !== null) {
      const value = (ref[2] ?? "").trim();
      if (!value.startsWith("#")) {
        throw new RangeError(`unsafe SVG: <${tagName}> must reference an internal fragment, not "${value}"`);
      }
    }
  }
}

/** Read intrinsic dimensions for an image MIME type, or null when unavailable. */
export function detectImageDimensions(bytes: Uint8Array, mime: string): Dimensions | null {
  switch (mime) {
    case IMAGE_MIME.png:
      return pngDimensions(bytes);
    case IMAGE_MIME.jpeg:
      return jpegDimensions(bytes);
    case IMAGE_MIME.gif:
      return gifDimensions(bytes);
    case IMAGE_MIME.webp:
      return webpDimensions(bytes);
    case IMAGE_MIME.avif:
      return avifDimensions(bytes);
    case IMAGE_MIME.svg:
      return svgDimensions(bytes);
    default:
      return null;
  }
}

function pngDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 24) return null;
  // IHDR follows the 8-byte signature: 4 length + "IHDR" + width(4) + height(4)
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): Dimensions | null {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === undefined) return null;
    i += 2;
    // Standalone markers (no length payload).
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (i + 2 > bytes.length) return null;
    const segmentLength = readUint16BE(bytes, i);
    // SOFn frames carry width/height. After the marker, `i` points at the
    // length field; the SOF payload layout is length(2) + precision(1) +
    // height(2) + width(2), so height is at i+3 and width at i+5.
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > bytes.length) return null;
      const height = readUint16BE(bytes, i + 3);
      const width = readUint16BE(bytes, i + 5);
      return { width, height };
    }
    i += segmentLength;
  }
  return null;
}

function gifDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 10) return null;
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
}

function webpDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 30) return null;
  const form = ascii(bytes, 12, 4);
  if (form === "VP8 " && bytes.length >= 30) {
    return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
  }
  if (form === "VP8L" && bytes.length >= 25) {
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (form === "VP8X" && bytes.length >= 30) {
    return { width: 1 + (readUint24LE(bytes, 24)), height: 1 + (readUint24LE(bytes, 27)) };
  }
  return null;
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16);
}

/** AVIF dimensions live in the ISPE (image spatial extents) property item. */
function avifDimensions(bytes: Uint8Array): Dimensions | null {
  const text = ascii(bytes, 0, Math.min(bytes.length, 1 << 20));
  const idx = text.indexOf("ispe");
  if (idx < 0 || idx * 1 + 20 > bytes.length) return null;
  const offset = idx + 4 + 4; // skip 'ispe' + version/flags full box header
  if (offset + 8 > bytes.length) return null;
  return { width: readUint32BE(bytes, offset), height: readUint32BE(bytes, offset + 4) };
}

function svgDimensions(bytes: Uint8Array): Dimensions | null {
  const text = ascii(bytes, 0, Math.min(bytes.length, 1 << 20));
  const viewBox = /viewBox\s*=\s*["']\s*[\d.\-eE]+\s+[\d.\-eE]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(text);
  if (viewBox && viewBox[1] && viewBox[2]) {
    return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  }
  const w = /\bwidth\s*=\s*["']([\d.]+)/i.exec(text);
  const h = /\bheight\s*=\s*["']([\d.]+)/i.exec(text);
  if (w && h && w[1] && h[1]) {
    return { width: Number(w[1]), height: Number(h[1]) };
  }
  return null;
}

export interface ValidateMediaOptions {
  /** Declared MIME (e.g. from a filename extension or upload header). */
  declaredMime?: string;
  /** Reject payloads larger than this many bytes. */
  maxBytes?: number;
  /** Reject images whose width*height exceeds this many pixels. */
  maxPixels?: number;
}

export interface ValidatedMedia {
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
}

/**
 * Validate raw media bytes: sniff the real type, reject spoofing, enforce byte
 * and pixel caps, and read intrinsic dimensions for image types. Throws on any
 * validation failure.
 */
export function validateMediaBytes(bytes: Uint8Array, options: ValidateMediaOptions = {}): ValidatedMedia {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("validateMediaBytes expects a Uint8Array");
  }
  const maxBytes = options.maxBytes ?? 52_428_800; // 50 MiB default
  if (bytes.length > maxBytes) {
    throw new RangeError(`payload exceeds maxBytes (${bytes.length} > ${maxBytes})`);
  }
  const mime = sniffMime(bytes);
  if (options.declaredMime) {
    const declared = normalizeMime(options.declaredMime);
    if (declared !== mime) {
      throw new RangeError(`MIME spoof rejected: declared "${options.declaredMime}" but bytes are "${mime}"`);
    }
  }
  if (mime === IMAGE_MIME.svg) {
    assertSafeSvg(ascii(bytes, 0, bytes.length));
  }
  let dims: Dimensions | null = null;
  if (mime !== VIDEO_MIME.mp4 && mime !== VIDEO_MIME.webm) {
    dims = detectImageDimensions(bytes, mime);
    if (dims) {
      const maxPixels = options.maxPixels ?? 100_000_000; // 100 MP default
      const pixels = dims.width * dims.height;
      if (!Number.isFinite(pixels) || pixels <= 0 || pixels > maxPixels) {
        throw new RangeError(`image dimensions ${dims.width}x${dims.height} exceed maxPixels (${maxPixels})`);
      }
    }
  }
  return dims ? { mime, bytes: bytes.length, width: dims.width, height: dims.height } : { mime, bytes: bytes.length };
}

/** Normalize a declared MIME for spoof comparison (trim, lowercase, drop params). */
export function normalizeMime(mime: string): string {
  return mime.trim().toLowerCase().split(";")[0]!.trim();
}
