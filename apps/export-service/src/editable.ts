import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { mapStudioTransitionToNative } from "@slides-studio/pptx-compat";
import { domSnapshotToSlide, placeDiagramObjects, type DomSnapshotElement, type NativeChartMetadata, type NativeShapeMetadata, type NativeTableMetadata, type PresentationObjectGraphV1 } from "@slides-studio/presentation-objects";
import { parseDiagramSpec, transitionSpecSchema } from "@slides-studio/protocol";

interface BrowserObject {
  id: string;
  tagName: string;
  kind: "text" | "shape" | "table" | "chart" | "diagram" | "image" | "unsupported";
  text?: string;
  bbox: { x: number; y: number; width: number; height: number };
  style: Record<string, string | number | undefined>;
  imageSource?: string;
  media?: DomSnapshotElement["media"];
  nativeShape?: NativeShapeMetadata;
  nativeTable?: NativeTableMetadata;
  nativeChart?: NativeChartMetadata;
  diagramSpec?: unknown;
  zIndex: number;
}

interface BrowserSlide {
  id: string;
  width: number;
  height: number;
  objects: BrowserObject[];
  transitionSpec?: unknown;
  notes?: string;
}

function safeExtension(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/svg+xml") return ".svg";
  throw new Error(`unsupported embedded image MIME type: ${mime}`);
}

async function materializeImage(source: string, outputDir: string): Promise<string | undefined> {
  if (source.startsWith("file:")) return fileURLToPath(source);
  const data = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,(.+)$/s.exec(source);
  if (!data) return undefined;
  const bytes = Buffer.from(data[2]!, "base64");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const path = join(outputDir, "editable-assets", `${digest}${safeExtension(data[1]!)}`);
  await mkdir(join(outputDir, "editable-assets"), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  return path;
}

async function browserSlide(page: Page, slideIndex: number): Promise<BrowserSlide> {
  return page.evaluate((active) => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide, index) => {
      slide.classList.toggle("active", index === active);
      slide.classList.toggle("visible", index === active);
      slide.style.visibility = index === active ? "visible" : "hidden";
      slide.style.opacity = index === active ? "1" : "0";
      slide.style.display = index === active ? "block" : "none";
    });
    const slide = slides[active];
    if (!slide) throw new Error(`slide ${active + 1} is unavailable`);
    const stage = slide.closest<HTMLElement>(".deck-stage") ?? slide;
    const stageRect = stage.getBoundingClientRect();
    const width = stage.offsetWidth || slide.offsetWidth || 1920;
    const height = stage.offsetHeight || slide.offsetHeight || 1080;
    const scaleX = stageRect.width / width || 1;
    const scaleY = stageRect.height / height || 1;
    const stable = Array.from(slide.querySelectorAll<HTMLElement>("[data-object-id]")).filter((element) => { const host = element.closest<HTMLElement>("[data-object-id][data-diagram-type]"); return !host || host === element; });
    const objects = stable.map((element, order): BrowserObject | null => {
      const rect = element.getBoundingClientRect();
      const bbox = { x: (rect.left - stageRect.left) / scaleX, y: (rect.top - stageRect.top) / scaleY, width: rect.width / scaleX, height: rect.height / scaleY };
      if (bbox.width <= 0 || bbox.height <= 0) return null;
      const computed = getComputedStyle(element);
      const z = Number.parseInt(computed.zIndex, 10);
      const zIndex = Number.isFinite(z) ? z : order + 1;
      const tagName = element.tagName;
      const baseStyle = { fontFamily: computed.fontFamily, fontSize: Number.parseFloat(computed.fontSize) || 24, fontWeight: Number.parseFloat(computed.fontWeight) || 400, color: computed.color, textAlign: computed.textAlign, backgroundColor: computed.backgroundColor, borderColor: computed.borderColor };
      if (element instanceof HTMLImageElement) {
        const fit = (element.dataset.mediaFit || computed.objectFit) === "cover" ? "cover" : "contain";
        const cropValues = [element.dataset.cropX, element.dataset.cropY, element.dataset.cropWidth, element.dataset.cropHeight].map(Number);
        const focalValues = [element.dataset.focalX, element.dataset.focalY].map(Number);
        const rotation = Number(element.dataset.mediaRotation);
        const crop = cropValues.every(Number.isFinite) && cropValues[0]! >= 0 && cropValues[1]! >= 0 && cropValues[2]! > 0 && cropValues[3]! > 0 && cropValues[0]! + cropValues[2]! <= 1 && cropValues[1]! + cropValues[3]! <= 1 ? { x: cropValues[0]!, y: cropValues[1]!, width: cropValues[2]!, height: cropValues[3]! } : undefined;
        const focal = focalValues.every(Number.isFinite) && focalValues.every((value) => value >= 0 && value <= 1) ? { x: focalValues[0]!, y: focalValues[1]! } : undefined;
        return { id: element.dataset.objectId!, tagName, kind: "image", bbox, style: baseStyle, imageSource: element.currentSrc || element.src, media: { fit, ...(crop ? { crop } : {}), ...(focal ? { focal } : {}), ...(Number.isFinite(rotation) ? { rotation } : {}), ...(element.getAttribute("alt") ? { alt: element.getAttribute("alt")! } : {}), ...(element.dataset.layoutSlot ? { layoutSlot: element.dataset.layoutSlot } : {}) }, zIndex };
      }
      const hasStableChildren = Boolean(element.querySelector("[data-object-id]"));
      const text = (element.textContent || "").trim();
      const diagramMetadata = element.querySelector<HTMLScriptElement>('script[type="application/json"][data-diagram-spec]');
      if (diagramMetadata?.textContent) { let diagramSpec: unknown; try { diagramSpec = JSON.parse(diagramMetadata.textContent); } catch { diagramSpec = undefined; } if (diagramSpec) return { id: element.dataset.objectId!, tagName, kind: "diagram", bbox, style: baseStyle, diagramSpec, zIndex }; }
      const cssHex = (value: string) => { const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value); return rgb ? `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : value; };
      if (tagName === "TABLE") {
        const rows = Array.from((element as HTMLTableElement).rows).map((row) => Array.from(row.cells).map((cell) => { const style = getComputedStyle(cell); const fill = ["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor) ? undefined : cssHex(style.backgroundColor); return { text: cell.textContent?.trim() ?? "", ...(fill ? { fill } : {}), color: cssHex(style.color), bold: (Number.parseFloat(style.fontWeight) || 400) >= 600, align: (["left", "center", "right"].includes(style.textAlign) ? style.textAlign : "left") as NonNullable<NativeTableMetadata["rows"][number][number]["align"]>, ...(cell.colSpan > 1 ? { colspan: cell.colSpan } : {}), ...(cell.rowSpan > 1 ? { rowspan: cell.rowSpan } : {}) }; }));
        const nativeTable: NativeTableMetadata = { rows, fontFace: computed.fontFamily, fontSize: Number.parseFloat(computed.fontSize) || 14, borderColor: cssHex(computed.borderColor), borderWidth: Number.parseFloat(computed.borderWidth) || 1 };
        return { id: element.dataset.objectId!, tagName, kind: "table", bbox, style: baseStyle, nativeTable, zIndex };
      }
      if (element.dataset.pptxChart) {
        let nativeChart: NativeChartMetadata | undefined; try { nativeChart = JSON.parse(element.dataset.pptxChart); } catch { nativeChart = undefined; }
        if (nativeChart) return { id: element.dataset.objectId!, tagName, kind: "chart", bbox, style: baseStyle, nativeChart, zIndex };
      }
      if (element.dataset.pptxShape) {
        const numeric = (value: string | undefined) => value === undefined || value === "" ? undefined : Number(value);
        let gradient: NativeShapeMetadata["gradient"];
        try { gradient = element.dataset.pptxGradient ? JSON.parse(element.dataset.pptxGradient) : undefined; } catch { gradient = undefined; }
        const hyperlink = element.dataset.pptxHyperlink ? { url: element.dataset.pptxHyperlink, ...(element.dataset.pptxHyperlinkTooltip ? { tooltip: element.dataset.pptxHyperlinkTooltip } : {}) } : undefined;
        const rotation = numeric(element.dataset.pptxRotation); const fillTransparency = numeric(element.dataset.pptxFillTransparency); const lineWidth = numeric(element.dataset.pptxLineWidth);
        const nativeShape: NativeShapeMetadata = { shape: element.dataset.pptxShape as NativeShapeMetadata["shape"], ...(gradient ? { gradient } : { fill: element.dataset.pptxFill || cssHex(computed.backgroundColor) }), stroke: element.dataset.pptxStroke || cssHex(computed.borderColor), ...(text ? { text } : {}), fontFace: computed.fontFamily, fontSize: Number.parseFloat(computed.fontSize) || 24, textColor: element.dataset.pptxTextColor || cssHex(computed.color), bold: (Number.parseFloat(computed.fontWeight) || 400) >= 600, align: (["left", "center", "right"].includes(computed.textAlign) ? computed.textAlign : "center") as NonNullable<NativeShapeMetadata["align"]>, ...(rotation !== undefined ? { rotation } : {}), ...(fillTransparency !== undefined ? { fillTransparency } : {}), ...(lineWidth !== undefined ? { lineWidth } : {}), ...(hyperlink ? { hyperlink } : {}) };
        return { id: element.dataset.objectId!, tagName, kind: "shape", ...(text ? { text } : {}), bbox, style: baseStyle, nativeShape, zIndex };
      }
      const simpleVisual = computed.transform === "none" && computed.filter === "none" && computed.boxShadow === "none" && computed.textShadow === "none" && computed.opacity === "1" && computed.clipPath === "none" && computed.maskImage === "none" && computed.backgroundImage === "none";
      const transparentBackground = computed.backgroundColor === "rgba(0, 0, 0, 0)" || computed.backgroundColor === "transparent";
      const borderless = [computed.borderTopWidth, computed.borderRightWidth, computed.borderBottomWidth, computed.borderLeftWidth].every((value) => Number.parseFloat(value) === 0);
      if (!hasStableChildren && text && simpleVisual && transparentBackground && borderless && !["SVG", "PATH", "VIDEO", "CANVAS", "IFRAME"].includes(tagName)) return { id: element.dataset.objectId!, tagName, kind: "text", text, bbox, style: baseStyle, zIndex };
      const hasFill = !transparentBackground;
      if (hasFill && !text && simpleVisual && !["SVG", "PATH", "VIDEO", "CANVAS", "IFRAME"].includes(tagName)) return { id: element.dataset.objectId!, tagName, kind: "shape", bbox, style: baseStyle, zIndex };
      if (hasStableChildren) return null;
      return { id: element.dataset.objectId!, tagName, kind: "unsupported", bbox, style: baseStyle, zIndex };
    }).filter((value): value is BrowserObject => Boolean(value));
    const transitionScript = slide.querySelector<HTMLScriptElement>('script[type="application/json"][data-transition-spec]');
    let transitionSpec: unknown;
    if (transitionScript?.textContent) try { transitionSpec = JSON.parse(transitionScript.textContent); } catch { transitionSpec = undefined; }
    const notes = slide.querySelector<HTMLScriptElement>('script[type="text/plain"][data-speaker-notes]')?.textContent ?? undefined;
    return { id: slide.dataset.slideId || `slide-${active + 1}`, width, height, objects, ...(transitionSpec ? { transitionSpec } : {}), ...(notes !== undefined ? { notes } : {}) };
  }, slideIndex);
}

async function captureCleanPlate(page: Page, slideIndex: number, outputDir: string, slideId: string): Promise<string> {
  const path = join(outputDir, "editable-clean-plates", `${String(slideIndex + 1).padStart(2, "0")}-${slideId.replace(/[^a-zA-Z0-9._-]/g, "-")}.png`);
  await mkdir(join(outputDir, "editable-clean-plates"), { recursive: true });
  await page.evaluate((active) => {
    const slide = document.querySelectorAll<HTMLElement>(".slide")[active];
    if (!slide) throw new Error(`slide ${active + 1} is unavailable`);
    const records = Array.from(slide.querySelectorAll<HTMLElement>("[data-object-id]")).map((element) => ({ element, style: element.getAttribute("style") }));
    (window as unknown as { __slidesStudioCleanPlate?: typeof records }).__slidesStudioCleanPlate = records;
    records.filter(({ element }) => !element.querySelector("[data-object-id]")).forEach(({ element }) => element.style.setProperty("visibility", "hidden", "important"));
  }, slideIndex);
  try { await page.locator(".slide").nth(slideIndex).screenshot({ path, animations: "disabled" }); }
  finally {
    await page.evaluate(() => {
      const state = window as unknown as { __slidesStudioCleanPlate?: Array<{ element: HTMLElement; style: string | null }> };
      state.__slidesStudioCleanPlate?.forEach(({ element, style }) => { if (style === null) element.removeAttribute("style"); else element.setAttribute("style", style); });
      delete state.__slidesStudioCleanPlate;
    });
  }
  return path;
}

export async function captureEditableGraph(page: Page, sourcePath: string, outputDir: string): Promise<PresentationObjectGraphV1> {
  const count = await page.locator(".slide").count();
  const slides: PresentationObjectGraphV1["slides"] = [];
  for (let slideIndex = 0; slideIndex < count; slideIndex += 1) {
    const snapshot = await browserSlide(page, slideIndex);
    const cleanPlate = await captureCleanPlate(page, slideIndex, outputDir, snapshot.id);
    const elements: DomSnapshotElement[] = [{ id: `${snapshot.id}-clean-plate`, tagName: "IMG", bbox: { x: 0, y: 0, width: snapshot.width, height: snapshot.height }, style: {}, imagePath: cleanPlate, supported: false, fallbackPath: cleanPlate, fallbackReason: "visual clean plate", zIndex: -100_000 }];
    const diagrams: Array<{ objectId: string; spec: ReturnType<typeof parseDiagramSpec>; bbox: BrowserObject["bbox"]; zIndex: number }> = [];
    for (const object of snapshot.objects) {
      let imagePath: string | undefined;
      if (object.kind === "image" && object.imageSource) imagePath = await materializeImage(object.imageSource, outputDir);
      if (object.kind === "diagram" && object.diagramSpec) { diagrams.push({ objectId: object.id, spec: parseDiagramSpec(object.diagramSpec), bbox: object.bbox, zIndex: object.zIndex }); continue; }
      const supported = object.kind === "text" || object.kind === "shape" || object.kind === "table" || object.kind === "chart" || Boolean(imagePath);
      let fallbackPath: string | undefined;
      if (!supported) {
        fallbackPath = join(outputDir, "editable-fallbacks", `${String(slideIndex + 1).padStart(2, "0")}-${object.id.replace(/[^a-zA-Z0-9._-]/g, "-")}.png`);
        await mkdir(join(outputDir, "editable-fallbacks"), { recursive: true });
        const locator = page.locator(`[data-object-id="${object.id.replaceAll('"', '\\"')}"]`).first();
        await locator.screenshot({ path: fallbackPath, animations: "disabled" });
      }
      elements.push({ id: object.id, tagName: object.tagName, ...(object.text !== undefined ? { text: object.text } : {}), bbox: object.bbox, style: object.style, ...(imagePath ? { imagePath, ...(object.media ? { media: object.media } : {}) } : {}), ...(object.nativeShape ? { nativeShape: object.nativeShape } : {}), ...(object.nativeTable ? { nativeTable: object.nativeTable } : {}), ...(object.nativeChart ? { nativeChart: object.nativeChart } : {}), supported, ...(fallbackPath ? { fallbackPath } : {}), zIndex: object.zIndex });
    }
    const presentationSlide = domSnapshotToSlide(snapshot.id, elements, snapshot.width, snapshot.height);
    for (const diagram of diagrams) presentationSlide.objects.push(...placeDiagramObjects(diagram.spec, diagram.bbox, diagram.objectId, diagram.zIndex));
    presentationSlide.objects.sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id));
    if (snapshot.notes !== undefined) presentationSlide.notes = snapshot.notes;
    const transition = transitionSpecSchema.safeParse(snapshot.transitionSpec);
    if (transition.success && transition.data.kind !== "none") {
      const mapping = mapStudioTransitionToNative(transition.data.kind, transition.data.durationMs, transition.data.direction);
      presentationSlide.nativeTransition = mapping.transition;
      presentationSlide.transitionMapping = mapping;
    }
    slides.push(presentationSlide);
  }
  return { schemaVersion: 1, title: basename(sourcePath, extname(sourcePath)), slides };
}
