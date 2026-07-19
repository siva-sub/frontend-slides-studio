import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { analyzePptxHtmlReadiness } from "../src/index.js";

const documentFor = (body: string) => parseHTML(`<!doctype html><html><body>${body}</body></html>`).document;

function codes(body: string): string[] {
  return analyzePptxHtmlReadiness(documentFor(body)).issues.map((entry) => entry.code);
}

describe("PPTX HTML readiness", () => {
  it("reports explicit native candidates and runtime-dependent text without inventing guaranteed editability", () => {
    const report = analyzePptxHtmlReadiness(documentFor(`<main class="deck-stage"><section class="slide" data-slide-id="s1" data-pptx-intent="native-oriented">
      <h1 data-object-id="title">Title</h1>
      <div data-object-id="shape" data-pptx-shape="chevron" data-pptx-gradient='{"angle":45,"stops":[{"color":"#ff0000","position":0},{"color":"#0000ff","position":1}]}'></div>
      <table data-object-id="table"><tr><th rowspan="2">Metric</th><th>Value</th></tr><tr><td>42</td></tr></table>
      <img data-object-id="hero" src="assets/hero.png" alt="Hero" />
    </section></main>`));
    expect(report).toMatchObject({ status: "native-oriented", ready: true, strictReady: true, slideCount: 1, stableObjects: 4, nativeCandidates: 3, runtimeDependent: 1, regionalFallbacks: 0, cleanPlateFallbacks: 1, fullSlideFallbacks: 0 });
    expect(report.issues.filter((entry) => entry.severity === "info").map((entry) => entry.code)).toContain("computed-style-dependent");
  });

  it("identifies untracked text, nested stable objects, and guaranteed regional fallbacks as hybrid risks", () => {
    const report = analyzePptxHtmlReadiness(documentFor(`<main class="deck-stage"><section class="slide" data-slide-id="s1" data-pptx-intent="hybrid">Rasterized text
      <div data-object-id="parent"><span data-object-id="child">Nested</span></div>
      <video data-object-id="clip" src="assets/clip.mp4"></video>
      <img data-object-id="remote" src="https://example.com/hero.png" />
      <p data-object-id="styled" style="box-shadow:0 2px 8px #000">Styled text</p>
    </section></main>`));
    expect(report.status).toBe("hybrid"); expect(report.ready).toBe(true); expect(report.strictReady).toBe(false); expect(report.regionalFallbacks).toBe(3);
    expect(report.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(["untracked-text", "nested-stable-object", "unsupported-stable-element", "image-source-fallback", "computed-style-fallback"]));
  });

  it("blocks missing identity and invalid native metadata", () => {
    const body = `<main class="deck-stage"><section class="slide" data-slide-id="dup" data-pptx-intent="native-oriented"><div data-object-id="same" data-pptx-shape="cone"></div></section><section class="slide" data-slide-id="dup" data-pptx-intent="native-oriented"><div data-object-id="same" data-pptx-chart='{"chartType":"scatter","series":[]}'></div><div data-pptx-shape="chevron"></div></section></main>`;
    const report = analyzePptxHtmlReadiness(documentFor(body));
    expect(report.status).toBe("blocked"); expect(report.ready).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(["slide-id-duplicate", "object-id-duplicate", "metadata-object-id-missing", "pptx-shape-preset", "pptx-chart-schema"]));
  });

  it("validates TransitionSpec and records native transition downgrades", () => {
    const valid = `<main class="deck-stage"><section class="slide" data-slide-id="s1" data-pptx-intent="native-oriented"><h1 data-object-id="title">Title</h1><script type="application/json" data-transition-spec>{"schemaVersion":1,"kind":"pixel-grid","durationMs":500,"easing":"ease-out","reducedMotion":"fade"}</script></section></main>`;
    expect(codes(valid)).toContain("transition-downgrade");
    expect(codes(valid.replace('"durationMs":500', '"durationMs":9000'))).toContain("transition-metadata");
  });

  it("blocks decks without one stage and stable slide IDs", () => {
    const report = analyzePptxHtmlReadiness(documentFor(`<section class="slide" data-pptx-intent="native-oriented"><h1>Untyped</h1></section>`));
    expect(report.ready).toBe(false); expect(report.fullSlideFallbacks).toBe(1);
    expect(report.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining(["stage-count", "slide-id-missing", "full-slide-fallback", "untracked-text"]));
  });
});
