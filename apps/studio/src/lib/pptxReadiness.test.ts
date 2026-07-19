import { describe, expect, it } from "vitest";
import { applySlidePptxIntent, readSlidePptxIntent } from "./pptxReadiness";

describe("Studio PPTX slide intent", () => {
  const html = '<main class="deck-stage"><section class="slide" data-slide-id="s1"></section><section class="slide" data-slide-id="s2" data-pptx-intent="hybrid"></section></main>';

  it("reads and persists native, hybrid, and raster intent", () => {
    expect(readSlidePptxIntent(html, 0)).toBe(""); expect(readSlidePptxIntent(html, 1)).toBe("hybrid");
    const native = applySlidePptxIntent(html, 0, "native-oriented"); expect(readSlidePptxIntent(native, 0)).toBe("native-oriented");
    const raster = applySlidePptxIntent(native, 0, "raster"); expect(readSlidePptxIntent(raster, 0)).toBe("raster");
    expect(readSlidePptxIntent(applySlidePptxIntent(raster, 0, ""), 0)).toBe("");
  });

  it("rejects a missing slide", () => {
    expect(() => applySlidePptxIntent(html, 3, "hybrid")).toThrow(/does not exist/);
  });
});
