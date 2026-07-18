import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { platform } from "node:os";
import { basename, dirname, extname, join, posix, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import JSZip from "jszip";
import { parseHTML } from "linkedom";
import PptxGenJS from "pptxgenjs";
import { computePlacement, detectImageDimensions, sniffMime } from "@slides-studio/media-kit";
import { parsePresentationObjectGraph, summarizeGraph, type ImageObject, type PresentationObjectGraphV1, type PresentationObject } from "@slides-studio/presentation-objects";
import { qualityReportSchema } from "@slides-studio/protocol";

export interface RasterSlideInput { id: string; imagePath: string; overlays?: Array<{ path: string; x: number; y: number; width: number; height: number }>; }
export interface ArtifactDigest { algorithm: "sha256"; value: string; }
export interface PptxObjectInventoryItem { slideId: string; objectId: string; type: PresentationObject["type"]; native: boolean; fallbackReason?: string; media?: Pick<ImageObject, "fit" | "crop" | "focal" | "pan" | "zoom" | "rotation" | "alt" | "layoutSlot" | "sourceDimensions">; }
export interface PptxStandardEvidence { standard: "ISO/IEC 29500"; conformance: "transitional"; packageValidated: true; checkedParts: number; checkedRelationships: number; }
export interface PptxExportReport { status: "generated" | "unverified" | "rendered_pending_manual_review" | "passed"; mode: "raster" | "editable"; output: string; slideCount: number; nativeObjects: number; fallbackObjects: number; fallbackReasons: Record<string, number>; objectInventory: PptxObjectInventoryItem[]; limitations: string[]; standard: PptxStandardEvidence; qualityReport?: string; artifactHashes?: { output: ArtifactDigest; renderEvidence?: ArtifactDigest; qualityReport?: ArtifactDigest }; generatedAt: string; renderBackend?: string; renderEvidence?: string; manualVisualReviewRequired: boolean; manualReview?: { reviewer: string; reviewedAt: string; evidence: string }; }

const STATIC_MOTION_LIMITATION = "HTML page transitions and object motion are settled to static frames; native PowerPoint animation is not exported.";
const MISSING_QUALITY_LIMITATION = "No passing quality report is bound to this editable artifact; manual approval is disabled.";

async function digestFile(path: string): Promise<ArtifactDigest> { return { algorithm: "sha256", value: createHash("sha256").update(await readFile(path)).digest("hex") }; }
async function assertDigest(path: string, expected: ArtifactDigest, label: string): Promise<void> { const actual = await digestFile(path); if (actual.value !== expected.value) throw new Error(`${label} changed after render-back; regenerate evidence before approval`); }
async function assertArtifactMagic(path: string, kind: "pptx" | "pdf"): Promise<void> { const bytes = await readFile(path); const valid = kind === "pptx" ? bytes[0] === 0x50 && bytes[1] === 0x4b : bytes.subarray(0, 5).toString() === "%PDF-"; if (!valid) throw new Error(`${kind.toUpperCase()} evidence has an invalid file signature`); }

function relationshipOwner(path: string): string {
  if (path === "_rels/.rels") return "";
  const marker = "/_rels/"; const index = path.indexOf(marker);
  if (index < 0 || !path.endsWith(".rels")) throw new Error(`invalid Open XML relationship part: ${path}`);
  return posix.join(path.slice(0, index), posix.basename(path, ".rels"));
}

function relationshipAttributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z][\w:]*)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));
}

export async function validatePptxOpenXmlPackage(path: string): Promise<PptxStandardEvidence> {
  const archive = await JSZip.loadAsync(await readFile(path), { checkCRC32: true });
  const parts = new Set(Object.entries(archive.files).filter(([, entry]) => !entry.dir).map(([name]) => name));
  for (const required of ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]) if (!parts.has(required)) throw new Error(`ISO/IEC 29500 package is missing ${required}`);
  const contentTypes = await archive.file("[Content_Types].xml")!.async("string");
  if (!contentTypes.includes("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")) throw new Error("ISO/IEC 29500 presentation content type is missing");
  const presentation = await archive.file("ppt/presentation.xml")!.async("string");
  if (!presentation.includes("http://schemas.openxmlformats.org/presentationml/2006/main")) throw new Error("PPTX is not an ISO/IEC 29500 Transitional presentation package");
  const slideParts = [...parts].filter((part) => /^ppt\/slides\/slide\d+\.xml$/.test(part));
  if (slideParts.length === 0) throw new Error("ISO/IEC 29500 package contains no slide parts");
  let checkedRelationships = 0;
  for (const relationshipPath of [...parts].filter((part) => part.endsWith(".rels"))) {
    const owner = relationshipOwner(relationshipPath); const base = owner ? posix.dirname(owner) : "";
    const xml = await archive.file(relationshipPath)!.async("string");
    for (const match of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const attributes = relationshipAttributes(match[0]);
      if (!attributes.Target || attributes.TargetMode === "External") continue;
      const target = posix.normalize(posix.join(base, decodeURIComponent(attributes.Target.replace(/^\//, ""))));
      if (target.startsWith("../") || !parts.has(target)) throw new Error(`ISO/IEC 29500 relationship ${relationshipPath} points to missing part ${target}`);
      checkedRelationships += 1;
    }
  }
  return { standard: "ISO/IEC 29500", conformance: "transitional", packageValidated: true, checkedParts: parts.size, checkedRelationships };
}

async function validatePassingQualityReport(path: string): Promise<void> {
  const report = qualityReportSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (!report.passed || report.summary.hard > 0 || report.summary.error > 0 || report.summary.critical > 0) throw new Error("Editable PPTX requires a passing quality report without blocking findings");
}
function inventoryFor(graph: PresentationObjectGraphV1): PptxObjectInventoryItem[] {
  return graph.slides.flatMap((slide) => slide.objects.map((object) => ({
    slideId: slide.id, objectId: object.id, type: object.type, native: object.native,
    ...(object.fallbackReason ? { fallbackReason: object.fallbackReason } : {}),
    ...(object.type === "image" ? { media: { ...(object.fit ? { fit: object.fit } : {}), ...(object.crop ? { crop: object.crop } : {}), ...(object.focal ? { focal: object.focal } : {}), ...(object.pan ? { pan: object.pan } : {}), ...(object.zoom !== undefined ? { zoom: object.zoom } : {}), ...(object.rotation !== undefined ? { rotation: object.rotation } : {}), ...(object.alt !== undefined ? { alt: object.alt } : {}), ...(object.layoutSlot !== undefined ? { layoutSlot: object.layoutSlot } : {}), ...(object.sourceDimensions ? { sourceDimensions: object.sourceDimensions } : {}) } } : {}),
  })));
}

const serialize = (document: Document) => `<!doctype html>\n${document.documentElement.outerHTML}`;
export function buildAuthorHtml(source: string, runtimeIife: string, metadata?: unknown): string {
  const { document } = parseHTML(source);
  const runtime = document.createElement("script"); runtime.textContent = runtimeIife; runtime.dataset.slidesStudioRuntime = "embedded"; document.body.append(runtime);
  if (metadata) { const data = document.createElement("script"); data.type = "application/json"; data.dataset.deckGoal = "true"; data.textContent = JSON.stringify(metadata).replace(/<\//g, "<\\/"); document.body.append(data); }
  document.documentElement.dataset.slidesStudioBuild = "author";
  return serialize(document);
}

export function buildShareHtml(source: string, runtimeIife: string): string {
  const { document } = parseHTML(source);
  document.querySelectorAll("[data-authoring-ui], [data-private-metadata], script[data-studio-bridge], script[data-deck-goal]").forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) if (/^on/i.test(attribute.name) || /^(javascript|vbscript):/i.test(attribute.value.trim())) element.removeAttribute(attribute.name);
  });
  const runtime = document.createElement("script"); runtime.textContent = runtimeIife; runtime.dataset.slidesStudioRuntime = "embedded"; document.body.append(runtime);
  document.documentElement.dataset.slidesStudioBuild = "share";
  return serialize(document);
}

const inchBox = (object: PresentationObject, slideWidth: number, slideHeight: number) => ({ x: object.x / slideWidth * 13.333, y: object.y / slideHeight * 7.5, w: object.width / slideWidth * 13.333, h: object.height / slideHeight * 7.5 });
const cleanColor = (value = "#000000") => {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) return hex[1]!.toUpperCase();
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value.trim());
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, "0")).join("").toUpperCase();
  return "000000";
};
const validCrop = (crop: ImageObject["crop"]) => crop && [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001;

async function sourceDimensions(object: ImageObject): Promise<{ width: number; height: number } | undefined> {
  if (object.sourceDimensions?.width && object.sourceDimensions.height) return object.sourceDimensions;
  try {
    const bytes = new Uint8Array(await readFile(object.path));
    return detectImageDimensions(bytes, sniffMime(bytes)) ?? undefined;
  } catch {
    return undefined;
  }
}

function cropOptions(box: ReturnType<typeof inchBox>, crop: NonNullable<ImageObject["crop"]>) {
  const sourceBox = { w: box.w / crop.width, h: box.h / crop.height };
  return { x: box.x, y: box.y, w: sourceBox.w, h: sourceBox.h, sizing: { type: "crop" as const, x: crop.x * sourceBox.w, y: crop.y * sourceBox.h, w: box.w, h: box.h } };
}

async function imageOptions(object: ImageObject, slideWidth: number, slideHeight: number) {
  const box = inchBox(object, slideWidth, slideHeight);
  const common = { objectName: object.id, ...(object.rotation !== undefined ? { rotate: object.rotation } : {}), ...(object.alt ? { altText: object.alt } : {}) };
  if (validCrop(object.crop)) return { ...common, ...cropOptions(box, object.crop!) };
  if (object.fit === "stretch" || !object.fit) return { ...common, ...box };
  const dimensions = await sourceDimensions(object);
  if (!dimensions) return { ...common, ...box };
  const placement = computePlacement({
    source: dimensions,
    slot: { x: object.x, y: object.y, width: object.width, height: object.height },
    fit: object.fit,
    ...(object.focal ? { focal: object.focal } : {}),
    ...(object.pan ? { pan: object.pan } : {}),
    ...(object.zoom !== undefined ? { zoom: object.zoom } : {}),
    ...(object.rotation !== undefined ? { rotation: object.rotation } : {}),
  });
  if (object.fit === "contain") {
    return { ...common, x: placement.destination.x / slideWidth * 13.333, y: placement.destination.y / slideHeight * 7.5, w: placement.destination.width / slideWidth * 13.333, h: placement.destination.height / slideHeight * 7.5 };
  }
  const crop = { x: placement.crop.x / dimensions.width, y: placement.crop.y / dimensions.height, width: placement.crop.width / dimensions.width, height: placement.crop.height / dimensions.height };
  return { ...common, ...cropOptions(box, crop) };
}

export async function exportRasterPptx(slides: RasterSlideInput[], output: string, options: { qualityReport?: string } = {}): Promise<PptxExportReport> {
  const pptx = new PptxGenJS(); pptx.layout = "LAYOUT_WIDE"; pptx.author = "Frontend Slides Studio"; pptx.subject = "Raster presentation — not natively editable"; pptx.title = "Frontend Slides Studio raster export"; pptx.company = "siva-sub";
  for (const input of slides) { const slide = pptx.addSlide(); slide.background = { color: "111111" }; slide.addImage({ path: input.imagePath, x: 0, y: 0, w: 13.333, h: 7.5 }); for (const overlay of input.overlays ?? []) slide.addImage({ path: overlay.path, x: overlay.x * 13.333, y: overlay.y * 7.5, w: overlay.width * 13.333, h: overlay.height * 7.5 }); slide.addNotes("Raster export: this slide is a frozen visual snapshot. Supplied real assets may remain separate overlays."); }
  await mkdir(dirname(resolve(output)), { recursive: true }); await pptx.writeFile({ fileName: output });
  const standard = await validatePptxOpenXmlPackage(output);
  const qualityPath = options.qualityReport ? resolve(options.qualityReport) : undefined;
  const report: PptxExportReport = { status: "generated", mode: "raster", output: resolve(output), slideCount: slides.length, nativeObjects: 0, fallbackObjects: slides.length, fallbackReasons: { "frozen full-slide image": slides.length }, objectInventory: [], limitations: ["Raster PPTX slides are frozen full-slide images and are not natively editable.", STATIC_MOTION_LIMITATION], standard, ...(qualityPath ? { qualityReport: qualityPath } : {}), artifactHashes: { output: await digestFile(output), ...(qualityPath ? { qualityReport: await digestFile(qualityPath) } : {}) }, generatedAt: new Date().toISOString(), manualVisualReviewRequired: false };
  await writeFile(`${output}.report.json`, JSON.stringify(report, null, 2)); return report;
}

export async function exportEditablePptx(graph: PresentationObjectGraphV1, output: string, options: { qualityReport?: string } = {}): Promise<PptxExportReport> {
  graph = parsePresentationObjectGraph(graph);
  const qualityPath = options.qualityReport ? resolve(options.qualityReport) : undefined; if (qualityPath) await validatePassingQualityReport(qualityPath);
  const pptx = new PptxGenJS(); pptx.layout = "LAYOUT_WIDE"; pptx.author = "Frontend Slides Studio"; pptx.title = graph.title;
  for (const input of graph.slides) {
    const slide = pptx.addSlide();
    for (const object of input.objects.toSorted((left, right) => left.zIndex - right.zIndex)) {
      const box = inchBox(object, input.width, input.height);
      if (object.type === "text") slide.addText(object.text, { ...box, objectName: object.id, ...(object.fontFace ? { fontFace: object.fontFace } : {}), fontSize: object.fontSize ?? 18, color: cleanColor(object.color), ...(object.bold !== undefined ? { bold: object.bold } : {}), ...(object.align ? { align: object.align } : {}), margin: 0, breakLine: false, fit: "shrink" });
      else if (object.type === "shape") slide.addShape(object.shape === "ellipse" ? pptx.ShapeType.ellipse : object.shape === "rounded-rectangle" ? pptx.ShapeType.roundRect : object.shape === "line" ? pptx.ShapeType.line : pptx.ShapeType.rect, { ...box, objectName: object.id, fill: { color: cleanColor(object.fill), transparency: object.fill ? 0 : 100 }, line: { color: cleanColor(object.stroke), width: 1 } });
      else if (object.type === "image") slide.addImage({ path: object.path, ...(await imageOptions(object, input.width, input.height)) });
      else if (object.type === "raster-region") slide.addImage({ path: object.path, objectName: object.id, ...box });
      else if (object.type === "svg") slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(object.svg).toString("base64")}`, objectName: object.id, ...box });
      else if (object.type === "connector") {
        for (let index = 0; index < object.points.length - 1; index++) { const start = object.points[index]!; const end = object.points[index + 1]!; slide.addShape(pptx.ShapeType.line, { objectName: `${object.id}-${index + 1}`, x: start.x / input.width * 13.333, y: start.y / input.height * 7.5, w: (end.x - start.x) / input.width * 13.333, h: (end.y - start.y) / input.height * 7.5, line: { color: cleanColor(object.stroke), width: 1.2, dashType: object.dashed ? "dash" : "solid", endArrowType: index === object.points.length - 2 && object.endArrow ? "triangle" : "none" } }); }
        if (object.label && object.points.length > 1) { const middle = object.points[Math.floor(object.points.length / 2)]!; slide.addText(object.label, { objectName: `${object.id}-label`, x: middle.x / input.width * 13.333 - 0.45, y: middle.y / input.height * 7.5 - 0.1, w: 0.9, h: 0.2, margin: 0, fontSize: 8, align: "center", color: cleanColor(object.stroke), fill: { color: "FFFFFF", transparency: 10 }, fit: "shrink" }); }
      }
    }
  }
  await mkdir(dirname(resolve(output)), { recursive: true }); await pptx.writeFile({ fileName: output });
  const standard = await validatePptxOpenXmlPackage(output);
  const summary = summarizeGraph(graph); const backend = detectRenderBackend(); const renderEvidence = backend ? await renderBackPptx(output, backend) : undefined;
  const artifactHashes = { output: await digestFile(output), ...(renderEvidence ? { renderEvidence: await digestFile(renderEvidence) } : {}), ...(qualityPath ? { qualityReport: await digestFile(qualityPath) } : {}) };
  const report: PptxExportReport = { status: renderEvidence && qualityPath ? "rendered_pending_manual_review" : "unverified", mode: "editable", output: resolve(output), slideCount: graph.slides.length, nativeObjects: summary.native, fallbackObjects: summary.fallback, fallbackReasons: summary.reasons, objectInventory: inventoryFor(graph), limitations: [STATIC_MOTION_LIMITATION, "Unsupported HTML/CSS effects remain explicit regional raster fallbacks.", ...(!qualityPath ? [MISSING_QUALITY_LIMITATION] : [])], standard, ...(qualityPath ? { qualityReport: qualityPath } : {}), artifactHashes, generatedAt: new Date().toISOString(), ...(backend ? { renderBackend: backend } : {}), ...(renderEvidence ? { renderEvidence } : {}), manualVisualReviewRequired: true };
  await writeFile(`${output}.report.json`, JSON.stringify(report, null, 2)); return report;
}

export function detectRenderBackend(): string | undefined {
  const commands = platform() === "win32" ? ["soffice"] : platform() === "darwin" ? ["libreoffice", "soffice"] : ["libreoffice", "soffice"];
  return commands.find((command) => spawnSync(command, ["--version"], { stdio: "ignore", timeout: 5000 }).status === 0);
}

export async function renderBackPptx(output: string, backend: string): Promise<string | undefined> {
  if (!["libreoffice", "soffice"].includes(backend)) return undefined;
  const target = resolve(output); const evidenceDir = `${target}.rendered`; await rm(evidenceDir, { recursive: true, force: true }); await mkdir(evidenceDir, { recursive: true });
  const result = spawnSync(backend, ["--headless", "--convert-to", "pdf", "--outdir", evidenceDir, target], { encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) return undefined;
  const pdf = join(evidenceDir, `${basename(target, extname(target))}.pdf`);
  try { await access(pdf, constants.R_OK); return pdf; } catch { return undefined; }
}

export async function approveEditablePptx(reportPath: string, evidence: { reviewer: string; evidence: string }): Promise<PptxExportReport> {
  const raw = JSON.parse(await readFile(reportPath, "utf8")) as Partial<PptxExportReport>;
  if (raw.mode !== "editable") throw new Error("Only editable PPTX reports require manual approval");
  if (raw.status !== "rendered_pending_manual_review" || !raw.renderEvidence) throw new Error("A fresh render-back artifact is required before approval");
  if (!raw.output || !raw.qualityReport || !raw.artifactHashes?.output || !raw.artifactHashes.renderEvidence || !raw.artifactHashes.qualityReport) throw new Error("Approval requires PPTX, render-back, and passing quality evidence hashes");
  await validatePassingQualityReport(raw.qualityReport); await assertArtifactMagic(raw.output, "pptx"); await assertArtifactMagic(raw.renderEvidence, "pdf");
  await assertDigest(raw.output, raw.artifactHashes.output, "PPTX output"); await assertDigest(raw.renderEvidence, raw.artifactHashes.renderEvidence, "Render-back evidence"); await assertDigest(raw.qualityReport, raw.artifactHashes.qualityReport, "Quality report");
  if (!evidence.reviewer.trim() || !evidence.evidence.trim()) throw new Error("Reviewer and visual evidence are required");
  const limitations = Array.isArray(raw.limitations) ? [...raw.limitations] : [];
  if (!limitations.includes(STATIC_MOTION_LIMITATION)) limitations.push(STATIC_MOTION_LIMITATION);
  const report = { ...raw, objectInventory: raw.objectInventory ?? [], generatedAt: raw.generatedAt ?? new Date().toISOString(), limitations } as PptxExportReport;
  const approved: PptxExportReport = { ...report, status: "passed", manualVisualReviewRequired: false, manualReview: { reviewer: evidence.reviewer.trim(), evidence: evidence.evidence.trim(), reviewedAt: new Date().toISOString() } };
  await writeFile(reportPath, JSON.stringify(approved, null, 2)); return approved;
}

export async function assertFilesExist(paths: string[]): Promise<void> { for (const path of paths) await access(path, constants.R_OK); }
export async function loadRuntimeIife(path: string): Promise<string> { return readFile(path, "utf8"); }
