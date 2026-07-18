import { describe, expect, it } from "vitest";
import type { DiagramSpecV1 } from "@slides-studio/protocol";
import { createAllDiagramFixtures, DIAGRAM_TYPES } from "@slides-studio/diagram-kit";
import { diagramToSlide, domSnapshotToSlide, parsePresentationObjectGraph, summarizeGraph, visualSceneToSlide } from "../src/index.js";

const theme = { paper: "#f5f5f2", paper2: "#fff", ink: "#20231f", muted: "#6f756d", rule: "#d8dbd4", accent: "#f05a36", accentTint: "#fde8e1", link: "#315f9d", titleFont: "Fraunces", bodyFont: "Manrope", monoFont: "IBM Plex Mono" };

describe("presentation object adapters", () => {
  it("rejects unknown objects, duplicate IDs, and unexplained fallbacks", () => {
    const base = { schemaVersion: 1, title: "Graph", slides: [{ id: "s1", width: 1920, height: 1080, objects: [{ id: "x", sourceId: "x", sourceKind: "dom", type: "shape", x: 0, y: 0, width: 10, height: 10, zIndex: 0, native: true, shape: "rectangle" }] }] };
    expect(parsePresentationObjectGraph(base).title).toBe("Graph");
    expect(() => parsePresentationObjectGraph({ ...base, slides: [{ ...base.slides[0], objects: [{ ...base.slides[0]!.objects[0], type: "mystery" }] }] })).toThrow(/type is unsupported/);
    expect(() => parsePresentationObjectGraph({ ...base, slides: [{ ...base.slides[0], objects: [{ ...base.slides[0]!.objects[0], native: false }] }] })).toThrow(/fallbackReason/);
    expect(() => parsePresentationObjectGraph({ ...base, slides: [{ ...base.slides[0], objects: [base.slides[0]!.objects[0], base.slides[0]!.objects[0]] }] })).toThrow(/duplicate object id/);
  });

  it("maps DiagramSpec to native objects", () => {
    const spec: DiagramSpecV1 = { schemaVersion: 1, id: "d", type: "architecture", variant: "light", direction: "ltr", theme, nodes: [{ id: "a", label: "A", kind: "step" }], edges: [] };
    expect(diagramToSlide(spec).objects.every((object) => object.native)).toBe(true);
  });
  it("maps every type-specific fixture to editable native objects", () => {
    for (const fixture of createAllDiagramFixtures()) {
      const slide = diagramToSlide(fixture);
      expect(slide.objects.length, fixture.type).toBeGreaterThan(0);
      expect(slide.objects.every((object) => object.native && object.type !== "raster-region"), fixture.type).toBe(true);
      expect(new Set(slide.objects.map((object) => object.id)).size, fixture.type).toBe(slide.objects.length);
    }
  });
  it("preserves stable source IDs for every legacy V1 type", () => {
    for (const type of DIAGRAM_TYPES) {
      const spec: DiagramSpecV1 = { schemaVersion: 1, id: `legacy-${type}`, type, variant: "light", direction: "ltr", theme, nodes: [{ id: "alpha", label: "Alpha", kind: "focal" }, { id: "beta", label: "Beta", kind: "step" }, { id: "gamma", label: "Gamma", kind: "store" }], edges: [{ id: "edge-ab", source: "alpha", target: "beta", label: "first", kind: "accent" }, { id: "edge-bg", source: "beta", target: "gamma", label: "second", kind: "link" }] };
      const slide = diagramToSlide(spec);
      const sourceIds = new Set(slide.objects.map((object) => object.sourceId));
      for (const id of ["alpha", "beta", "gamma", "edge-ab", "edge-bg"]) expect(sourceIds.has(id), `${type}:${id}`).toBe(true);
      expect(slide.objects.every((object) => object.native && object.type !== "raster-region"), type).toBe(true);
    }
  });
  it("records DOM fallbacks without duplicated text", () => {
    const slide = domSnapshotToSlide("s", [{ id: "x", tagName: "canvas", bbox: { x: 0, y: 0, width: 100, height: 100 }, style: {}, supported: false, fallbackPath: "canvas.png" }]);
    expect(slide.objects).toHaveLength(1);
    expect(slide.objects[0]?.type).toBe("raster-region");
  });
  it("preserves editable media crop and focal metadata", () => {
    const slide = domSnapshotToSlide("media", [{ id: "hero", tagName: "IMG", bbox: { x: 10, y: 20, width: 400, height: 220 }, style: {}, imagePath: "hero.png", supported: true, media: { fit: "cover", crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 }, focal: { x: 0.7, y: 0.4 }, pan: { x: 4, y: -2 }, zoom: 1.3, rotation: -5, alt: "Product hero", layoutSlot: "hero" } }]);
    const image = slide.objects[0];
    expect(image?.type).toBe("image");
    if (image?.type !== "image") throw new Error("expected image");
    expect(image.crop).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.8 });
    expect(image.focal).toEqual({ x: 0.7, y: 0.4 });
    expect(image.rotation).toBe(-5);
    expect(image.layoutSlot).toBe("hero");
  });
  it("uses one clean plate plus declared visual objects", () => {
    const slide = visualSceneToSlide({ slideId: "v", width: 100, height: 50, cleanPlate: "plate.png", elements: [{ id: "t", type: "native_text", bbox: [0,0,50,10], zIndex: 1, content: "Hi" }, { id: "c", type: "connector", bbox: [10,20,60,8], zIndex: 2, content: "flow" }] });
    const summary = summarizeGraph({ schemaVersion: 1, title: "Demo", slides: [slide] });
    expect(summary.fallback).toBe(1);
    expect(summary.native).toBe(2);
    expect(slide.objects.find((object) => object.id === "c")?.type).toBe("connector");
  });
});
