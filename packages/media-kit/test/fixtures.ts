/**
 * Shared byte fixtures for media-kit tests. Each helper builds a minimal valid
 * (or header-valid) byte sequence for a supported format so tests never touch a
 * media network/provider and never depend on sample assets.
 */
import { deflateSync, crc32 } from "node:zlib";

/** Build a PNG carrying only the signature + IHDR (no pixel data). Sufficient
 * for sniffing and dimension/cap checks where a full image is unnecessary. */
export function makePngHeader(width: number, height: number): Uint8Array {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	const ihdrData = [
		(width >>> 24) & 0xff,
		(width >>> 16) & 0xff,
		(width >>> 8) & 0xff,
		width & 0xff,
		(height >>> 24) & 0xff,
		(height >>> 16) & 0xff,
		(height >>> 8) & 0xff,
		height & 0xff,
		8,
		2,
		0,
		0,
		0,
	];
	const ihdr = chunk("IHDR", ihdrData);
	return Uint8Array.from([...signature, ...ihdr]);
}

/** Build a minimal valid PNG (RGB, 8-bit) of the given dimensions. */
export function makePng(width: number, height: number): Uint8Array {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	const ihdrData = [
		(width >>> 24) & 0xff,
		(width >>> 16) & 0xff,
		(width >>> 8) & 0xff,
		width & 0xff,
		(height >>> 24) & 0xff,
		(height >>> 16) & 0xff,
		(height >>> 8) & 0xff,
		height & 0xff,
		8, // bit depth
		2, // color type RGB
		0,
		0,
		0, // compression, filter, interlace
	];
	const ihdr = chunk("IHDR", ihdrData);
	// One raw image data chunk: each row is prefixed by a filter byte (0 = none).
	const raw: number[] = [];
	const rowLength = width * 3;
	for (let y = 0; y < height; y += 1) {
		raw.push(0);
		for (let x = 0; x < rowLength; x += 1) raw.push((x + y) & 0xff);
	}
	const idat = chunk("IDAT", Array.from(deflateSync(Buffer.from(raw))));
	const iend = chunk("IEND", []);
	return Uint8Array.from([...signature, ...ihdr, ...idat, ...iend]);
}

function chunk(type: string, data: number[]): number[] {
	const length = [
		(data.length >>> 24) & 0xff,
		(data.length >>> 16) & 0xff,
		(data.length >>> 8) & 0xff,
		data.length & 0xff,
	];
	const typeBytes = Array.from(type, (c) => c.charCodeAt(0));
	const crcInput = Buffer.from([...typeBytes, ...data]);
	const crc = crc32(crcInput) >>> 0;
	const crcBytes = [
		(crc >>> 24) & 0xff,
		(crc >>> 16) & 0xff,
		(crc >>> 8) & 0xff,
		crc & 0xff,
	];
	return [...length, ...typeBytes, ...data, ...crcBytes];
}

/** Build a minimal JPEG with a SOF0 frame carrying the given dimensions. */
export function makeJpeg(width: number, height: number): Uint8Array {
	const bytes: number[] = [0xff, 0xd8]; // SOI
	// APP0 marker (length 16)
	bytes.push(
		0xff,
		0xe0,
		0x00,
		0x10,
		0x4a,
		0x46,
		0x49,
		0x46,
		0x00,
		1,
		1,
		0,
		0,
		1,
		0,
		1,
		0,
		0,
	);
	// SOF0 marker: 0xFFC0, length 17, precision 8, height(2), width(2), components...
	const length = 17;
	bytes.push(
		0xff,
		0xc0,
		(length >> 8) & 0xff,
		length & 0xff,
		8,
		(height >> 8) & 0xff,
		height & 0xff,
		(width >> 8) & 0xff,
		width & 0xff,
		3,
		1,
		0x22,
		0,
		2,
		0x11,
		1,
		3,
		0x11,
		1,
	);
	bytes.push(0xff, 0xd9); // EOI
	return Uint8Array.from(bytes);
}

/** Build a minimal GIF header with the given dimensions. */
export function makeGif(width: number, height: number): Uint8Array {
	const bytes: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
	bytes.push(
		width & 0xff,
		(width >> 8) & 0xff,
		height & 0xff,
		(height >> 8) & 0xff,
		0,
		0,
		0,
	);
	return Uint8Array.from(bytes);
}

/** Build a minimal WebP (lossy VP8) header with the given dimensions. */
export function makeWebp(width: number, height: number): Uint8Array {
	const bytes: number[] = [0x52, 0x49, 0x46, 0x46]; // RIFF
	for (let i = 0; i < 4; i += 1) bytes.push(0); // size placeholder
	bytes.push(0x57, 0x45, 0x42, 0x50); // WEBP
	bytes.push(0x56, 0x50, 0x38, 0x20); // VP8
	for (let i = 0; i < 4; i += 1) bytes.push(0); // chunk size
	// VP8 frame header bytes up to dimensions at offset 26/28 from file start.
	// Pad to reach offsets 26..29 with the LE dimension words.
	while (bytes.length < 26) bytes.push(0);
	bytes.push(
		width & 0xff,
		(width >> 8) & 0xff,
		height & 0xff,
		(height >> 8) & 0xff,
	);
	while (bytes.length < 30) bytes.push(0);
	return Uint8Array.from(bytes);
}

/** Build a minimal AVIF ftyp box header. Dimensions are not embedded here. */
export function makeAvifHeader(): Uint8Array {
	const bytes: number[] = [];
	for (let i = 0; i < 4; i += 1) bytes.push(0); // box size placeholder
	bytes.push(0x66, 0x74, 0x79, 0x70); // ftyp
	bytes.push(0x61, 0x76, 0x69, 0x66); // avif brand
	return Uint8Array.from(bytes);
}

/** Build a minimal MP4 ftyp box header. */
export function makeMp4Header(): Uint8Array {
	const bytes: number[] = [];
	for (let i = 0; i < 4; i += 1) bytes.push(0); // box size placeholder
	bytes.push(0x66, 0x74, 0x79, 0x70); // ftyp
	bytes.push(0x69, 0x73, 0x6f, 0x6d); // isom brand
	return Uint8Array.from(bytes);
}

/** Build a minimal WebM EBML header. */
export function makeWebmHeader(): Uint8Array {
	return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);
}

/** Build a minimal safe SVG with the given viewBox dimensions. */
export function makeSvg(width = 100, height = 100): Uint8Array {
	const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/></svg>`;
	return Uint8Array.from(Buffer.from(text, "utf8"));
}

/** A valid 1x1 PNG used to compare against staging placeholder output. */
export const PLACEHOLDER_PNG = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		"base64",
	),
);

/**
 * Return minimal valid bytes whose sniffed MIME matches the extension of an
 * output path. Used by fake ffmpeg runners so derived outputs pass sniff/MIME
 * validation (blocker 7: emit actual requested-format bytes).
 */
export function bytesForExt(absPath: string): Uint8Array {
	// Match the format marker anywhere in the path so temp files (which carry a
	// `.tmp-<uuid>` suffix after the real extension) resolve to the right bytes.
	const lower = absPath.toLowerCase();
	if (lower.includes(".avif")) return makeAvifHeader();
	if (lower.includes(".png")) return makePng(2, 2);
	if (lower.includes(".jpg") || lower.includes(".jpeg")) return makeJpeg(2, 2);
	return PLACEHOLDER_PNG;
}
