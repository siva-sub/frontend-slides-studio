import { describe, expect, it } from "vitest";
import type { LayoutProfile, StyleProfile } from "@slides-studio/protocol";
import { applyLayoutSlotToObject, applyStyleToHtml, attachLayoutToPage } from "./style";

const source = `<!doctype html><html><head><style>.deck-stage{width:1920px;height:1080px}.slide{position:absolute;inset:0}.title{color:red}</style></head><body><main class="deck-stage"><section class="slide" data-slide-id="one"><h1 class="title" data-object-id="title">One</h1><img data-object-id="hero" src="x.png"></section><section class="slide" data-slide-id="two"><h1 data-object-id="two-title">Two</h1></section></main></body></html>`;
const style: StyleProfile = { schemaVersion: 1, id: "editorial", name: "Editorial", palette: { paper: "#F5F2E8", paper2: "#FFFFFF", ink: "#171914", muted: "#777777", rule: "#CCCCCC", accent: "#F05A36", accentTint: "#FDE8E1", link: "#315F9D" }, fonts: { title: "Georgia", body: "Inter", mono: "monospace" }, tags: [], tokens: {}, provenance: {} };
const layout: LayoutProfile = { schemaVersion: 1, id: "editorial/hero", name: "Hero", styleId: "editorial", role: "content", canvas: { width: 1280, height: 720 }, visualSignature: "Hero", capacity: 2, suitability: { best: [], avoid: [] }, reuse: { policy: "unique" }, slots: [{ id: "media", acceptedKinds: ["image"], maxCount: 1, fit: "cover", emptyBehavior: "placeholder", region: { x: 0.5, y: 0.1, width: 0.4, height: 0.7 } }], protectedTextRegions: [], allowedOverlapGroups: [], schema: {} };

describe("Studio style and layout application", () => {
  it("applies visible style variables to one page or the full deck", () => {
    const page = new DOMParser().parseFromString(applyStyleToHtml(source, style, "page", 0, { recipeId: "pitch", layoutId: layout.id }), "text/html");
    expect(page.querySelectorAll('.slide[data-slides-studio-style-id="editorial"]')).toHaveLength(1);
    expect(page.querySelector<HTMLElement>(".slide")?.style.getPropertyValue("--slides-studio-paper")).toBe("#F5F2E8");
    expect(page.getElementById("slides-studio-applied-theme")?.textContent).toContain("background");
    expect(page.querySelector<HTMLElement>(".slide")?.dataset.slidesStudioLayoutId).toBe(layout.id);
    const deck = new DOMParser().parseFromString(applyStyleToHtml(source, style, "deck", 0), "text/html");
    expect(deck.querySelectorAll('.slide[data-slides-studio-style-id="editorial"]')).toHaveLength(2);
  });

  it("attaches layout metadata without claiming to reflow the page", () => {
    const doc = new DOMParser().parseFromString(attachLayoutToPage(source, 1, style.id, layout.id, "pitch"), "text/html");
    const slide = doc.querySelectorAll<HTMLElement>(".slide")[1]!;
    expect(slide.dataset.slidesStudioLayoutId).toBe(layout.id);
    expect(slide.dataset.slidesStudioRecipeId).toBe("pitch");
  });

  it("applies normalized media-slot geometry using the source stage dimensions", () => {
    const doc = new DOMParser().parseFromString(applyLayoutSlotToObject(source, "hero", layout, "media"), "text/html");
    const image = doc.querySelector<HTMLElement>('[data-object-id="hero"]')!;
    expect(image.style.left).toBe("960px");
    expect(image.style.top).toBe("108px");
    expect(image.style.width).toBe("768px");
    expect(image.style.height).toBe("756px");
    expect(image.dataset.layoutSlot).toBe("media");
  });
});
