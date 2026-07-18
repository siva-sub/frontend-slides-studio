import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { domSnapshotToSlide, type DomSnapshotElement, type PresentationObjectGraphV1 } from "@slides-studio/presentation-objects";

interface BrowserObject {
  id: string;
  tagName: string;
  kind: "text" | "shape" | "image" | "unsupported";
  text?: string;
  bbox: { x: number; y: number; width: number; height: number };
  style: Record<string, string | number | undefined>;
  imageSource?: string;
  media?: DomSnapshotElement["media"];
  zIndex: number;
}

interface BrowserSlide {
  id: string;
  width: number;
  height: number;
  objects: BrowserObject[];
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
    const stable = Array.from(slide.querySelectorAll<HTMLElement>("[data-object-id]"));
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
      const simpleTransform = computed.transform === "none" && computed.filter === "none" && computed.boxShadow === "none";
      if (!hasStableChildren && text && simpleTransform && !["SVG", "PATH", "VIDEO", "CANVAS", "IFRAME"].includes(tagName)) return { id: element.dataset.objectId!, tagName, kind: "text", text, bbox, style: baseStyle, zIndex };
      const hasFill = computed.backgroundColor !== "rgba(0, 0, 0, 0)" && computed.backgroundColor !== "transparent";
      if (hasFill && simpleTransform && !["SVG", "PATH", "VIDEO", "CANVAS", "IFRAME"].includes(tagName)) return { id: element.dataset.objectId!, tagName, kind: "shape", bbox, style: baseStyle, zIndex };
      if (hasStableChildren) return null;
      return { id: element.dataset.objectId!, tagName, kind: "unsupported", bbox, style: baseStyle, zIndex };
    }).filter((value): value is BrowserObject => Boolean(value));
    return { id: slide.dataset.slideId || `slide-${active + 1}`, width, height, objects };
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
    records.forEach(({ element }) => element.style.setProperty("visibility", "hidden", "important"));
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
    const elements: DomSnapshotElement[] = [{ id: `${snapshot.id}-clean-plate`, tagName: "IMG", bbox: { x: 0, y: 0, width: snapshot.width, height: snapshot.height }, style: {}, imagePath: cleanPlate, supported: false, fallbackPath: cleanPlate, zIndex: -100_000 }];
    for (const object of snapshot.objects) {
      let imagePath: string | undefined;
      if (object.kind === "image" && object.imageSource) imagePath = await materializeImage(object.imageSource, outputDir);
      const supported = object.kind === "text" || object.kind === "shape" || Boolean(imagePath);
      let fallbackPath: string | undefined;
      if (!supported) {
        fallbackPath = join(outputDir, "editable-fallbacks", `${String(slideIndex + 1).padStart(2, "0")}-${object.id.replace(/[^a-zA-Z0-9._-]/g, "-")}.png`);
        await mkdir(join(outputDir, "editable-fallbacks"), { recursive: true });
        const locator = page.locator(`[data-object-id="${object.id.replaceAll('"', '\\"')}"]`).first();
        await locator.screenshot({ path: fallbackPath, animations: "disabled" });
      }
      elements.push({ id: object.id, tagName: object.tagName, ...(object.text !== undefined ? { text: object.text } : {}), bbox: object.bbox, style: object.style, ...(imagePath ? { imagePath, ...(object.media ? { media: object.media } : {}) } : {}), supported, ...(fallbackPath ? { fallbackPath } : {}), zIndex: object.zIndex });
    }
    slides.push(domSnapshotToSlide(snapshot.id, elements, snapshot.width, snapshot.height));
  }
  return { schemaVersion: 1, title: basename(sourcePath, extname(sourcePath)), slides };
}
