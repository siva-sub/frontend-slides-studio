/**
 * @slides-studio/media-kit/node — Node-only on-disk media staging.
 *
 * Stages user media under `assets/user-media/` with: SHA-256 original identity,
 * Unicode NFC name normalization, safe collision-resistant POSIX names, content
 * dedupe, byte/MIME/dimension metadata, hardened path containment + symlink
 * defense (ancestor walk rejecting any symlink, atomic exclusive/no-follow
 * original creation), size/pixel caps, original preservation (originals are never
 * overwritten), validated derived transform records (long-edge capping, AVIF
 * conversion fallback, video poster generation), ffprobe-backed video metadata,
 * a caller-supplied existing-entry validator, and an atomic manifest writer.
 * ffmpeg/ffprobe are dependency-injected so unit tests never require media
 * network/provider calls.
 */

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { basename, extname, posix, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { mediaAssetSchema, type MediaAsset } from "@slides-studio/protocol";

import {
	detectImageDimensions,
	MIME_EXTENSION,
	sniffMime,
	validateMediaBytes,
} from "../sniff.js";

/** Default staging base path relative to the supplied root. */
export const DEFAULT_BASE_PATH = "assets/user-media";
/** Default byte cap (50 MiB). */
export const DEFAULT_MAX_BYTES = 52_428_800;
/** Default pixel cap (100 megapixels). */
export const DEFAULT_MAX_PIXELS = 100_000_000;
/** Default long-edge cap applied when ffmpeg is available. */
export const DEFAULT_LONG_EDGE_CAP = 2048;

/** A staging manifest entry extends a protocol-compatible asset with provenance. */
export interface StagingManifestEntry extends MediaAsset {
	/** Deck-local relative path of the preserved original. */
	originalPath: string;
	/** ISO timestamp the entry was staged (deterministic when `now` is injected). */
	stagedAt: string;
	/** Derived transform records (capped/avif/poster). */
	derived: DerivedRecord[];
}

export interface DerivedRecord {
	kind: "long-edge-cap" | "avif" | "poster";
	/** Deck-local relative path; absent when the transform was skipped. */
	path?: string;
	mimeType: string;
	width?: number;
	height?: number;
	bytes?: number;
	/** Present when the transform was skipped (no artifact produced). */
	note?: string;
}

/** A staging manifest collects deck-local fields only (no absolute root). */
export interface StagingManifest {
	schemaVersion: 1;
	basePath: string;
	entries: StagingManifestEntry[];
}

/** Result of a spawned ffmpeg/ffprobe command (dependency-injectable). */
export interface RunnerResult {
	status: number;
	stdout: string;
	stderr: string;
}
export type FfmpegRunner = (args: string[]) => RunnerResult;
export type FfprobeRunner = (args: string[]) => RunnerResult;

export interface StageOptions {
	/** Absolute or relative base directory for the staging tree. */
	root: string;
	/** Raw original bytes. */
	bytes: Uint8Array;
	/** Original filename (Unicode, may contain path separators / odd glyphs). */
	name: string;
	/** Declared MIME validated against the sniffed type (spoof rejection). */
	declaredMime?: string;
	/** Staging base path relative to root; defaults to {@link DEFAULT_BASE_PATH}. */
	basePath?: string;
	/** Maximum payload size in bytes (finite positive integer). */
	maxBytes?: number;
	/** Maximum image/video pixels (finite positive integer). */
	maxPixels?: number;
	/** Long-edge pixel cap (finite non-negative integer; 0 disables). */
	longEdgeCap?: number;
	/** Generate an AVIF conversion fallback for images (default true). */
	enableAvif?: boolean;
	/** Generate a poster for videos (default true). */
	enablePoster?: boolean;
	/** Inject an ffmpeg runner; defaults to a real spawnSync against `ffmpeg`. */
	ffmpeg?: FfmpegRunner;
	/** Inject an ffprobe runner; defaults to a real spawnSync against `ffprobe`. */
	ffprobe?: FfprobeRunner;
	/** Deterministic clock for tests. */
	now?: () => string;
	/** Existing manifest entries to dedupe against without touching the disk. */
	existing?: readonly StagingManifestEntry[];
	/** Persist the accumulated manifest via writeManifest (stageMany default true). */
	persistManifest?: boolean;
}

const POSIX_SAFE = /[^A-Za-z0-9._-]/g;

// O_NOFOLLOW may be undefined on platforms that do not expose it; fall back to a
// plain exclusive create so the destination symlink victim test still works on
// those platforms via the ancestor-walk pre-check.
const O_NOFOLLOW = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
const EXCLUSIVE_NOFOLLOW_FLAG =
	O_NOFOLLOW | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY;

/** Apply Unicode NFC normalization (canonical composition) to a string. */
export function normalizeName(name: string): string {
	return name.normalize("NFC");
}

/**
 * Mirror of the protocol `safeRelativePathSchema`: a canonical deck-local POSIX
 * relative path. Rejects absolute/tilde/drive prefix, backslash, control/NUL,
 * empty/dot/dotdot segments, duplicate separators, and trailing separators.
 */
export function isSafeRelativePath(path: string): boolean {
	if (
		path.length === 0 ||
		path.charCodeAt(0) === 47 ||
		path.charCodeAt(0) === 126
	)
		return false;
	if (/\\/.test(path)) return false;
	if (/[\x00-\x1f\x7f]/.test(path)) return false;
	if (/^[a-zA-Z]:/.test(path)) return false;
	if (/\/\//.test(path)) return false;
	if (path.endsWith("/")) return false;
	for (const segment of path.split("/")) {
		if (segment === "" || segment === "." || segment === "..") return false;
	}
	return true;
}

export function assertSafeRelativePath(path: string, label: string): void {
	if (!isSafeRelativePath(path)) {
		throw new RangeError(
			`${label} is not a canonical deck-local POSIX relative path: ${path}`,
		);
	}
}

/**
 * Build a safe collision-resistant POSIX STEM from a Unicode filename. The
 * basename is taken (separators of either orientation collapse), the NFC form is
 * used, the extension is stripped (the canonical extension always comes from the
 * sniffed MIME), unsafe characters are replaced with `-`, and control/NUL bytes
 * and traversal segments are removed.
 */
export function safePosixName(name: string, fallback = "media"): string {
	const nfc = normalizeName(name).replace(/\\/g, "/");
	const base = basename(nfc) || fallback;
	const cleaned = base.replace(/\.\.+/g, ".").replace(/\x00/g, "");
	const ext = extname(cleaned).toLowerCase();
	const stem = cleaned.slice(0, cleaned.length - ext.length).trim() || fallback;
	return (
		stem
			.replace(POSIX_SAFE, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64) || fallback
	);
}

/** Compute the SHA-256 hex identity of a byte payload. */
export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function resolveRealRoot(root: string): Promise<string> {
	return realpath(root).catch(() => root);
}

function isUnderRoot(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== "" && !rel.startsWith("..") && !posix.isAbsolute(rel);
}

/**
 * Resolve `target` against `root`, asserting the result is strictly contained
 * under the real root and that NO component of the path (ancestor or target) is
 * a symlink. Throws on any traversal or symlink (internal or escaping).
 */
export async function assertContained(
	root: string,
	target: string,
): Promise<void> {
	const realRoot = await resolveRealRoot(root);
	const realTarget = await realpath(target).catch(() => target);
	if (!isUnderRoot(realRoot, realTarget)) {
		throw new RangeError(
			`path escapes staging root: ${relative(realRoot, realTarget) || target}`,
		);
	}
	// Walk every existing ancestor under the real root, rejecting any symlink.
	await walkAncestors(realRoot, target);
}

/** Walk existing path components from realRoot to target, rejecting any symlink. */
async function walkAncestors(realRoot: string, target: string): Promise<void> {
	const rel = relative(realRoot, target);
	if (rel === "" || rel.startsWith("..") || posix.isAbsolute(rel)) {
		throw new RangeError(`path escapes staging root: ${rel || target}`);
	}
	const parts = rel.split(posix.sep);
	let cursor = realRoot;
	for (const part of parts) {
		cursor = posix.join(cursor, part);
		let info;
		try {
			info = await lstat(cursor);
		} catch {
			break; // non-existent component stops the walk (created later).
		}
		if (info.isSymbolicLink()) {
			throw new RangeError(
				`symlink ancestor is forbidden under staging root: ${cursor}`,
			);
		}
	}
}

/**
 * Ensure the directory of `absTargetFile` exists under `realRoot`, creating each
 * missing component and rejecting any existing symlink ancestor. Throws on any
 * traversal or symlink.
 */
async function ensureContainedDirs(
	realRoot: string,
	absTargetFile: string,
): Promise<void> {
	const dir = posix.dirname(absTargetFile);
	const rel = relative(realRoot, dir);
	if (rel === "" || rel.startsWith("..") || posix.isAbsolute(rel)) {
		throw new RangeError(`staging directory escapes root: ${dir}`);
	}
	const parts = rel.split(posix.sep);
	let cursor = realRoot;
	for (const part of parts) {
		cursor = posix.join(cursor, part);
		let info;
		try {
			info = await lstat(cursor);
		} catch {
			await mkdir(cursor).catch(async (error: NodeJS.ErrnoException) => {
				// A concurrent creation is acceptable; re-check otherwise.
				if (error.code !== "EEXIST") {
					try {
						await mkdir(cursor, { recursive: true });
					} catch {
						/* best effort */
					}
				}
			});
			continue;
		}
		if (info.isSymbolicLink()) {
			throw new RangeError(
				`symlink ancestor is forbidden under staging root: ${cursor}`,
			);
		}
		if (!info.isDirectory()) {
			throw new RangeError(`path component is not a directory: ${cursor}`);
		}
	}
}

/**
 * Create the original atomically with an exclusive, no-follow open so a symlink
 * victim at the destination cannot be written through or overwritten.
 */
async function writeOriginalExclusive(
	absTarget: string,
	bytes: Uint8Array,
): Promise<void> {
	await writeFile(absTarget, bytes, { flag: EXCLUSIVE_NOFOLLOW_FLAG });
}

/** Remove a file, ignoring "not found" so cleanup is idempotent. */
async function removeFile(absTarget: string): Promise<void> {
	await unlink(absTarget).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
	});
}

/**
 * Build a unique contained temp path in the same directory as `outAbs`. The temp
 * name is POSIX-safe so derived ffmpeg outputs are staged there before an
 * atomic exclusive/no-follow commit to the final path.
 */
function tempPathFor(outAbs: string): string {
	return posix.join(
		posix.dirname(outAbs),
		`.${basename(outAbs)}.tmp-${randomUUID()}`,
	);
}

/**
 * Atomically commit a validated temp file to its final path using exclusive,
 * no-follow semantics. The final path is created only if it does not already
 * exist (O_CREAT|O_EXCL|O_NOFOLLOW), so a pre-existing final symlink or file is
 * never followed or overwritten. The temp file is always removed. Returns the
 * validated final output, or null when validation/commit fails.
 */
async function commitDerived(args: {
	root: string;
	realRoot: string;
	tmpAbs: string;
	outAbs: string;
	expectedMime: string;
}): Promise<{ bytes: number; width?: number; height?: number } | null> {
	const tmpValidated = await validateDerivedOutput({
		root: args.root,
		realRoot: args.realRoot,
		outAbs: args.tmpAbs,
		expectedMime: args.expectedMime,
	});
	if (!tmpValidated) return null;
	try {
		const tmpBytes = new Uint8Array(await readFile(args.tmpAbs));
		await writeOriginalExclusive(args.outAbs, tmpBytes);
	} catch {
		return null; // pre-existing final symlink/file: never overwrite.
	}
	return validateDerivedOutput({
		root: args.root,
		realRoot: args.realRoot,
		outAbs: args.outAbs,
		expectedMime: args.expectedMime,
	});
}

/** Default ffmpeg runner: spawn the real binary, returning a UTF-8 result. */
export const defaultFfmpeg: FfmpegRunner = (args) => {
	const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
	return {
		status: result.status ?? -1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
};

/** Default ffprobe runner: spawn the real binary, returning a UTF-8 result. */
export const defaultFfprobe: FfprobeRunner = (args) => {
	const result = spawnSync("ffprobe", args, { encoding: "utf8" });
	return {
		status: result.status ?? -1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
};

/** Read intrinsic width/height from an ffprobe JSON result, or null. */
export function dimensionsFromFfprobe(
	stdout: string,
): { width: number; height: number } | null {
	try {
		const parsed = JSON.parse(stdout) as {
			streams?: Array<{ width?: number; height?: number }>;
		};
		const video = parsed.streams?.find(
			(stream) =>
				typeof stream.width === "number" && typeof stream.height === "number",
		);
		if (
			video &&
			typeof video.width === "number" &&
			typeof video.height === "number"
		) {
			return { width: video.width, height: video.height };
		}
	} catch {
		/* ignore parse failures */
	}
	return null;
}

export interface StageResult {
	asset: MediaAsset;
	entry: StagingManifestEntry;
	derived: DerivedRecord[];
	/** True when an identical original was already staged (no bytes written). */
	deduped: boolean;
	/** Canonical deck-local POSIX path of the preserved original. */
	path: string;
}

function extForMime(mime: string): string {
	const ext = MIME_EXTENSION[mime];
	return ext ? `.${ext}` : ".bin";
}

function toMediaAsset(entry: StagingManifestEntry): MediaAsset {
	const { originalPath: _o, stagedAt: _s, derived: _d, ...asset } = entry;
	void _o;
	void _s;
	void _d;
	return asset;
}

function buildAssetFields(validated: {
	width?: number | undefined;
	height?: number | undefined;
	bytes: number;
}): { width?: number; height?: number; bytes: number } {
	const fields: { width?: number; height?: number; bytes: number } = {
		bytes: validated.bytes,
	};
	if (validated.width !== undefined && validated.height !== undefined) {
		fields.width = validated.width;
		fields.height = validated.height;
	}
	return fields;
}

/** Validate a configured limit is a finite integer with the required sign. */
function validateLimit(
	value: number | undefined,
	defaultValue: number,
	name: string,
	allowZero: boolean,
): number {
	const v = value ?? defaultValue;
	if (!Number.isFinite(v) || !Number.isInteger(v)) {
		throw new RangeError(
			`${name} must be a finite integer (received ${String(value ?? defaultValue)})`,
		);
	}
	if (allowZero ? v < 0 : v <= 0) {
		throw new RangeError(
			`${name} must be ${allowZero ? ">= 0" : "> 0"} (received ${v})`,
		);
	}
	return v;
}

/**
 * Stage a single media payload. Validates limits/bytes/names, dedupes by SHA-256
 * (after validating any caller-supplied existing entry), writes the original
 * atomically under a collision-resistant path with full symlink defense, probes
 * video dimensions via ffprobe, and records validated derived transforms.
 */
export async function stageFile(options: StageOptions): Promise<StageResult> {
	if (!(options.bytes instanceof Uint8Array)) {
		throw new TypeError("stageFile expects bytes as a Uint8Array");
	}
	const root = options.root;
	const basePath = options.basePath ?? DEFAULT_BASE_PATH;
	assertSafeRelativePath(basePath, "basePath");
	// Blocker 11: validate configured limits as finite integers.
	const maxBytes = validateLimit(
		options.maxBytes,
		DEFAULT_MAX_BYTES,
		"maxBytes",
		false,
	);
	const maxPixels = validateLimit(
		options.maxPixels,
		DEFAULT_MAX_PIXELS,
		"maxPixels",
		false,
	);
	const longEdgeCap = validateLimit(
		options.longEdgeCap,
		DEFAULT_LONG_EDGE_CAP,
		"longEdgeCap",
		true,
	);
	const realRoot = await resolveRealRoot(root);

	const validationOptions: {
		declaredMime?: string;
		maxBytes?: number;
		maxPixels?: number;
	} = { maxBytes, maxPixels };
	if (options.declaredMime !== undefined)
		validationOptions.declaredMime = options.declaredMime;
	const validated = validateMediaBytes(options.bytes, validationOptions);
	const hash = sha256Hex(options.bytes);
	// Canonical extension always from the sniffed MIME; filename supplies stem only.
	const stem = safePosixName(options.name);
	const ext = extForMime(validated.mime);

	// Dedupe against caller-supplied entries (validated before reuse).
	const existingMatch = (options.existing ?? []).find(
		(entry) => entry.hash.value === hash,
	);
	if (existingMatch) {
		await validateExistingEntry(root, realRoot, existingMatch);
		return {
			asset: toMediaAsset(existingMatch),
			entry: existingMatch,
			derived: existingMatch.derived,
			deduped: true,
			path: existingMatch.path,
		};
	}

	// Collision-resistant canonical path: <basePath>/<hh>/<stem>-<short>.<ext>
	const shortHash = hash.slice(0, 8);
	const candidateStem = `${stem}-${shortHash}`
		.replace(POSIX_SAFE, "-")
		.replace(/^-+|-+$/g, "");
	let relativePath = posix.join(
		basePath,
		hash.slice(0, 2),
		`${candidateStem}${ext}`,
	);
	let absolutePath = posix.join(root, relativePath);

	// Resolve an unused filename (content-addressed collisions are extremely
	// unlikely, but a same-name different-content upload must never overwrite).
	let suffix = 0;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		let info;
		try {
			info = await lstat(absolutePath);
		} catch {
			break; // does not exist -> usable
		}
		if (info.isFile()) {
			const onDisk = await readFile(absolutePath);
			if (sha256Hex(new Uint8Array(onDisk)) === hash) {
				return finalizeDedupe({ options, validated, hash, relativePath });
			}
			suffix += 1;
			relativePath = posix.join(
				basePath,
				hash.slice(0, 2),
				`${candidateStem}-${suffix}${ext}`,
			);
			absolutePath = posix.join(root, relativePath);
		} else {
			// Non-file (e.g. symlink) at the candidate: refuse to reuse it.
			throw new RangeError(
				`staging target is not a regular file: ${relativePath}`,
			);
		}
	}

	// Hardened pre-write containment: ensure no symlink ancestor, then atomic
	// exclusive/no-follow original creation so a destination symlink victim cannot
	// be written through.
	await ensureContainedDirs(realRoot, absolutePath);
	await writeOriginalExclusive(absolutePath, options.bytes);
	// Post-write defense: the written file must be a regular file inside root.
	const writtenStat = await lstat(absolutePath);
	if (!writtenStat.isFile()) {
		throw new RangeError(
			`staged original is not a regular file: ${relativePath}`,
		);
	}
	await assertContained(root, absolutePath);

	// Probe video dimensions via ffprobe and enforce a hard contract: ffprobe
	// must succeed with finite, positive dimensions within maxPixels. On any
	// failure the just-written original is removed so no rejected original remains.
	let probeWidth: number | undefined = validated.width;
	let probeHeight: number | undefined = validated.height;
	if (validated.mime === "video/mp4" || validated.mime === "video/webm") {
		const probed = probeVideoDims(
			{ root, relativeOriginal: relativePath },
			options.ffprobe ?? defaultFfprobe,
		);
		const valid =
			probed !== null &&
			Number.isFinite(probed.width) &&
			Number.isFinite(probed.height) &&
			probed.width > 0 &&
			probed.height > 0;
		if (!valid) {
			await removeFile(absolutePath);
			throw new RangeError(
				`video ffprobe failed or returned invalid dimensions for ${relativePath}; original removed`,
			);
		}
		const pixels = probed.width * probed.height;
		if (!Number.isFinite(pixels) || pixels <= 0 || pixels > maxPixels) {
			await removeFile(absolutePath);
			throw new RangeError(
				`video dimensions ${probed.width}x${probed.height} exceed maxPixels (${maxPixels}); original removed`,
			);
		}
		probeWidth = probed.width;
		probeHeight = probed.height;
	}

	// Derived transforms (ffmpeg/ffprobe injected; outputs fully validated).
	const derived = await buildDerived({
		root,
		realRoot,
		basePath,
		relativeOriginal: relativePath,
		bytes: options.bytes,
		mime: validated.mime,
		width: probeWidth,
		height: probeHeight,
		longEdgeCap,
		enableAvif: options.enableAvif ?? true,
		enablePoster: options.enablePoster ?? true,
		ffmpeg: options.ffmpeg ?? defaultFfmpeg,
		ffprobe: options.ffprobe ?? defaultFfprobe,
	});

	const entry: StagingManifestEntry = {
		schemaVersion: 1,
		id: `asset-${shortHash}`,
		path: relativePath,
		hash: { algorithm: "sha256", value: hash },
		mimeType: validated.mime,
		...buildAssetFields({
			width: probeWidth,
			height: probeHeight,
			bytes: validated.bytes,
		}),
		evidence: [],
		originalPath: relativePath,
		stagedAt: (options.now ?? defaultNow)(),
		derived,
	};

	return {
		asset: toMediaAsset(entry),
		entry,
		derived,
		deduped: false,
		path: relativePath,
	};
}

/** Validate a caller-supplied existing dedupe entry before reuse. */
async function validateExistingEntry(
	root: string,
	realRoot: string,
	entry: StagingManifestEntry,
): Promise<void> {
	// Structural validation against the protocol MediaAsset schema.
	mediaAssetSchema.parse(toMediaAsset(entry));
	assertSafeRelativePath(entry.path, "existing entry path");
	assertSafeRelativePath(entry.originalPath, "existing entry originalPath");
	// path and originalPath must be identical for a staging original.
	if (entry.path !== entry.originalPath) {
		throw new RangeError(
			`existing entry path must equal originalPath: ${entry.path} !== ${entry.originalPath}`,
		);
	}
	const absOriginal = posix.join(root, entry.path);
	await assertContained(root, absOriginal);
	let buf: Uint8Array;
	try {
		buf = new Uint8Array(await readFile(absOriginal));
	} catch {
		throw new RangeError(
			`existing entry is dangling (original missing): ${entry.path}`,
		);
	}
	if (sha256Hex(buf) !== entry.hash.value) {
		throw new RangeError(
			`existing entry on-disk hash mismatch (dangling): ${entry.path}`,
		);
	}
	// Declared byte length must match the on-disk file length.
	if (entry.bytes !== undefined && entry.bytes !== buf.length) {
		throw new RangeError(
			`existing entry bytes mismatch: declared ${entry.bytes} but file is ${buf.length} bytes`,
		);
	}
	let sniffed: string;
	try {
		sniffed = sniffMime(buf);
	} catch {
		throw new RangeError(
			`existing entry original is not recognized media (dangling): ${entry.path}`,
		);
	}
	if (sniffed !== entry.mimeType) {
		throw new RangeError(
			`existing entry MIME mismatch: declared ${entry.mimeType} but bytes are ${sniffed}`,
		);
	}
	// Image dimensions, when both declared and sniffable, must match exactly.
	const sniffedDims = detectImageDimensions(buf, sniffed);
	if (
		sniffedDims !== null &&
		entry.width !== undefined &&
		entry.height !== undefined &&
		(sniffedDims.width !== entry.width ||
			sniffedDims.height !== entry.height)
	) {
		throw new RangeError(
			`existing entry dimensions mismatch: declared ${entry.width}x${entry.height} but sniffed ${sniffedDims.width}x${sniffedDims.height}`,
		);
	}
	// Validate each existing derived artifact path is canonical, contained, regular.
	for (const derived of entry.derived) {
		if (derived.path === undefined) continue; // skipped record (no artifact)
		assertSafeRelativePath(derived.path, "existing derived path");
		const absDerived = posix.join(root, derived.path);
		await assertContained(root, absDerived);
		const dStat = await lstat(absDerived).catch(() => null);
		if (!dStat || !dStat.isFile()) {
			throw new RangeError(
				`existing derived artifact is dangling: ${derived.path}`,
			);
		}
	}
	void realRoot;
}

function finalizeDedupe(args: {
	options: StageOptions;
	validated: { mime: string; bytes: number; width?: number; height?: number };
	hash: string;
	relativePath: string;
}): StageResult {
	const entry: StagingManifestEntry = {
		schemaVersion: 1,
		id: `asset-${args.hash.slice(0, 8)}`,
		path: args.relativePath,
		hash: { algorithm: "sha256", value: args.hash },
		mimeType: args.validated.mime,
		...buildAssetFields(args.validated),
		evidence: [],
		originalPath: args.relativePath,
		stagedAt: (args.options.now ?? defaultNow)(),
		derived: [],
	};
	return {
		asset: toMediaAsset(entry),
		entry,
		derived: [],
		deduped: true,
		path: args.relativePath,
	};
}

function defaultNow(): string {
	return new Date().toISOString();
}

function probeVideoDims(
	args: { root: string; relativeOriginal: string },
	ffprobe: FfprobeRunner,
): { width: number; height: number } | null {
	const result = ffprobe([
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height",
		"-of",
		"json",
		posix.join(args.root, args.relativeOriginal),
	]);
	if (result.status !== 0) return null;
	return dimensionsFromFfprobe(result.stdout);
}

interface DerivedArgs {
	root: string;
	realRoot: string;
	basePath: string;
	relativeOriginal: string;
	bytes: Uint8Array;
	mime: string;
	width: number | undefined;
	height: number | undefined;
	longEdgeCap: number;
	enableAvif: boolean;
	enablePoster: boolean;
	ffmpeg: FfmpegRunner;
	ffprobe: FfprobeRunner;
}

async function buildDerived(args: DerivedArgs): Promise<DerivedRecord[]> {
	const derived: DerivedRecord[] = [];
	const isVideo = args.mime === "video/mp4" || args.mime === "video/webm";
	const isImage =
		args.mime === "image/png" ||
		args.mime === "image/jpeg" ||
		args.mime === "image/webp" ||
		args.mime === "image/avif" ||
		args.mime === "image/gif";

	if (
		isImage &&
		args.longEdgeCap > 0 &&
		args.width !== undefined &&
		args.height !== undefined
	) {
		const longEdge = Math.max(args.width, args.height);
		if (longEdge > args.longEdgeCap) {
			const record = await capLongEdge(args);
			if (record) derived.push(record);
		}
	}

	if (args.enableAvif && isImage && args.mime !== "image/avif") {
		const record = await convertAvif(args);
		if (record) derived.push(record);
	}

	if (args.enablePoster && isVideo) {
		const record = await generatePoster(args);
		if (record) derived.push(record);
	}

	return derived;
}

/**
 * Validate a derived output fully: exists, is a regular file, is contained, and
 * its sniffed MIME matches the expected target format with recorded dimensions
 * and bytes. Returns null when validation fails (caller records a skip).
 */
async function validateDerivedOutput(args: {
	root: string;
	realRoot: string;
	outAbs: string;
	expectedMime: string;
}): Promise<{ bytes: number; width?: number; height?: number } | null> {
	const { root, outAbs, expectedMime } = args;
	let info;
	try {
		info = await lstat(outAbs);
	} catch {
		return null;
	}
	if (!info.isFile()) return null;
	await assertContained(root, outAbs);
	const buf = new Uint8Array(await readFile(outAbs));
	if (buf.length === 0) return null;
	let sniffed: string;
	try {
		sniffed = sniffMime(buf);
	} catch {
		return null;
	}
	if (sniffed !== expectedMime) return null;
	const dims = detectImageDimensions(buf, sniffed);
	return dims
		? { bytes: buf.length, width: dims.width, height: dims.height }
		: { bytes: buf.length };
}

async function capLongEdge(args: DerivedArgs): Promise<DerivedRecord | null> {
	const outRel = appendSuffix(args.relativeOriginal, "-cap", ".png");
	const outAbs = posix.join(args.root, outRel);
	const filter = `scale='if(gt(iw,ih),min(${args.longEdgeCap},iw),-2)':'if(gt(iw,ih),-2,min(${args.longEdgeCap},ih))'`;
	await ensureContainedDirs(args.realRoot, outAbs);
	const tmpAbs = tempPathFor(outAbs);
	const result = args.ffmpeg([
		"-y",
		"-i",
		posix.join(args.root, args.relativeOriginal),
		"-vf",
		filter,
		"-frames:v",
		"1",
		tmpAbs,
	]);
	if (result.status !== 0) {
		await removeFile(tmpAbs);
		return skippedRecord(
			"long-edge-cap",
			"image/png",
			`ffmpeg cap failed (status ${result.status})`,
		);
	}
	const committed = await commitDerived({
		root: args.root,
		realRoot: args.realRoot,
		tmpAbs,
		outAbs,
		expectedMime: "image/png",
	});
	await removeFile(tmpAbs);
	if (!committed) {
		return skippedRecord(
			"long-edge-cap",
			"image/png",
			"cap output failed validation or commit",
		);
	}
	return successRecord("long-edge-cap", outRel, "image/png", committed);
}

async function convertAvif(args: DerivedArgs): Promise<DerivedRecord | null> {
	const outRel = appendSuffix(args.relativeOriginal, "-avif", ".avif");
	const outAbs = posix.join(args.root, outRel);
	await ensureContainedDirs(args.realRoot, outAbs);
	const tmpAbs = tempPathFor(outAbs);
	const result = args.ffmpeg([
		"-y",
		"-i",
		posix.join(args.root, args.relativeOriginal),
		"-frames:v",
		"1",
		"-c:v",
		"libaom-av1",
		"-pix_fmt",
		"yuv420p",
		tmpAbs,
	]);
	if (result.status !== 0) {
		await removeFile(tmpAbs);
		return skippedRecord(
			"avif",
			"image/avif",
			"avif conversion unavailable; fallback skipped",
		);
	}
	const committed = await commitDerived({
		root: args.root,
		realRoot: args.realRoot,
		tmpAbs,
		outAbs,
		expectedMime: "image/avif",
	});
	await removeFile(tmpAbs);
	if (!committed) {
		return skippedRecord("avif", "image/avif", "avif output failed validation or commit");
	}
	return successRecord("avif", outRel, "image/avif", committed);
}

async function generatePoster(
	args: DerivedArgs,
): Promise<DerivedRecord | null> {
	const outRel = appendSuffix(args.relativeOriginal, "-poster", ".png");
	const outAbs = posix.join(args.root, outRel);
	await ensureContainedDirs(args.realRoot, outAbs);
	// Attempt ffmpeg extraction into a temp file, then atomically commit.
	const extracted = false;
	const extractTmp = tempPathFor(outAbs);
	const result = args.ffmpeg([
		"-y",
		"-i",
		posix.join(args.root, args.relativeOriginal),
		"-ss",
		"1",
		"-frames:v",
		"1",
		"-vf",
		"scale='min(1024,iw)':-2",
		extractTmp,
	]);
	if (result.status === 0) {
		const committed = await commitDerived({
			root: args.root,
			realRoot: args.realRoot,
			tmpAbs: extractTmp,
			outAbs,
			expectedMime: "image/png",
		});
		if (committed) {
			await removeFile(extractTmp);
			return successRecord("poster", outRel, "image/png", committed);
		}
	}
	await removeFile(extractTmp);
	// Deterministic placeholder fallback: write a valid 1x1 PNG to a temp file and
	// commit the same way so a pre-existing final symlink victim is never
	// overwritten.
	const placeholderTmp = tempPathFor(outAbs);
	try {
		await writeOriginalExclusive(placeholderTmp, PLACEHOLDER_PNG);
		const committed = await commitDerived({
			root: args.root,
			realRoot: args.realRoot,
			tmpAbs: placeholderTmp,
			outAbs,
			expectedMime: "image/png",
		});
		if (committed) {
			return successRecord(
				"poster",
				outRel,
				"image/png",
				{ bytes: PLACEHOLDER_PNG.length, width: 1, height: 1 },
				"ffmpeg poster extraction failed; deterministic placeholder written",
			);
		}
	} finally {
		await removeFile(placeholderTmp);
	}
	void extracted;
	return skippedRecord(
		"poster",
		"image/png",
		"poster extraction failed and placeholder commit failed",
	);
}

function skippedRecord(
	kind: DerivedRecord["kind"],
	mimeType: string,
	note: string,
): DerivedRecord {
	return { kind, mimeType, note };
}

function successRecord(
	kind: DerivedRecord["kind"],
	path: string,
	mimeType: string,
	validated: { bytes: number; width?: number; height?: number },
	note?: string,
): DerivedRecord {
	const record: DerivedRecord = { kind, path, mimeType };
	if (validated.width !== undefined && validated.height !== undefined) {
		record.width = validated.width;
		record.height = validated.height;
	}
	record.bytes = validated.bytes;
	if (note !== undefined) record.note = note;
	return record;
}

function appendSuffix(relPath: string, suffix: string, newExt: string): string {
	const ext = extname(relPath);
	const stemCore = relPath.slice(0, relPath.length - ext.length);
	return `${stemCore}${suffix}${newExt}`;
}

// A valid 1x1 opaque gray PNG used as the deterministic poster placeholder.
const PLACEHOLDER_PNG = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		"base64",
	),
);

/** Build a fresh deck-local staging manifest from a set of entries. */
export function buildManifest(
	basePath: string,
	entries: readonly StagingManifestEntry[],
): StagingManifest {
	return { schemaVersion: 1, basePath, entries: [...entries] };
}

/**
 * Atomically write the staging manifest to `<root>/<basePath>/manifest.json`.
 * The manifest contains deck-local fields only (no absolute workspace root).
 * Returns the deck-local manifest path.
 */
export async function writeManifest(
	root: string,
	basePath: string,
	entries: readonly StagingManifestEntry[],
): Promise<string> {
	assertSafeRelativePath(basePath, "basePath");
	const manifestRel = posix.join(basePath, "manifest.json");
	const absManifest = posix.join(root, manifestRel);
	const realRoot = await resolveRealRoot(root);
	await ensureContainedDirs(realRoot, absManifest);
	const json = JSON.stringify(buildManifest(basePath, entries));
	const tmpAbs = `${absManifest}.tmp-${randomUUID()}`;
	await writeOriginalExclusive(
		tmpAbs,
		new Uint8Array(Buffer.from(json, "utf8")),
	);
	await rename(tmpAbs, absManifest);
	// Post-write defense: manifest must be a regular contained file.
	const manifestStat = await lstat(absManifest);
	if (!manifestStat.isFile()) {
		throw new RangeError(`manifest is not a regular file: ${manifestRel}`);
	}
	await assertContained(root, absManifest);
	return manifestRel;
}

/** Convenience: stage many files, accumulating a deduped manifest (persisted by default). */
export async function stageMany(
	options: Omit<StageOptions, "bytes" | "name">,
	inputs: ReadonlyArray<{
		bytes: Uint8Array;
		name: string;
		declaredMime?: string;
	}>,
): Promise<{
	entries: StagingManifestEntry[];
	manifest: StagingManifest;
	manifestPath?: string;
}> {
	const basePath = options.basePath ?? DEFAULT_BASE_PATH;
	const realRoot = await resolveRealRoot(options.root);
	// Retain every validated pre-existing entry (deduped by hash and id), so the
	// persisted manifest preserves unrelated assets not touched in this batch.
	const entries: StagingManifestEntry[] = [];
	const seenHash = new Set<string>();
	const seenId = new Set<string>();
	for (const seeded of options.existing ?? []) {
		await validateExistingEntry(options.root, realRoot, seeded);
		if (seenHash.has(seeded.hash.value) || seenId.has(seeded.id)) continue;
		seenHash.add(seeded.hash.value);
		seenId.add(seeded.id);
		entries.push(seeded);
	}
	for (const input of inputs) {
		const single: StageOptions = {
			...options,
			bytes: input.bytes,
			name: input.name,
		};
		if (input.declaredMime !== undefined)
			single.declaredMime = input.declaredMime;
		const result = await stageFile({
			...single,
			existing: [...entries],
		});
		if (
			!seenHash.has(result.entry.hash.value) &&
			!seenId.has(result.entry.id)
		) {
			seenHash.add(result.entry.hash.value);
			seenId.add(result.entry.id);
			entries.push(result.entry);
		}
	}
	const manifest = buildManifest(basePath, entries);
	if (options.persistManifest !== false) {
		const manifestPath = await writeManifest(options.root, basePath, entries);
		return { entries, manifest, manifestPath };
	}
	return { entries, manifest };
}

// Re-export so consumers of the node entry can reach the shared validators.
export { validateMediaBytes } from "../sniff.js";
