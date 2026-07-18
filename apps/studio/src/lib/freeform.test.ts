import { describe, expect, it } from "vitest";
import { snapPoint, snapRect } from "./freeform";
import { deleteSlide, duplicateSlide, reorderSlide, toggleSlideSkipped } from "./deckOperations";

describe("freeform editor helpers", () => {
  it("snaps to sibling centers and allows Alt-style bypass", () => { expect(snapPoint(49, 51, [{ x: 0, y: 0, width: 100, height: 100 }], 8, 6).x).toBe(50); expect(snapPoint(49, 51, [], 8, 6, true)).toEqual({ x: 49, y: 51, guides: [] }); });
  it("aligns a moving rectangle edge without changing its size", () => { const result = snapRect({ x: 102, y: 20, width: 40, height: 20 }, [{ x: 0, y: 0, width: 100, height: 100 }], 8, 6); expect(result.x).toBe(100); expect(result.guides.some((guide) => guide.axis === "x")).toBe(true); });
  it("duplicates slides with new stable IDs", () => { const html = duplicateSlide('<html><body><section class="slide" data-slide-id="s"><h1 data-object-id="s-title">A</h1></section></body></html>', 0); expect(html).toContain('data-slide-id="s-copy"'); expect(html).toContain('data-object-id="s-copy-title"'); });
  it("deletes, reorders, and skips without losing a page silently", () => { const html = '<html><body><section class="slide" data-slide-id="a">A</section><section class="slide" data-slide-id="b">B</section></body></html>'; expect(reorderSlide(html, 1, 0).indexOf('data-slide-id="b"')).toBeLessThan(reorderSlide(html, 1, 0).indexOf('data-slide-id="a"')); expect(toggleSlideSkipped(html, 0)).toContain('data-slide-skipped="true"'); expect(deleteSlide(html, 0)).not.toContain('data-slide-id="a"'); expect(() => deleteSlide('<html><body><section class="slide">A</section></body></html>', 0)).toThrow(); });
});
