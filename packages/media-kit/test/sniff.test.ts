import { describe, expect, it } from "vitest";
import {
	assertSafeSvg,
	detectImageDimensions,
	normalizeMime,
	sniffMime,
	validateMediaBytes,
} from "../src/sniff.js";
import {
	makeAvifHeader,
	makeGif,
	makeJpeg,
	makeMp4Header,
	makePng,
	makePngHeader,
	makeSvg,
	makeWebmHeader,
	makeWebp,
} from "./fixtures.js";

describe("sniffMime", () => {
	it("identifies each supported format from magic bytes", () => {
		expect(sniffMime(makePng(4, 6))).toBe("image/png");
		expect(sniffMime(makeJpeg(8, 5))).toBe("image/jpeg");
		expect(sniffMime(makeGif(3, 7))).toBe("image/gif");
		expect(sniffMime(makeWebp(320, 240))).toBe("image/webp");
		expect(sniffMime(makeAvifHeader())).toBe("image/avif");
		expect(sniffMime(makeMp4Header())).toBe("video/mp4");
		expect(sniffMime(makeWebmHeader())).toBe("video/webm");
	});

	it("identifies SVG from text bytes", () => {
		expect(sniffMime(makeSvg(120, 80))).toBe("image/svg+xml");
	});

	it("rejects empty and unrecognized payloads", () => {
		expect(() => sniffMime(new Uint8Array())).toThrow(RangeError);
		expect(() => sniffMime(Uint8Array.from([0x00, 0x01, 0x02]))).toThrow(
			RangeError,
		);
	});

	it("requires a Uint8Array", () => {
		expect(() => sniffMime([] as unknown as Uint8Array)).toThrow(TypeError);
	});
});

describe("detectImageDimensions", () => {
	it("reads PNG dimensions", () => {
		expect(detectImageDimensions(makePng(48, 36), "image/png")).toEqual({
			width: 48,
			height: 36,
		});
	});

	it("reads JPEG dimensions", () => {
		expect(detectImageDimensions(makeJpeg(64, 48), "image/jpeg")).toEqual({
			width: 64,
			height: 48,
		});
	});

	it("reads GIF dimensions", () => {
		expect(detectImageDimensions(makeGif(10, 20), "image/gif")).toEqual({
			width: 10,
			height: 20,
		});
	});

	it("reads SVG dimensions", () => {
		expect(detectImageDimensions(makeSvg(200, 150), "image/svg+xml")).toEqual({
			width: 200,
			height: 150,
		});
	});

	it("returns null for video types", () => {
		expect(detectImageDimensions(makeMp4Header(), "video/mp4")).toBeNull();
	});
});

describe("assertSafeSvg", () => {
	it("accepts a clean SVG", () => {
		expect(() => assertSafeSvg("<svg><rect/></svg>")).not.toThrow();
	});

	it("allows an internal-fragment <use> reference", () => {
		expect(() =>
			assertSafeSvg('<svg><defs><rect id="r"/></defs><use href="#r"/></svg>'),
		).not.toThrow();
	});

	it.each([
		["<svg><script>alert(1)</script></svg>", "script"],
		["<svg><script/>x</svg>", "self-closing script"],
		["<svg><rect onclick='x'/></svg>", "inline handler"],
		["<svg><a xlink:href='javascript:alert(1)'/></svg>", "javascript url"],
		["<svg><image href='data:image/png;base64,xxx'/></svg>", "data url"],
		["<svg><foreignObject/></svg>", "foreignObject"],
		["<svg><style>@import 'x'</style></svg>", "style import"],
		["<svg><style>.a{background:url(x)}</style></svg>", "style url"],
		["<svg><use xlink:href='http://evil/x'/></svg>", "external use"],
		["<svg><image src='//evil/x'/></svg>", "external image src"],
		["<!DOCTYPE svg><svg/>", "doctype"],
		["<svg><!ENTITY x 'y'/></svg>", "entity"],
		["<svg><a xlink:href='vbscript:x'/></svg>", "vbscript url"],
	])("rejects unsafe SVG (%s)", (svg) => {
		expect(() => assertSafeSvg(svg)).toThrow(RangeError);
	});
});

describe("validateMediaBytes", () => {
	it("returns mime and dimensions for a valid image", () => {
		const result = validateMediaBytes(makePng(32, 24));
		expect(result.mime).toBe("image/png");
		expect(result.bytes).toBe(makePng(32, 24).length);
		expect(result.width).toBe(32);
		expect(result.height).toBe(24);
	});

	it("rejects MIME spoofing when declared type disagrees with bytes", () => {
		const png = makePng(4, 4);
		expect(() =>
			validateMediaBytes(png, { declaredMime: "image/jpeg" }),
		).toThrow(/spoof/);
		// Matching declared type is accepted (params stripped).
		expect(() =>
			validateMediaBytes(png, { declaredMime: "image/png; charset=binary" }),
		).not.toThrow();
	});

	it("enforces a byte cap", () => {
		const png = makePng(4, 4);
		expect(() => validateMediaBytes(png, { maxBytes: png.length - 1 })).toThrow(
			/maxBytes/,
		);
	});

	it("enforces a pixel cap", () => {
		const png = makePngHeader(4000, 4000);
		expect(() => validateMediaBytes(png, { maxPixels: 1_000_000 })).toThrow(
			/maxPixels/,
		);
	});

	it("rejects unsafe SVG bytes", () => {
		const svg = Uint8Array.from(
			Buffer.from("<svg><script>x</script></svg>", "utf8"),
		);
		expect(() => validateMediaBytes(svg)).toThrow(RangeError);
	});
});

describe("normalizeMime", () => {
	it("trims, lowercases, and drops parameters", () => {
		expect(normalizeMime("  IMAGE/PNG; charset=binary  ")).toBe("image/png");
	});
});
