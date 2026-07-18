import { describe, expect, it } from "vitest";
import { normalizeDeck } from "./normalizeDeck";

describe("normalizeDeck", () => {
  it("prefers canonical top-level section slides and avoids nested double wrapping", () => {
    const result = normalizeDeck('<html><head></head><body><section class="slide"><section class="slide">nested</section></section><section class="slide">two</section></body></html>');
    expect(result.strategy).toBe("section.slide");
    expect(result.slideCount).toBe(2);
  });
  it("keeps continuous prose as a document", () => {
    const result = normalizeDeck(`<html><head></head><body><article>${"Long prose ".repeat(150)}</article></body></html>`);
    expect(result.strategy).toBe("document");
    expect(result.warnings[0]).toMatch(/Continuous prose/);
  });
  it("assigns stable IDs to imported objects", () => {
    const result = normalizeDeck('<html><head></head><body><div class="slide"><h1>Hello</h1><p>World</p></div><div class="slide"><h2>Two</h2></div></body></html>');
    expect(result.html).toContain('data-slide-id="slide-01"');
    expect(result.html).toContain('data-object-id="slide-01-object-01"');
  });
  it("preserves an imported stage intrinsic size instead of forcing 1920 by 1080", () => {
    const result = normalizeDeck('<html><head><style>.canvas{width:1280px;height:720px}</style></head><body><main class="canvas"><section class="slide">One</section><section class="slide">Two</section></main></body></html>');
    expect(result.html).toContain('class="canvas deck-stage"');
    expect(result.html).not.toContain('.deck-stage{position:absolute;width:1920px');
    expect(result.html).not.toContain('data-studio-default-stage="true"');
  });
});
