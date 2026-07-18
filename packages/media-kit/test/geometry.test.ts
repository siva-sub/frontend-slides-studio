import { describe, expect, it } from "vitest";
import {
	computePlacement,
	computePlacementNormalized,
	destinationToSource,
	MAX_ZOOM,
	placementFromContainCrop,
	placementFromCoverCrop,
	reframePlacement,
	roundRect,
	type PlacementResult,
} from "../src/geometry.js";

const approx = (actual: number, expected: number, epsilon = 1e-6): void => {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
};

const aspect = (rect: { width: number; height: number }): number =>
	rect.width / rect.height;

/** Reconstruct the visible source crop implied by the CSS metadata. */
function cssImpliedCrop(result: PlacementResult): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	const { image, container } = result.css;
	return {
		x: -image.left / result.scale,
		y: -image.top / result.scale,
		width: container.width / result.scale,
		height: container.height / result.scale,
	};
}

describe("computePlacement — cover", () => {
	it("fills the slot exactly and crops within the source, preserving aspect", () => {
		const result = computePlacement({
			source: { width: 100, height: 100 },
			slot: { x: 0, y: 0, width: 200, height: 100 },
			fit: "cover",
		});
		expect(result.destination).toEqual({ x: 0, y: 0, width: 200, height: 100 });
		approx(aspect(result.crop), aspect(result.slot));
		expect(result.crop.x).toBeGreaterThanOrEqual(0);
		expect(result.crop.y).toBeGreaterThanOrEqual(0);
		expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(100 + 1e-9);
		expect(result.crop.y + result.crop.height).toBeLessThanOrEqual(100 + 1e-9);
		expect(result.objectFit).toBe("cover");
		approx(result.crop.x, 0);
		approx(result.crop.width, 100);
		approx(result.crop.height, 50);
		approx(result.crop.y, 25);
	});

	it("never exposes empty area even at extreme zoom-out", () => {
		const result = computePlacement({
			source: { width: 100, height: 100 },
			slot: { x: 0, y: 0, width: 200, height: 100 },
			fit: "cover",
			zoom: 0,
		});
		expect(result.destination).toEqual({ x: 0, y: 0, width: 200, height: 100 });
		expect(result.crop.x).toBeGreaterThanOrEqual(-1e-9);
		expect(result.crop.y).toBeGreaterThanOrEqual(-1e-9);
		expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(100 + 1e-9);
		expect(result.crop.y + result.crop.height).toBeLessThanOrEqual(100 + 1e-9);
		approx(aspect(result.crop), aspect(result.slot));
	});

	it("shifts the crop horizontally toward the focal point", () => {
		const left = computePlacement({
			source: { width: 200, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
			focal: { x: 0, y: 0.5 },
		});
		const right = computePlacement({
			source: { width: 200, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
			focal: { x: 1, y: 0.5 },
		});
		approx(left.crop.x, 0);
		approx(right.crop.x, 100);
		expect(right.crop.x).toBeGreaterThan(left.crop.x);
	});

	it("narrows the crop when zoomed in", () => {
		const base = computePlacement({
			source: { width: 200, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
		});
		const zoomed = computePlacement({
			source: { width: 200, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
			zoom: 2,
		});
		expect(zoomed.crop.width).toBeLessThan(base.crop.width);
		approx(zoomed.crop.width, base.crop.width / 2);
	});

	it("honours pan as an additional focal offset", () => {
		const center = computePlacement({
			source: { width: 200, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
		});
		const panned = computePlacement({
			source: { width: 200, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
			pan: { x: 0.25, y: 0 },
		});
		expect(panned.crop.x).toBeGreaterThan(center.crop.x);
	});

	it("emits a rotate transform for non-zero rotation and none for zero", () => {
		const rotated = computePlacement({
			source: { width: 100, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
			rotation: 8,
		});
		expect(rotated.transform).toBe("rotate(8deg)");
		expect(rotated.css.container.transform).toBe("rotate(8deg)");
		expect(rotated.css.container.transformOrigin).toBe("center");
		const flat = computePlacement({
			source: { width: 100, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
		});
		expect(flat.transform).toBe("");
		expect(flat.css.container.transform).toBe("");
	});
});

describe("computePlacement — contain", () => {
	it("letterboxes the source inside the slot, preserving aspect", () => {
		const result = computePlacement({
			source: { width: 100, height: 100 },
			slot: { x: 0, y: 0, width: 200, height: 100 },
			fit: "contain",
		});
		expect(result.destination.width).toBeLessThanOrEqual(200);
		expect(result.destination.height).toBeLessThanOrEqual(100);
		approx(aspect(result.destination), 1);
		approx(result.destination.x, 50);
		approx(result.crop.x, 0);
		approx(result.crop.width, 100);
		expect(result.objectFit).toBe("contain");
	});

	it("narrows the crop on zoom while keeping the display centered", () => {
		const result = computePlacement({
			source: { width: 100, height: 100 },
			slot: { x: 0, y: 0, width: 200, height: 100 },
			fit: "contain",
			zoom: 2,
		});
		approx(result.crop.width, 50);
		approx(result.crop.height, 50);
		approx(result.destination.width, 100);
		approx(result.destination.x, 50);
	});
});

describe("computePlacement — CSS reproduction metadata", () => {
	it("CSS-implied visible source crop equals result.crop for cover (incl. zoomed)", () => {
		const cases = [
			computePlacement({
				source: { width: 100, height: 100 },
				slot: { x: 0, y: 0, width: 200, height: 100 },
				fit: "cover",
			}),
			computePlacement({
				source: { width: 200, height: 100 },
				slot: { x: 0, y: 0, width: 100, height: 100 },
				fit: "cover",
				focal: { x: 0.2, y: 0.8 },
				zoom: 3,
			}),
		];
		for (const result of cases) {
			expect(roundRect(cssImpliedCrop(result))).toEqual(roundRect(result.crop));
		}
	});

	it("CSS-implied visible source crop equals result.crop for contain (incl. zoomed)", () => {
		const cases = [
			computePlacement({
				source: { width: 100, height: 100 },
				slot: { x: 0, y: 0, width: 200, height: 100 },
				fit: "contain",
			}),
			computePlacement({
				source: { width: 160, height: 90 },
				slot: { x: 0, y: 0, width: 300, height: 200 },
				fit: "contain",
				focal: { x: 0.3, y: 0.7 },
				zoom: 2.5,
			}),
		];
		for (const result of cases) {
			expect(roundRect(cssImpliedCrop(result))).toEqual(roundRect(result.crop));
		}
	});

	it("container is sized to the destination with overflow hidden", () => {
		const result = computePlacement({
			source: { width: 100, height: 100 },
			slot: { x: 10, y: 20, width: 80, height: 60 },
			fit: "cover",
		});
		expect(result.css.container.overflow).toBe("hidden");
		approx(result.css.container.width, result.destination.width);
		approx(result.css.container.height, result.destination.height);
	});
});

describe("computePlacementNormalized — crop equality across 16:9 stages", () => {
	const source = { width: 1000, height: 1000 };
	const slot = { x: 0.1, y: 0.1, width: 0.6, height: 0.5 };

	it("produces identical normalized crops at 1280x720 and 1920x1080 for cover", () => {
		const small = computePlacementNormalized({
			source,
			slot,
			canvas: { width: 1280, height: 720 },
			fit: "cover",
		});
		const large = computePlacementNormalized({
			source,
			slot,
			canvas: { width: 1920, height: 1080 },
			fit: "cover",
		});
		expect(roundRect(small.cropNormalized)).toEqual(
			roundRect(large.cropNormalized),
		);
		expect(roundRect(small.destinationNormalized)).toEqual(
			roundRect(large.destinationNormalized),
		);
	});

	it("produces identical normalized crops at 1280x720 and 1920x1080 for contain", () => {
		const small = computePlacementNormalized({
			source,
			slot,
			canvas: { width: 1280, height: 720 },
			fit: "contain",
		});
		const large = computePlacementNormalized({
			source,
			slot,
			canvas: { width: 1920, height: 1080 },
			fit: "contain",
		});
		expect(roundRect(small.cropNormalized)).toEqual(
			roundRect(large.cropNormalized),
		);
		expect(roundRect(small.destinationNormalized)).toEqual(
			roundRect(large.destinationNormalized),
		);
	});

	it("keeps normalized crops within the unit box", () => {
		const result = computePlacementNormalized({
			source,
			slot,
			canvas: { width: 1920, height: 1080 },
			fit: "cover",
		});
		expect(result.cropNormalized.x).toBeGreaterThanOrEqual(-1e-9);
		expect(result.cropNormalized.y).toBeGreaterThanOrEqual(-1e-9);
		expect(
			result.cropNormalized.x + result.cropNormalized.width,
		).toBeLessThanOrEqual(1 + 1e-9);
		expect(
			result.cropNormalized.y + result.cropNormalized.height,
		).toBeLessThanOrEqual(1 + 1e-9);
	});

	it("rejects normalized slots outside [0,1] strictly (no tolerance leak)", () => {
		expect(() =>
			computePlacementNormalized({
				source,
				slot: { x: -0.001, y: 0, width: 0.5, height: 0.5 },
				fit: "cover",
			}),
		).toThrow(RangeError);
		expect(() =>
			computePlacementNormalized({
				source,
				slot: { x: 0, y: 0, width: 0.6, height: 0.5 },
				fit: "cover",
			}),
		).not.toThrow();
		// 0.6 + 0.5 = 1.1 > 1 -> reject
		expect(() =>
			computePlacementNormalized({
				source,
				slot: { x: 0.6, y: 0, width: 0.5, height: 0.5 },
				fit: "cover",
			}),
		).toThrow(RangeError);
		// Exactly 1.0 boundary is allowed; anything beyond is rejected.
		expect(() =>
			computePlacementNormalized({
				source,
				slot: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
				fit: "cover",
			}),
		).not.toThrow();
	});
});

describe("inverse / reframe helpers", () => {
	it("round-trips a cover crop through placementFromCoverCrop", () => {
		const source = { width: 200, height: 100 };
		const slot = { x: 10, y: 10, width: 100, height: 100 };
		const original = computePlacement({
			source,
			slot,
			fit: "cover",
			focal: { x: 0.3, y: 0.6 },
			zoom: 1.5,
		});
		const reconstructed = placementFromCoverCrop(source, slot, original.crop);
		const recomputed = computePlacement(reconstructed);
		expect(roundRect(recomputed.crop)).toEqual(roundRect(original.crop));
		expect(roundRect(recomputed.destination)).toEqual(
			roundRect(original.destination),
		);
	});

	it("round-trips a contain crop through placementFromContainCrop", () => {
		const source = { width: 100, height: 100 };
		const slot = { x: 0, y: 0, width: 200, height: 100 };
		const original = computePlacement({
			source,
			slot,
			fit: "contain",
			focal: { x: 0.3, y: 0.4 },
			zoom: 2,
		});
		const reconstructed = placementFromContainCrop(source, slot, original.crop);
		const recomputed = computePlacement(reconstructed);
		expect(roundRect(recomputed.crop)).toEqual(roundRect(original.crop));
		expect(roundRect(recomputed.destination)).toEqual(
			roundRect(original.destination),
		);
	});

	it("reframePlacement overlays partial changes", () => {
		const base = {
			source: { width: 100, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover" as const,
		};
		const reframed = reframePlacement(base, { zoom: 3 });
		expect(reframed.zoom).toBe(3);
		expect(reframed.fit).toBe("cover");
	});

	it("destinationToSource maps a destination point back to source space", () => {
		const result: PlacementResult = computePlacement({
			source: { width: 200, height: 100 },
			slot: { x: 0, y: 0, width: 100, height: 100 },
			fit: "cover",
		});
		const topLeft = destinationToSource(
			{ x: result.destination.x, y: result.destination.y },
			result,
		);
		approx(topLeft.x, result.crop.x);
		approx(topLeft.y, result.crop.y);
		const bottomRight = destinationToSource(
			{
				x: result.destination.x + result.destination.width,
				y: result.destination.y + result.destination.height,
			},
			result,
		);
		approx(bottomRight.x, result.crop.x + result.crop.width);
		approx(bottomRight.y, result.crop.y + result.crop.height);
	});

	it("inverse helpers reject non-finite/non-positive/out-of-bounds crops", () => {
		const source = { width: 200, height: 100 };
		const slot = { x: 0, y: 0, width: 100, height: 100 };
		expect(() =>
			placementFromCoverCrop(source, slot, {
				x: 0,
				y: 0,
				width: 0,
				height: 50,
			}),
		).toThrow(RangeError);
		expect(() =>
			placementFromCoverCrop(source, slot, {
				x: 0,
				y: 0,
				width: Number.NaN,
				height: 50,
			}),
		).toThrow(RangeError);
		expect(() =>
			placementFromCoverCrop(source, slot, {
				x: -5,
				y: 0,
				width: 50,
				height: 50,
			}),
		).toThrow(RangeError);
		expect(() =>
			placementFromContainCrop(source, slot, {
				x: 0,
				y: 0,
				width: 300,
				height: 150,
			}),
		).toThrow(RangeError);
	});

	it("inverse helpers reject crops with mismatched aspect", () => {
		const source = { width: 200, height: 100 };
		const slot = { x: 0, y: 0, width: 100, height: 100 };
		// cover requires crop aspect == slot aspect (1.0); a 2:1 crop mismatches.
		expect(() =>
			placementFromCoverCrop(source, slot, {
				x: 0,
				y: 0,
				width: 100,
				height: 50,
			}),
		).toThrow(/aspect/);
		// contain requires crop aspect == source aspect (2.0); a 1:1 crop mismatches.
		expect(() =>
			placementFromContainCrop(source, slot, {
				x: 0,
				y: 0,
				width: 50,
				height: 50,
			}),
		).toThrow(/aspect/);
	});

	it("inverse helpers reject crops requiring zoom > MAX_ZOOM", () => {
		const source = { width: 1000, height: 1000 };
		const slot = { x: 0, y: 0, width: 100, height: 100 };
		// A tiny crop needs zoom > MAX_ZOOM (10). cover natural ~ min dimension.
		const tinyCover = { x: 0, y: 0, width: 0.5, height: 0.5 };
		expect(() => placementFromCoverCrop(source, slot, tinyCover)).toThrow(
			/zoom/,
		);
		const tinyContain = { x: 0, y: 0, width: 5, height: 5 };
		expect(() => placementFromContainCrop(source, slot, tinyContain)).toThrow(
			/zoom/,
		);
	});
});

describe("computePlacement — validation", () => {
	it("rejects non-finite inputs", () => {
		expect(() =>
			computePlacement({
				source: { width: Number.NaN, height: 100 },
				slot: { x: 0, y: 0, width: 100, height: 100 },
				fit: "cover",
			}),
		).toThrow(RangeError);
		expect(() =>
			computePlacement({
				source: { width: 100, height: 100 },
				slot: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 },
				fit: "cover",
			}),
		).toThrow(RangeError);
	});

	it("rejects non-positive dimensions", () => {
		expect(() =>
			computePlacement({
				source: { width: 0, height: 100 },
				slot: { x: 0, y: 0, width: 100, height: 100 },
				fit: "cover",
			}),
		).toThrow(RangeError);
		expect(() =>
			computePlacement({
				source: { width: 100, height: 100 },
				slot: { x: 0, y: 0, width: 100, height: 0 },
				fit: "cover",
			}),
		).toThrow(RangeError);
	});

	it("rejects negative zoom", () => {
		expect(() =>
			computePlacement({
				source: { width: 100, height: 100 },
				slot: { x: 0, y: 0, width: 100, height: 100 },
				fit: "cover",
				zoom: -1,
			}),
		).toThrow(RangeError);
	});

	it("rejects degenerate arithmetic from Number.MIN_VALUE and handles MAX_VALUE gracefully", () => {
		// A near-zero (MIN_VALUE) source yields an infinite base scale and a
		// zero-sized crop, which must be rejected rather than returned.
		expect(() =>
			computePlacement({
				source: { width: Number.MIN_VALUE, height: Number.MIN_VALUE },
				slot: { x: 0, y: 0, width: 100, height: 100 },
				fit: "cover",
			}),
		).toThrow(RangeError);
		expect(() =>
			computePlacement({
				source: { width: Number.MIN_VALUE, height: Number.MIN_VALUE },
				slot: { x: 0, y: 0, width: 100, height: 100 },
				fit: "contain",
			}),
		).toThrow(RangeError);
		// MAX_VALUE inputs with a matching slot produce finite, positive results.
		const big = computePlacement({
			source: { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
			slot: { x: 0, y: 0, width: Number.MAX_VALUE, height: Number.MAX_VALUE },
			fit: "cover",
		});
		expect(Number.isFinite(big.crop.width)).toBe(true);
		expect(Number.isFinite(big.scale)).toBe(true);
		expect(big.crop.width).toBeGreaterThan(0);
		void MAX_ZOOM;
	});
});
