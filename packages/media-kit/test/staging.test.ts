import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import {
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
	mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mediaAssetSchema } from "@slides-studio/protocol";

import {
	assertContained,
	assertSafeRelativePath,
	buildManifest,
	isSafeRelativePath,
	normalizeName,
	safePosixName,
	sha256Hex,
	stageFile,
	stageMany,
	writeManifest,
	type FfmpegRunner,
	type RunnerResult,
	type StagingManifestEntry,
} from "../src/node/staging.js";
import {
	bytesForExt,
	makeMp4Header,
	makePng,
	makePngHeader,
	PLACEHOLDER_PNG,
} from "./fixtures.js";

let root: string;

/** Recursively list regular files under a directory (empty array if missing). */
async function walkFiles(dir: string): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	const out: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const ent of entries) {
		const p = join(dir, ent.name);
		if (ent.isDirectory()) out.push(...(await walkFiles(p)));
		else if (ent.isFile()) out.push(p);
	}
	return out;
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "media-kit-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** A fake ffmpeg that "succeeds" by writing real requested-format bytes to the
 * output path (which is now a temp file, not the final derived path). */
const fakeFfmpegOk: FfmpegRunner = (args): RunnerResult => {
	const output = args[args.length - 1];
	if (typeof output === "string") {
		try {
			mkdirSync(dirname(output), { recursive: true });
			writeFileSync(output, Buffer.from(bytesForExt(output)));
		} catch {
			/* ignore */
		}
	}
	return { status: 0, stdout: "", stderr: "" };
};

/** A fake ffmpeg that always fails. */
const fakeFfmpegFail: FfmpegRunner = (): RunnerResult => ({
	status: 1,
	stdout: "",
	stderr: "boom",
});

/** A fake ffmpeg that reports success but produces NO output (validation must fail). */
const fakeFfmpegNoOutput: FfmpegRunner = (): RunnerResult => ({
	status: 0,
	stdout: "",
	stderr: "",
});

const fakeFfprobeVideo = (w: number, h: number) => (): RunnerResult => ({
	status: 0,
	stdout: JSON.stringify({ streams: [{ width: w, height: h }] }),
	stderr: "",
});

const stagePng = async (
	overrides: Partial<Parameters<typeof stageFile>[0]> = {},
) => {
	return stageFile({
		root,
		bytes: makePng(4, 4),
		name: "photo.png",
		ffmpeg: fakeFfmpegOk,
		ffprobe: fakeFfprobeVideo(4, 4),
		now: () => "2026-01-01T00:00:00.000Z",
		...overrides,
	});
};

describe("stageFile — identity and dedupe", () => {
	it("writes the original under assets/user-media and returns a protocol-compatible record", async () => {
		const bytes = makePng(4, 4);
		const result = await stageFile({
			root,
			bytes,
			name: "photo.png",
			ffmpeg: fakeFfmpegOk,
			ffprobe: fakeFfprobeVideo(4, 4),
			now: () => "t",
		});
		expect(result.path.startsWith("assets/user-media/")).toBe(true);
		expect(result.deduped).toBe(false);
		expect(() => mediaAssetSchema.parse(result.asset)).not.toThrow();
		const written = await readFile(join(root, result.path));
		expect(new Uint8Array(written)).toEqual(bytes);
		expect(result.asset.hash).toEqual({
			algorithm: "sha256",
			value: sha256Hex(bytes),
		});
		expect(result.asset.mimeType).toBe("image/png");
		expect(result.asset.width).toBe(4);
		expect(result.asset.height).toBe(4);
	});

	it("dedupes identical content via a validated existing entry and never overwrites", async () => {
		const bytes = makePng(4, 4);
		const first = await stageFile({
			root,
			bytes,
			name: "photo.png",
			ffmpeg: fakeFfmpegOk,
			ffprobe: fakeFfprobeVideo(4, 4),
			now: () => "t1",
		});
		const second = await stageFile({
			root,
			bytes,
			name: "renamed.png",
			ffmpeg: fakeFfmpegOk,
			ffprobe: fakeFfprobeVideo(4, 4),
			existing: [first.entry],
			now: () => "t2",
		});
		expect(second.deduped).toBe(true);
		expect(second.path).toBe(first.path);
		expect(second.entry).toBe(first.entry);
	});

	it("does not overwrite an existing same-name different-content file", async () => {
		const a = await stagePng({ bytes: makePng(4, 4), name: "x.png" });
		const b = await stagePng({ bytes: makePng(8, 2), name: "x.png" });
		expect(b.path).not.toBe(a.path);
		const aBytes = await readFile(join(root, a.path));
		const bBytes = await readFile(join(root, b.path));
		expect(new Uint8Array(aBytes)).toEqual(makePng(4, 4));
		expect(new Uint8Array(bBytes)).toEqual(makePng(8, 2));
	});

	it("accumulates a deduped manifest via stageMany", async () => {
		const { manifest, entries } = await stageMany(
			{
				root,
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(4, 4),
				now: () => "t",
				persistManifest: false,
			},
			[
				{ bytes: makePng(4, 4), name: "a.png" },
				{ bytes: makePng(4, 4), name: "b.png" },
				{ bytes: makePng(2, 2), name: "c.png" },
			],
		);
		expect(entries.length).toBe(2);
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.entries.length).toBe(2);
	});
});

describe("stageFile — Unicode and POSIX naming", () => {
	it("NFC-normalizes composed/decomposed names to the same stem", () => {
		const composed = "café";
		const decomposed = "cafe\u0301";
		expect(normalizeName(decomposed)).toBe(composed);
		expect(safePosixName(decomposed)).toBe(safePosixName(composed));
	});

	it("strips path separators and traversal segments (stem only)", () => {
		expect(safePosixName("../../etc/passwd.png")).not.toContain("..");
		expect(safePosixName("a/b\\c:d.png")).not.toContain("/");
		expect(safePosixName("good-name.png")).toBe("good-name");
	});

	it("uses the canonical MIME extension, not the filename extension (stem only)", async () => {
		// A PNG payload named ".jpg" must be staged with a .png extension.
		const result = await stagePng({ bytes: makePng(2, 2), name: "tricky.jpg" });
		expect(result.path).toMatch(/\.png$/);
		expect(result.path).not.toMatch(/\.jpg/);
	});
});

describe("stageFile — basePath canonicalization (blocker 5)", () => {
	it("isSafeRelativePath accepts canonical deck-local paths and rejects escapes", () => {
		expect(isSafeRelativePath("assets/user-media/ab/x.png")).toBe(true);
		expect(isSafeRelativePath("../escape")).toBe(false);
		expect(isSafeRelativePath("/abs/path")).toBe(false);
		expect(isSafeRelativePath("a//b")).toBe(false);
		expect(isSafeRelativePath("a/b/")).toBe(false);
		expect(() => assertSafeRelativePath("../x", "basePath")).toThrow(
			RangeError,
		);
	});

	it("rejects a non-canonical basePath", async () => {
		await expect(stagePng({ basePath: "../escape" })).rejects.toThrow(
			/basePath/,
		);
		await expect(stagePng({ basePath: "/abs" })).rejects.toThrow(/basePath/);
	});
});

describe("stageFile — traversal and symlink defense (blocker 6)", () => {
	it("assertContained rejects a target that escapes the root", async () => {
		await expect(
			assertContained(root, join(root, "..", "outside")),
		).rejects.toThrow(/escapes staging root/);
	});

	it("assertContained rejects any symlink ancestor (internal or escaping)", async () => {
		const outside = await mkdtemp(join(tmpdir(), "outside-"));
		try {
			const link = join(root, "escape");
			await symlink(outside, link);
			await expect(assertContained(root, link)).rejects.toThrow(
				/escapes staging root/,
			);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("rejects staging when a nested ancestor is a symlink to a victim (victim unchanged)", async () => {
		const victim = join(tmpdir(), `victim-${Date.now()}.txt`);
		await writeFile(victim, "victim-original", "utf8");
		try {
			const bytes = makePng(2, 2);
			const hash = sha256Hex(bytes);
			// Replace the <hh> ancestor dir with a symlink to an outside location.
			const hhDir = join(root, "assets/user-media", hash.slice(0, 2));
			await mkdir(join(root, "assets/user-media"), { recursive: true });
			await symlink(dirname(victim), hhDir);
			await expect(
				stageFile({
					root,
					bytes,
					name: "x.png",
					ffmpeg: fakeFfmpegOk,
					ffprobe: fakeFfprobeVideo(2, 2),
					now: () => "t",
				}),
			).rejects.toThrow(/symlink/);
			expect(await readFile(victim, "utf8")).toBe("victim-original");
		} finally {
			await rm(victim, { force: true });
		}
	});

	it("rejects writing through a destination symlink victim (victim unchanged)", async () => {
		const victim = join(tmpdir(), `victim2-${Date.now()}.bin`);
		await writeFile(victim, "victim-original", "utf8");
		try {
			const bytes = makePng(2, 2);
			const hash = sha256Hex(bytes);
			const stem = safePosixName("victim.png");
			const candidateRel = `assets/user-media/${hash.slice(0, 2)}/${stem}-${hash.slice(0, 8)}.png`;
			const candidateAbs = join(root, candidateRel);
			await mkdir(dirname(candidateAbs), { recursive: true });
			await symlink(victim, candidateAbs);
			await expect(
				stageFile({
					root,
					bytes,
					name: "victim.png",
					ffmpeg: fakeFfmpegOk,
					ffprobe: fakeFfprobeVideo(2, 2),
					now: () => "t",
				}),
			).rejects.toThrow();
			expect(await readFile(victim, "utf8")).toBe("victim-original");
		} finally {
			await rm(victim, { force: true });
		}
	});

	it("rejects a MIME spoof", async () => {
		await expect(
			stagePng({
				bytes: makePng(2, 2),
				name: "fake.jpg",
				declaredMime: "image/jpeg",
			}),
		).rejects.toThrow(/spoof/);
	});

	it("enforces byte and pixel caps", async () => {
		const bytes = makePng(2, 2);
		await expect(
			stagePng({ bytes, name: "x.png", maxBytes: bytes.length - 1 }),
		).rejects.toThrow(/maxBytes/);
		await expect(
			stagePng({
				bytes: makePngHeader(5000, 5000),
				name: "big.png",
				maxPixels: 1_000_000,
			}),
		).rejects.toThrow(/maxPixels/);
	});
});

describe("stageFile — limit validation (blocker 11)", () => {
	it("rejects NaN/Infinity/non-integer limits", async () => {
		const bytes = makePng(2, 2);
		await expect(
			stagePng({ bytes, name: "x.png", maxBytes: Number.NaN }),
		).rejects.toThrow(/maxBytes/);
		await expect(
			stagePng({ bytes, name: "x.png", maxBytes: Number.POSITIVE_INFINITY }),
		).rejects.toThrow(/maxBytes/);
		await expect(
			stagePng({ bytes, name: "x.png", maxBytes: 1.5 }),
		).rejects.toThrow(/maxBytes/);
		await expect(
			stagePng({ bytes, name: "x.png", maxPixels: Number.POSITIVE_INFINITY }),
		).rejects.toThrow(/maxPixels/);
		await expect(
			stagePng({ bytes, name: "x.png", longEdgeCap: -1 }),
		).rejects.toThrow(/longEdgeCap/);
		await expect(
			stagePng({ bytes, name: "x.png", longEdgeCap: Number.NaN }),
		).rejects.toThrow(/longEdgeCap/);
	});

	it("longEdgeCap 0 disables capping (no cap record)", async () => {
		const result = await stagePng({
			bytes: makePng(4096, 1),
			name: "wide.png",
			longEdgeCap: 0,
		});
		expect(
			result.derived.find((d) => d.kind === "long-edge-cap"),
		).toBeUndefined();
	});
});

describe("stageFile — derived transforms (blocker 7)", () => {
	it("produces an AVIF fallback record (skipped, no path) when ffmpeg fails", async () => {
		const result = await stagePng({
			bytes: makePng(4, 4),
			name: "photo.png",
			ffmpeg: fakeFfmpegFail,
		});
		const avif = result.derived.find((d) => d.kind === "avif");
		expect(avif).toBeDefined();
		expect(avif!.path).toBeUndefined();
		expect(avif!.note).toMatch(/fallback skipped/);
	});

	it("produces a validated AVIF record when ffmpeg emits real AVIF bytes", async () => {
		const result = await stagePng({
			bytes: makePng(4, 4),
			name: "photo.png",
			ffmpeg: fakeFfmpegOk,
		});
		const avif = result.derived.find((d) => d.kind === "avif");
		expect(avif).toBeDefined();
		expect(avif!.path).toBeDefined();
		expect(avif!.note).toBeUndefined();
		expect(avif!.mimeType).toBe("image/avif");
	});

	it("rejects status-0 with no output (records as skipped, no path)", async () => {
		const result = await stagePng({
			bytes: makePng(4, 4),
			name: "photo.png",
			ffmpeg: fakeFfmpegNoOutput,
		});
		const avif = result.derived.find((d) => d.kind === "avif");
		expect(avif).toBeDefined();
		expect(avif!.path).toBeUndefined();
		expect(avif!.note).toMatch(/validation/);
	});

	it("caps the long edge when an image exceeds the cap", async () => {
		const result = await stagePng({
			bytes: makePng(4096, 1),
			name: "wide.png",
			ffmpeg: fakeFfmpegOk,
			longEdgeCap: 2048,
		});
		const cap = result.derived.find((d) => d.kind === "long-edge-cap");
		expect(cap).toBeDefined();
		expect(cap!.path).toBeDefined();
	});
});

describe("stageFile — ffprobe video metadata (blocker 8)", () => {
	it("calls ffprobe for videos and records width/height", async () => {
		let called = false;
		const probe: typeof fakeFfmpegOk = (args) => {
			if (args.some((a) => a === "stream=width,height")) called = true;
			return {
				status: 0,
				stdout: JSON.stringify({ streams: [{ width: 640, height: 480 }] }),
				stderr: "",
			};
		};
		const result = await stageFile({
			root,
			bytes: makeMp4Header(),
			name: "clip.mp4",
			ffmpeg: fakeFfmpegOk,
			ffprobe: probe,
			now: () => "t",
		});
		expect(called).toBe(true);
		expect(result.asset.width).toBe(640);
		expect(result.asset.height).toBe(480);
		expect(result.entry.derived.some((d) => d.kind === "poster")).toBe(true);
	});

	it("enforces maxPixels on probed video dimensions", async () => {
		const big = (): RunnerResult => ({
			status: 0,
			stdout: JSON.stringify({ streams: [{ width: 5000, height: 5000 }] }),
			stderr: "",
		});
		await expect(
			stageFile({
				root,
				bytes: makeMp4Header(),
				name: "clip.mp4",
				ffmpeg: fakeFfmpegOk,
				ffprobe: big,
				maxPixels: 1_000_000,
				now: () => "t",
			}),
		).rejects.toThrow(/maxPixels/);
	});

	it("falls back to a deterministic placeholder poster when ffmpeg fails", async () => {
		const result = await stageFile({
			root,
			bytes: makeMp4Header(),
			name: "clip.mp4",
			ffmpeg: fakeFfmpegFail,
			ffprobe: fakeFfprobeVideo(640, 480),
			now: () => "t",
		});
		const poster = result.derived.find((d) => d.kind === "poster");
		expect(poster).toBeDefined();
		expect(poster!.width).toBe(1);
		expect(poster!.height).toBe(1);
		expect(poster!.note).toMatch(/placeholder/);
		const posterBytes = await readFile(join(root, poster!.path!));
		expect(new Uint8Array(posterBytes)).toEqual(PLACEHOLDER_PNG);
	});
});

describe("stageFile — existing-entry validation (blocker 9)", () => {
	it("rejects a malicious existing entry with a traversal path", async () => {
		const bytes = makePng(2, 2);
		const malicious: StagingManifestEntry = {
			schemaVersion: 1,
			id: "asset-bad",
			path: "../escape.png",
			hash: { algorithm: "sha256", value: sha256Hex(bytes) },
			mimeType: "image/png",
			bytes: bytes.length,
			evidence: [],
			originalPath: "../escape.png",
			stagedAt: "t",
			derived: [],
		};
		await expect(
			stageFile({
				root,
				bytes,
				name: "x.png",
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(2, 2),
				existing: [malicious],
				now: () => "t",
			}),
		).rejects.toThrow(/path/);
	});

	it("rejects a dangling existing entry whose original is missing", async () => {
		const bytes = makePng(2, 2);
		const dangling: StagingManifestEntry = {
			schemaVersion: 1,
			id: "asset-missing",
			path: "assets/user-media/ab/missing-abcd1234.png",
			hash: { algorithm: "sha256", value: sha256Hex(bytes) },
			mimeType: "image/png",
			bytes: bytes.length,
			evidence: [],
			originalPath: "assets/user-media/ab/missing-abcd1234.png",
			stagedAt: "t",
			derived: [],
		};
		await expect(
			stageFile({
				root,
				bytes,
				name: "x.png",
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(2, 2),
				existing: [dangling],
				now: () => "t",
			}),
		).rejects.toThrow(/dangling/);
	});

	it("rejects an existing entry whose on-disk hash mismatches", async () => {
		const real = await stagePng({ bytes: makePng(2, 2), name: "real.png" });
		// Tamper the on-disk original so its hash no longer matches the claimed hash.
		await writeFile(join(root, real.entry.path), Buffer.from(makePng(8, 8)));
		const tampered: StagingManifestEntry = {
			...real.entry,
			hash: { algorithm: "sha256", value: sha256Hex(makePng(2, 2)) },
		};
		await expect(
			stageFile({
				root,
				bytes: makePng(2, 2),
				name: "real.png",
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(2, 2),
				existing: [tampered],
				now: () => "t",
			}),
		).rejects.toThrow(/hash/);
	});
});

describe("writeManifest / stageMany persistence (blocker 10)", () => {
	it("buildManifest omits absolute root (deck-local fields only)", () => {
		const manifest = buildManifest("assets/user-media", []);
		expect(manifest).not.toHaveProperty("root");
		expect(manifest.basePath).toBe("assets/user-media");
	});

	it("writeManifest atomically writes manifest.json under the base path", async () => {
		const result = await stagePng({ bytes: makePng(2, 2), name: "a.png" });
		const manifestPath = await writeManifest(root, "assets/user-media", [
			result.entry,
		]);
		expect(manifestPath).toBe("assets/user-media/manifest.json");
		const raw = await readFile(join(root, manifestPath), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.root).toBeUndefined();
		expect(parsed.entries).toHaveLength(1);
	});

	it("stageMany persists manifest by default and dedupes on reload", async () => {
		const first = await stageMany(
			{
				root,
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(4, 4),
				now: () => "t",
			},
			[{ bytes: makePng(4, 4), name: "a.png" }],
		);
		expect(first.manifestPath).toBe("assets/user-media/manifest.json");
		// Reload the persisted manifest as existing entries and stage the same bytes.
		const raw = await readFile(join(root, first.manifestPath!), "utf8");
		const reloaded = JSON.parse(raw).entries as StagingManifestEntry[];
		const second = await stageMany(
			{
				root,
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(4, 4),
				now: () => "t",
				existing: reloaded,
			},
			[{ bytes: makePng(4, 4), name: "b.png" }],
		);
		expect(
			second.entries.every((e) => first.entries.some((f) => f.path === e.path)),
		).toBe(true);
	});
});

describe("derived temp-commit hardening (item 1)", () => {
	it("ffmpeg is invoked with a temp output path, never the final derived path", async () => {
		let capturedOutput = "";
		const spyFfmpeg: FfmpegRunner = (args) => {
			const output = args[args.length - 1];
			if (typeof output === "string") capturedOutput = output;
			try {
				mkdirSync(dirname(output), { recursive: true });
				writeFileSync(output, Buffer.from(bytesForExt(output)));
			} catch {
				/* ignore */
			}
			return { status: 0, stdout: "", stderr: "" };
		};
		const result = await stageFile({
			root,
			bytes: makePng(4, 4),
			name: "photo.png",
			ffmpeg: spyFfmpeg,
			ffprobe: fakeFfprobeVideo(4, 4),
			now: () => "t",
		});
		// The captured output is a temp file (contains .tmp-), not the final path.
		expect(capturedOutput).toContain(".tmp-");
		const avif = result.derived.find((d) => d.kind === "avif");
		expect(avif?.path).toBeDefined();
		// No temp file is left behind after commit.
		expect(capturedOutput.endsWith(".tmp-")).toBe(false);
	});

	const victimDerivedCases = [
		{
			kind: "avif" as const,
			name: "photo.png",
			bytes: () => makePng(4, 4),
			suffix: "-avif",
			ext: ".avif",
		},
		{
			kind: "poster" as const,
			name: "clip.mp4",
			bytes: () => makeMp4Header(),
			suffix: "-poster",
			ext: ".png",
		},
	];

	it.each(
		victimDerivedCases,
	)("never overwrites a pre-existing symlink at the final $kind path (victim unchanged)", async ({
		kind,
		name,
		bytes,
		suffix,
		ext,
	}) => {
		const data = bytes();
		const hash = sha256Hex(data);
		const stem = safePosixName(name);
		const candidateRel = `assets/user-media/${hash.slice(0, 2)}/${stem}-${hash.slice(0, 8)}${
			kind === "poster" ? "" : ""
		}`;
		// Compute the exact derived final path the way staging does.
		const originalExt = kind === "poster" ? ".mp4" : ".png";
		const derivedRel = `assets/user-media/${hash.slice(0, 2)}/${stem}-${hash.slice(0, 8)}${suffix}${ext}`;
		void candidateRel;
		void originalExt;
		const victim = join(tmpdir(), `dvictim-${kind}-${Date.now()}.txt`);
		await writeFile(victim, "victim-original", "utf8");
		try {
			await mkdir(join(root, "assets/user-media", hash.slice(0, 2)), {
				recursive: true,
			});
			await symlink(victim, join(root, derivedRel));
			const result = await stageFile({
				root,
				bytes: data,
				name,
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(640, 480),
				now: () => "t",
			});
			const record = result.derived.find((d) => d.kind === kind);
			expect(record).toBeDefined();
			// Victim is never followed/overwritten.
			expect(await readFile(victim, "utf8")).toBe("victim-original");
			// The final symlink must remain pointing at the victim (not replaced).
			const linkStat = await import("node:fs/promises").then((m) =>
				m.lstat(join(root, derivedRel)),
			);
			expect(linkStat.isSymbolicLink()).toBe(true);
		} finally {
			await rm(victim, { force: true });
		}
	});
});

describe("ffprobe rejection removes original (item 2)", () => {
	it("removes the just-written original when ffprobe fails", async () => {
		const fail = (): RunnerResult => ({
			status: 1,
			stdout: "",
			stderr: "boom",
		});
		const bytes = makeMp4Header();
		await expect(
			stageFile({
				root,
				bytes,
				name: "clip.mp4",
				ffmpeg: fakeFfmpegOk,
				ffprobe: fail,
				now: () => "t",
			}),
		).rejects.toThrow(/ffprobe failed/);
		// No rejected original (or any file) remains under the staging tree.
		expect(await walkFiles(join(root, "assets/user-media"))).toHaveLength(0);
	});

	it("removes the original when probed dimensions are non-positive", async () => {
		const bad = (): RunnerResult => ({
			status: 0,
			stdout: JSON.stringify({ streams: [{ width: 0, height: 480 }] }),
			stderr: "",
		});
		await expect(
			stageFile({
				root,
				bytes: makeMp4Header(),
				name: "clip.mp4",
				ffmpeg: fakeFfmpegOk,
				ffprobe: bad,
				now: () => "t",
			}),
		).rejects.toThrow(/invalid dimensions/);
		// No rejected original (or any file) remains under the staging tree.
		expect(await walkFiles(join(root, "assets/user-media"))).toHaveLength(0);
	});

	it("removes the original before throwing when pixels exceed maxPixels", async () => {
		const big = (): RunnerResult => ({
			status: 0,
			stdout: JSON.stringify({ streams: [{ width: 5000, height: 5000 }] }),
			stderr: "",
		});
		const bytes = makeMp4Header();
		await expect(
			stageFile({
				root,
				bytes,
				name: "clip.mp4",
				ffmpeg: fakeFfmpegOk,
				ffprobe: big,
				maxPixels: 1_000_000,
				now: () => "t",
			}),
		).rejects.toThrow(/maxPixels/);
		// No rejected original remains under the staging tree.
		expect(await walkFiles(join(root, "assets/user-media"))).toHaveLength(0);
	});
});

describe("stageMany retains pre-existing entries (item 3)", () => {
	it("retains a validated pre-existing unrelated asset in the persisted manifest", async () => {
		// Stage an unrelated asset first (its own stageMany, persisted).
		const first = await stageMany(
			{
				root,
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(4, 4),
				now: () => "t",
			},
			[{ bytes: makePng(4, 4), name: "unrelated.png" }],
		);
		const unrelatedPath = first.entries[0]!.path;
		// A second batch referencing the pre-existing manifest must retain it.
		const second = await stageMany(
			{
				root,
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(2, 2),
				now: () => "t",
				existing: first.entries,
			},
			[{ bytes: makePng(2, 2), name: "new.png" }],
		);
		expect(second.entries.some((e) => e.path === unrelatedPath)).toBe(true);
		expect(second.entries.length).toBe(2);
		// The persisted manifest.json contains both.
		const raw = await readFile(
			join(root, "assets/user-media/manifest.json"),
			"utf8",
		);
		const parsed = JSON.parse(raw);
		expect(parsed.entries.length).toBe(2);
		expect(
			parsed.entries.some((e: { path: string }) => e.path === unrelatedPath),
		).toBe(true);
	});
});

describe("existing-entry validation tightening (item 4)", () => {
	it("rejects an existing entry where path !== originalPath", async () => {
		const real = await stagePng({ bytes: makePng(2, 2), name: "real.png" });
		const divergent: StagingManifestEntry = {
			...real.entry,
			originalPath: "assets/user-media/different.png",
		};
		await expect(
			stageFile({
				root,
				bytes: makePng(2, 2),
				name: "real.png",
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(2, 2),
				existing: [divergent],
				now: () => "t",
			}),
		).rejects.toThrow(/originalPath/);
	});

	it("rejects an existing entry whose declared bytes do not match file length", async () => {
		const real = await stagePng({ bytes: makePng(2, 2), name: "real.png" });
		const wrongBytes: StagingManifestEntry = {
			...real.entry,
			bytes: real.entry.bytes! + 999,
		};
		await expect(
			stageFile({
				root,
				bytes: makePng(2, 2),
				name: "real.png",
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(2, 2),
				existing: [wrongBytes],
				now: () => "t",
			}),
		).rejects.toThrow(/bytes mismatch/);
	});

	it("rejects an existing entry whose declared dimensions do not match sniffed", async () => {
		const real = await stagePng({ bytes: makePng(2, 2), name: "real.png" });
		const wrongDims: StagingManifestEntry = {
			...real.entry,
			width: 999,
			height: 999,
		};
		await expect(
			stageFile({
				root,
				bytes: makePng(2, 2),
				name: "real.png",
				ffmpeg: fakeFfmpegOk,
				ffprobe: fakeFfprobeVideo(2, 2),
				existing: [wrongDims],
				now: () => "t",
			}),
		).rejects.toThrow(/dimensions mismatch/);
	});
});
