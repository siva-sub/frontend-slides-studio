import { beforeEach, describe, expect, it } from "vitest";
import { collectRenderedAudit } from "../src/browser.js";

function box(element: Element, rect: { x: number; y: number; width: number; height: number }, dimensions: Partial<{ offsetWidth: number; offsetHeight: number; clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number }> = {}): void {
  const value = { ...rect, top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON() { return this; } };
  Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => value });
  for (const [name, propertyValue] of Object.entries({ offsetWidth: rect.width, offsetHeight: rect.height, clientWidth: rect.width, clientHeight: rect.height, scrollWidth: rect.width, scrollHeight: rect.height, ...dimensions })) Object.defineProperty(element, name, { configurable: true, value: propertyValue });
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-export-state");
  Object.defineProperty(document, "getAnimations", { configurable: true, value: () => [] });
});

describe("rendered browser quality audit", () => {
  it("detects rendered geometry, assets, collisions, clone safety, IDs, and settlement", () => {
    document.body.innerHTML = '<main class="deck-stage"><section class="slide" data-slide-id="s1"><div id="dup"></div><div id="dup"></div><p data-object-id="text">Overflow text</p><div data-object-id="a"></div><div data-object-id="b"></div><div data-object-id="clipped"></div><img data-object-id="media" src="/missing.png"><div data-connector="true" data-connector-source="text"></div><div data-transition-clone><button data-object-id="clone">Unsafe</button></div></section></main>';
    const stage = document.querySelector(".deck-stage")!; const slide = document.querySelector(".slide")!;
    box(stage, { x: 0, y: 0, width: 1000, height: 560 });
    box(slide, { x: 0, y: 0, width: 1000, height: 560 }, { offsetWidth: 900, offsetHeight: 500, scrollWidth: 1100, scrollHeight: 600 });
    const text = document.querySelector('[data-object-id="text"]')!; box(text, { x: 20, y: 20, width: 140, height: 40 }, { scrollWidth: 220, scrollHeight: 70 });
    const a = document.querySelector('[data-object-id="a"]')!; box(a, { x: 220, y: 100, width: 180, height: 140 });
    const b = document.querySelector('[data-object-id="b"]')!; box(b, { x: 300, y: 150, width: 180, height: 140 });
    const clipped = document.querySelector('[data-object-id="clipped"]')!; box(clipped, { x: 940, y: 40, width: 120, height: 80 });
    const media = document.querySelector("img")!; box(media, { x: 900, y: 480, width: 160, height: 120 });
    Object.defineProperty(media, "complete", { configurable: true, value: false });
    Object.defineProperty(media, "naturalWidth", { configurable: true, value: 0 });
    const connector = document.querySelector("[data-connector]")!; box(connector, { x: 250, y: 120, width: 30, height: 30 });
    const clone = document.querySelector("[data-transition-clone]")!; box(clone, { x: 0, y: 0, width: 1000, height: 560 });
    box(clone.querySelector("button")!, { x: 10, y: 10, width: 10, height: 10 });
    Object.defineProperty(document, "getAnimations", { configurable: true, value: () => [{ playState: "running" }] });

    const report = collectRenderedAudit({ id: "rendered", canvas: { width: 1000, height: 560 }, strict: true, requireSettled: true });
    const categories = new Set(report.issues.map((issue) => issue.category));
    for (const category of ["stage-bounds", "text-overflow", "media-bounds", "object-overlap", "connector-collision", "missing-asset", "unsafe-clone-content", "export-settlement", "duplicate-id", "clipped-content", "scroll-overflow"] as const) expect(categories.has(category), category).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.summary.hard).toBeGreaterThan(0);
  });

  it("respects intentional overlap declarations and clean settlement", () => {
    document.body.innerHTML = '<main class="deck-stage"><section class="slide" data-slide-id="s1"><div data-object-id="a" data-overlap-group="intentional"></div><div data-object-id="b" data-overlap-group="intentional"></div></section></main>';
    const stage = document.querySelector(".deck-stage")!; const slide = document.querySelector(".slide")!;
    box(stage, { x: 0, y: 0, width: 1280, height: 720 }); box(slide, { x: 0, y: 0, width: 1280, height: 720 });
    document.querySelectorAll("[data-object-id]").forEach((element) => box(element, { x: 100, y: 100, width: 200, height: 100 }));
    document.documentElement.dataset.exportState = "settled";
    const report = collectRenderedAudit({ id: "clean", canvas: { width: 1280, height: 720 }, requireSettled: true });
    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("ignores overlapping diagram primitives from the same source object", () => {
    document.body.innerHTML = '<main class="deck-stage"><section class="slide" data-slide-id="diagram"><div data-object-id="shape" data-source-id="node-a"></div><div data-object-id="label" data-source-id="node-a"></div></section></main>';
    const stage = document.querySelector(".deck-stage")!; const slide = document.querySelector(".slide")!;
    box(stage, { x: 0, y: 0, width: 1280, height: 720 }); box(slide, { x: 0, y: 0, width: 1280, height: 720 });
    document.querySelectorAll("[data-object-id]").forEach((element) => box(element, { x: 100, y: 100, width: 240, height: 120 }));
    const report = collectRenderedAudit({ id: "diagram", canvas: { width: 1280, height: 720 } });
    expect(report.issues.filter((issue) => issue.category === "object-overlap")).toEqual([]);
  });

  it("uses the source index when a filtered slide has no explicit ID", () => {
    document.body.innerHTML = '<main class="deck-stage"><section class="slide"></section><section class="slide"><div data-object-id="clipped"></div></section></main>';
    const stage = document.querySelector(".deck-stage")!;
    box(stage, { x: 0, y: 0, width: 1280, height: 720 });
    document.querySelectorAll(".slide").forEach((slide) => box(slide, { x: 0, y: 0, width: 1280, height: 720 }));
    box(document.querySelector('[data-object-id="clipped"]')!, { x: 1270, y: 100, width: 40, height: 40 });
    const report = collectRenderedAudit({ id: "second", canvas: { width: 1280, height: 720 }, slideIndex: 1 });
    expect(report.issues.find((issue) => issue.category === "clipped-content")?.slideId).toBe("slide-2");
  });
});
