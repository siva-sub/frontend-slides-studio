import { resolveNativeShapePreset, type ShapePresetInput } from "@slides-studio/pptx-compat/browser";

export interface NativeShapeInsertOptions {
  fill?: string;
  stroke?: string;
  text?: string;
  gradient?: { angle: number; stops: Array<{ color: string; position: number; transparency?: number }> };
}
export interface InsertedNativeShape { html: string; objectId: string; preset: string; }

const previewClip = (preset: string): string | undefined => {
  if (preset === "chevron" || preset.endsWith("Arrow")) return "polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%)";
  if (preset === "triangle" || preset === "rtTriangle") return "polygon(50% 0,100% 100%,0 100%)";
  if (preset === "diamond" || preset === "flowChartDecision") return "polygon(50% 0,100% 50%,50% 100%,0 50%)";
  if (preset === "parallelogram" || preset === "flowChartInputOutput") return "polygon(18% 0,100% 0,82% 100%,0 100%)";
  if (preset.startsWith("star")) return "polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 94%,50% 72%,21% 94%,32% 57%,2% 35%,39% 35%)";
  if (preset === "ellipse" || preset === "flowChartConnector") return "ellipse(50% 50% at 50% 50%)";
  return undefined;
};

export function insertNativePptxShape(html: string, slideIndex: number, requested: ShapePresetInput | string, options: NativeShapeInsertOptions = {}): InsertedNativeShape {
  const resolved = resolveNativeShapePreset(requested);
  if (!resolved) throw new Error(`${requested} has no schema-valid native PowerPoint preset.`);
  const document = new DOMParser().parseFromString(html, "text/html");
  const slide = document.querySelectorAll<HTMLElement>(".slide")[slideIndex];
  if (!slide) throw new Error(`Slide ${slideIndex + 1} does not exist.`);
  const prefix = `pptx-${resolved.preset}`;
  const existing = new Set(Array.from(document.querySelectorAll<HTMLElement>("[data-object-id]")).map((element) => element.dataset.objectId));
  let suffix = 1; while (existing.has(`${prefix}-${suffix}`)) suffix += 1;
  const objectId = `${prefix}-${suffix}`;
  const element = document.createElement("div");
  element.dataset.objectId = objectId;
  element.dataset.sourceId = objectId;
  element.dataset.pptxShape = resolved.preset;
  element.dataset.pptxFill = options.fill ?? "#DBEAFE";
  element.dataset.pptxStroke = options.stroke ?? "#1D4ED8";
  element.dataset.pptxLineWidth = "2";
  if (options.gradient) element.dataset.pptxGradient = JSON.stringify(options.gradient);
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `${resolved.preset} PowerPoint shape`);
  element.textContent = options.text ?? resolved.preset;
  const clip = previewClip(resolved.preset);
  element.style.cssText = `position:absolute;left:30%;top:30%;width:40%;height:26%;display:grid;place-items:center;padding:20px;box-sizing:border-box;background:${element.dataset.pptxFill};border:2px solid ${element.dataset.pptxStroke};color:#172033;font:700 28px/1.15 Arial,sans-serif;text-align:center;${clip ? `clip-path:${clip};` : ""}`;
  slide.append(element);
  return { html: `<!doctype html>\n${document.documentElement.outerHTML}`, objectId, preset: resolved.preset };
}
