import { describe, expect, it } from "vitest";
import type { DiagramSpecV1 } from "@slides-studio/protocol";
import { createAllDiagramFixtures, DIAGRAM_TYPES } from "@slides-studio/diagram-kit";
import { diagramToSlide, domSnapshotToSlide, parsePresentationObjectGraph, placeDiagramObjects, summarizeGraph, visualSceneToSlide } from "../src/index.js";

const theme = { paper: "#f5f5f2", paper2: "#fff", ink: "#20231f", muted: "#6f756d", rule: "#d8dbd4", accent: "#f05a36", accentTint: "#fde8e1", link: "#315f9d", titleFont: "Fraunces", bodyFont: "Manrope", monoFont: "IBM Plex Mono" };

describe("presentation object adapters", () => {
  it("rejects unknown objects, duplicate IDs, and unexplained fallbacks", () => {
    const base = { schemaVersion: 1, title: "Graph", slides: [{ id: "s1", width: 1920, height: 1080, objects: [{ id: "x", sourceId: "x", sourceKind: "dom", type: "shape", x: 0, y: 0, width: 10, height: 10, zIndex: 0, native: true, shape: "rectangle" }] }] };
    expect(parsePresentationObjectGraph(base).title).toBe("Graph");
    expect(() => parsePresentationObjectGraph({ ...base, slides: [{ ...base.slides[0], objects: [{ ...base.slides[0]!.objects[0], type: "mystery" }] }] })).toThrow(/type is unsupported/);
    expect(() => parsePresentationObjectGraph({ ...base, slides: [{ ...base.slides[0], objects: [{ ...base.slides[0]!.objects[0], native: false }] }] })).toThrow(/fallbackReason/);
    expect(() => parsePresentationObjectGraph({ ...base, slides: [{ ...base.slides[0], objects: [{ ...base.slides[0]!.objects[0], native: false, fallbackReason: "pixels" }] }] })).toThrow(/cannot be reported as a raster fallback/);
    expect(() => parsePresentationObjectGraph({ ...base, slides: [{ ...base.slides[0], objects: [{ ...base.slides[0]!.objects[0], type: "raster-region", path: "pixels.png" }] }] })).toThrow(/cannot be reported as native/);
    expect(() => parsePresentationObjectGraph({ ...base, slides: [{ ...base.slides[0], objects: [base.slides[0]!.objects[0], base.slides[0]!.objects[0]] }] })).toThrow(/duplicate object id/);
  });

  it("accepts schema-valid native shapes, styling, links, and transitions", () => {
    const graph = { schemaVersion: 1, title: "Native", slides: [{ id: "s1", width: 1920, height: 1080, nativeTransition: { kind: "wipe", durationMs: 700, direction: "left" }, objects: [{ id: "chevron", sourceId: "chevron", sourceKind: "dom", type: "shape", shape: "chevron", x: 100, y: 100, width: 400, height: 180, zIndex: 1, native: true, gradient: { angle: 45, stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1, transparency: 20 }] }, stroke: "#111111", lineWidth: 2, rotation: 12, text: "Native", hyperlink: { url: "https://example.com" } }] }] };
    const parsed = parsePresentationObjectGraph(graph);
    expect(parsed.slides[0]?.nativeTransition?.kind).toBe("wipe");
    expect(parsed.slides[0]?.objects[0]?.type).toBe("shape");
    expect(() => parsePresentationObjectGraph({ ...graph, slides: [{ ...graph.slides[0], objects: [{ ...graph.slides[0]!.objects[0], shape: "cone" }] }] })).toThrow(/schema-valid/);
    expect(() => parsePresentationObjectGraph({ ...graph, slides: [{ ...graph.slides[0], objects: [{ ...graph.slides[0]!.objects[0], hyperlink: { url: "javascript:alert(1)" } }] }] })).toThrow(/unsafe scheme/);
    expect(() => parsePresentationObjectGraph({ ...graph, slides: [{ ...graph.slides[0], nativeTransition: { kind: "split", splitDirection: 'out\"/><p:fade/' } }] })).toThrow(/splitDirection/);
    expect(() => parsePresentationObjectGraph({ ...graph, slides: [{ ...graph.slides[0], nativeTransition: { kind: "fade", direction: "left" } }] })).toThrow(/does not support/);
  });

  it("validates native tables and categorical chart series", () => {
    const graph = { schemaVersion: 1, title: "Data", slides: [{ id: "s1", width: 1000, height: 562.5, notes: "Speaker notes", objects: [
      { id: "table", sourceId: "table", sourceKind: "dom", type: "table", x: 50, y: 50, width: 420, height: 300, zIndex: 1, native: true, rows: [[{ text: "Metric" }, { text: "Value" }], [{ text: "Revenue" }, { text: "42" }]], columnWidths: [2, 1] },
      { id: "chart", sourceId: "chart", sourceKind: "dom", type: "chart", x: 500, y: 50, width: 450, height: 300, zIndex: 2, native: true, chartType: "barStacked", series: [{ name: "Actual", labels: ["Q1", "Q2"], values: [10, 12] }] },
    ] }] };
    expect(parsePresentationObjectGraph(graph).slides[0]?.objects.map((object) => object.type)).toEqual(["table", "chart"]); expect(parsePresentationObjectGraph(graph).slides[0]?.notes).toBe("Speaker notes");
    const merged = { ...graph, slides: [{ ...graph.slides[0], objects: [{ ...graph.slides[0]!.objects[0], rows: [[{ text: "Metric", rowspan: 2 }, { text: "Value" }], [{ text: "42" }]], columnWidths: [2, 1] }, graph.slides[0]!.objects[1]] }] };
    expect(parsePresentationObjectGraph(merged).slides[0]?.objects[0]?.type).toBe("table");
    expect(() => parsePresentationObjectGraph({ ...graph, slides: [{ ...graph.slides[0], objects: [{ ...graph.slides[0]!.objects[0], rows: [[{ text: "A" }], [{ text: "B" }, { text: "C" }]] }] }] })).toThrow(/same column count/);
    expect(() => parsePresentationObjectGraph({ ...graph, slides: [{ ...graph.slides[0], objects: [{ ...graph.slides[0]!.objects[1], series: [{ name: "Bad", labels: ["Q1"], values: [1, 2] }] }] }] })).toThrow(/equal nonempty arrays/);
  });

  it("maps DiagramSpec to native objects", () => {
    const spec: DiagramSpecV1 = { schemaVersion: 1, id: "d", type: "architecture", variant: "light", direction: "ltr", theme, nodes: [{ id: "a", label: "A", kind: "step" }], edges: [] };
    expect(diagramToSlide(spec).objects.every((object) => object.native)).toBe(true);
  });
  it("places persisted DiagramSpec primitives into a Studio frame without raster fallback", () => {
    const spec: DiagramSpecV1 = { schemaVersion: 1, id: "placed", type: "architecture", variant: "light", direction: "ltr", theme, nodes: [{ id: "a", label: "A", kind: "step" }, { id: "b", label: "B", kind: "store" }], edges: [{ id: "edge", source: "a", target: "b", kind: "link" }] };
    const objects = placeDiagramObjects(spec, { x: 100, y: 80, width: 800, height: 420 }, "figure", 12);
    expect(objects.every((object) => object.id.startsWith("figure-") && object.native && object.type !== "raster-region")).toBe(true);
    expect(objects.every((object) => object.x >= 100 && object.y >= 80 && object.x + object.width <= 900.0001 && object.y + object.height <= 500.0001)).toBe(true);
    expect(objects.every((object) => object.zIndex > 12 && object.zIndex < 12.001)).toBe(true);
    expect(objects.map((object) => object.zIndex)).toEqual(objects.map((object) => object.zIndex).toSorted((left, right) => left - right));
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
    const slide = domSnapshotToSlide("s", [{ id: "x", tagName: "canvas", bbox: { x: 0, y: 0, width: 100, height: 100 }, style: {}, supported: false, fallbackPath: "canvas.png", fallbackReason: "visual clean plate" }]);
    expect(slide.objects).toHaveLength(1);
    expect(slide.objects[0]?.type).toBe("raster-region");
    expect(slide.objects[0]?.fallbackReason).toBe("visual clean plate");
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
