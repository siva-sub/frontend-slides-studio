import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { afterEach, describe, expect, it } from "vitest";
import { NATIVE_SHAPE_PRESETS, PPT_RS_SHAPE_COMPATIBILITY, mapStudioTransitionToNative, nativeTransitionXml, normalizeGeneratedPptxPackage, repairFindings, resolveNativeShapePreset, validatePptxPackage } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "slides-studio-pptx-compat-")); roots.push(root);
  const path = join(root, "fixture.pptx");
  const pptx = new PptxGenJS(); pptx.layout = "LAYOUT_WIDE"; pptx.author = "Compatibility tests"; pptx.title = "Fixture";
  const slide = pptx.addSlide(); slide.addText("Unicode ✓ & <escaped>", { objectName: "fixture-title", x: 1, y: 1, w: 6, h: 1 }); slide.addShape(pptx.ShapeType.rect, { objectName: "fixture-first-shape", x: 0.5, y: 2.2, w: 1, h: 0.5, fill: { color: "00AA00" } }); slide.addShape(pptx.ShapeType.chevron, { objectName: "fixture-shape", x: 1, y: 3, w: 2, h: 1, fill: { color: "4472C4" } });
  await pptx.writeFile({ fileName: path });
  await normalizeGeneratedPptxPackage(path, { stripUnusedNotes: true });
  return { root, path };
}

async function mutate(path: string, name: string, change: (zip: JSZip) => Promise<void> | void): Promise<string> {
  const output = join(join(path, ".."), name);
  const zip = await JSZip.loadAsync(await readFile(path));
  await change(zip);
  await writeFile(output, await zip.generateAsync({ type: "nodebuffer" }));
  return output;
}

function categories(report: Awaited<ReturnType<typeof validatePptxPackage>>) { return report.issues.map((entry) => entry.category); }

describe("native shape catalog", () => {
  it("exposes the broad schema-valid native catalog and safe compatibility aliases", () => {
    expect(new Set(NATIVE_SHAPE_PRESETS).size).toBe(NATIVE_SHAPE_PRESETS.length);
    expect(NATIVE_SHAPE_PRESETS.length).toBeGreaterThanOrEqual(178);
    expect(resolveNativeShapePreset("rounded-rectangle")).toEqual({ preset: "roundRect", compatibilityAlias: "rounded-rectangle" });
    expect(resolveNativeShapePreset("flowChartOffPageConnector")).toEqual({ preset: "flowChartOffpageConnector", compatibilityAlias: "flowChartOffPageConnector" });
    expect(PPT_RS_SHAPE_COMPATIBILITY.cone).toBeNull();
    expect(resolveNativeShapePreset("cone")).toBeUndefined();
  });
});

describe("native transitions", () => {
  it("ports every ppt-rs transition kind and records Studio downgrades", () => {
    for (const kind of ["cut", "fade", "push", "wipe", "split", "reveal", "cover", "zoom"] as const) expect(nativeTransitionXml({ kind })).toContain("<p:transition");
    expect(nativeTransitionXml({ kind: "none" })).toBe("");
    const timed = nativeTransitionXml({ kind: "wipe", direction: "left", durationMs: 650 });
    expect(timed).toContain('p14:dur="650"'); expect(timed).not.toContain("advTm");
    expect(() => nativeTransitionXml({ kind: "split", splitDirection: 'out"/><p:fade/' as "out" })).toThrow(/splitDirection/);
    expect(() => nativeTransitionXml({ kind: "fade", direction: "left" })).toThrow(/does not support/);
    expect(nativeTransitionXml({ kind: "zoom", zoomDirection: "out" })).toContain('<p:zoom dir="out"/>');
    expect(mapStudioTransitionToNative("zoom", 700, "out")).toMatchObject({ exact: true, transition: { kind: "zoom", zoomDirection: "out", durationMs: 700 } });
    expect(mapStudioTransitionToNative("zoom", 700, "ltr")).toMatchObject({ exact: false, transition: { kind: "zoom", durationMs: 700 } });
    expect(mapStudioTransitionToNative("slice-vertical", 700).transition).toMatchObject({ kind: "split", splitOrientation: "vertical", durationMs: 700 });
    expect(mapStudioTransitionToNative("pixel-grid").exact).toBe(false);
  });

  it("injects one transition in schema order", async () => {
    const { path } = await fixture();
    await normalizeGeneratedPptxPackage(path, { transitions: { 1: { kind: "wipe", direction: "left", durationMs: 750 } } });
    const zip = await JSZip.loadAsync(await readFile(path)); const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide.match(/<p:transition\b/g)).toHaveLength(1);
    expect(slide).toContain('<p:wipe dir="l"/>');
    expect(slide.indexOf("</p:cSld>")).toBeLessThan(slide.indexOf("<p:transition"));
  });
});

describe("TypeScript OOXML compatibility validator", () => {
  it("accepts a normalized PptxGenJS package", async () => {
    const { path } = await fixture();
    const report = await validatePptxPackage(path);
    expect(report.issues).toEqual([]); expect(report.valid).toBe(true); expect(report.slideCount).toBe(1); expect(repairFindings(report)).toEqual([]);
  });

  it("applies a gradient only to the named shape", async () => {
    const { path } = await fixture();
    await normalizeGeneratedPptxPackage(path, { shapeGradients: [{ slideNumber: 1, objectName: "fixture-shape", angle: 45, stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }] }] });
    const zip = await JSZip.loadAsync(await readFile(path)); const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const firstShape = [...slide.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)].find((match) => match[0].includes('name="fixture-first-shape"'))?.[0];
    const targetShape = [...slide.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)].find((match) => match[0].includes('name="fixture-shape"'))?.[0];
    expect(firstShape).not.toContain("<a:gradFill"); expect(targetShape).toContain("<a:gradFill");
  });

  it("treats generator-specific IDs and relationship ordering as nonblocking lint", async () => {
    const { path } = await fixture();
    const conventional = await mutate(path, "conventions.pptx", async (zip) => {
      const presentation = await zip.file("ppt/presentation.xml")!.async("string"); zip.file("ppt/presentation.xml", presentation.replace('id="256"', 'id="300"'));
      const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
      const tags = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0]).reverse(); zip.file("ppt/_rels/presentation.xml.rels", rels.replace(/<Relationship\b[^>]*\/>/g, () => tags.shift()!));
    });
    const report = await validatePptxPackage(conventional);
    expect(report.valid).toBe(true); expect(report.errorCount).toBe(0); expect(report.warningCount).toBeGreaterThan(0); expect(repairFindings(report)).toEqual([]);
  });

  it("rejects non-Transitional namespaces, DTDs, and invalid base transition children", async () => {
    const { path } = await fixture();
    const strict = await mutate(path, "strict.pptx", async (zip) => { const presentation = await zip.file("ppt/presentation.xml")!.async("string"); zip.file("ppt/presentation.xml", presentation.replace("http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main")); });
    expect(categories(await validatePptxPackage(strict))).toContain("Presentation");
    const dtd = await mutate(path, "dtd.pptx", (zip) => { zip.file("docProps/core.xml", '<!DOCTYPE x [<!ENTITY y "bad">]><x>&y;</x>'); });
    expect(categories(await validatePptxPackage(dtd))).toContain("Xml");
    const reveal = await mutate(path, "bad-reveal.pptx", async (zip) => { const slide = await zip.file("ppt/slides/slide1.xml")!.async("string"); zip.file("ppt/slides/slide1.xml", slide.replace("</p:cSld>", '</p:cSld><p:transition><p:reveal dir="r"/></p:transition>')); });
    expect(categories(await validatePptxPackage(reveal))).toContain("Transition");
    const duration = await mutate(path, "bad-duration.pptx", async (zip) => { const slide = await zip.file("ppt/slides/slide1.xml")!.async("string"); zip.file("ppt/slides/slide1.xml", slide.replace("</p:cSld>", '</p:cSld><p:transition xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" p14:dur="bogus"><p:fade/></p:transition>')); });
    expect((await validatePptxPackage(duration)).issues.map((entry) => entry.message).join(" ")).toContain("p14:dur");
  });

  it("ports required-part, XML, relationship, content-type, presentation, slide, theme, and chart rules", async () => {
    const { path } = await fixture();
    const missing = await mutate(path, "missing.pptx", (zip) => { zip.remove("ppt/viewProps.xml"); });
    expect(categories(await validatePptxPackage(missing))).toContain("MissingPart");

    const malformed = await mutate(path, "malformed.pptx", (zip) => { zip.file("ppt/slides/slide1.xml", "<p:sld>"); });
    expect(categories(await validatePptxPackage(malformed))).toContain("Xml");

    const broken = await mutate(path, "broken.pptx", async (zip) => { const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string"); zip.file("ppt/slides/_rels/slide1.xml.rels", rels.replace("../slideLayouts/slideLayout1.xml", "../slideLayouts/missing.xml")); });
    expect(categories(await validatePptxPackage(broken))).toContain("Relationship");

    const untyped = await mutate(path, "untyped.pptx", (zip) => { zip.file("ppt/custom/data.unknown", "opaque"); });
    expect(categories(await validatePptxPackage(untyped))).toContain("ContentType");

    const mismatch = await mutate(path, "mismatch.pptx", async (zip) => { const presentation = await zip.file("ppt/presentation.xml")!.async("string"); zip.file("ppt/presentation.xml", presentation.replace(/<p:sldId\b[^>]*\/>/, "")); });
    expect(categories(await validatePptxPackage(mismatch))).toContain("Presentation");

    const invalidSlide = await mutate(path, "invalid-slide.pptx", async (zip) => { const slide = await zip.file("ppt/slides/slide1.xml")!.async("string"); zip.file("ppt/slides/slide1.xml", slide.replace(/<a:prstGeom prst="chevron"/, '<a:prstGeom prst="cone"').replace(/<a:ext cx="\d+" cy="\d+"\/>/, '<a:ext cx="-1" cy="1"/>').replace(/<p:cNvPr id="2"/, '<p:cNvPr id="1"')); });
    const slideReport = await validatePptxPackage(invalidSlide); expect(categories(slideReport)).toContain("Slide"); expect(slideReport.issues.map((entry) => entry.message).join(" ")).toMatch(/preset|duplicate|negative/);

    const stubTheme = await mutate(path, "stub-theme.pptx", (zip) => { zip.file("ppt/theme/theme1.xml", '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>'); });
    expect(categories(await validatePptxPackage(stubTheme))).toContain("Theme");

    const chart = await mutate(path, "chart.pptx", async (zip) => { zip.file("ppt/charts/chart1.xml", '<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>'); const types = await zip.file("[Content_Types].xml")!.async("string"); zip.file("[Content_Types].xml", types.replace("</Types>", '<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>')); });
    expect(categories(await validatePptxPackage(chart))).toContain("Chart");
  });
});
