import { layoutDiagram } from "@slides-studio/diagram-kit";
import type { DiagramSpecAny } from "@slides-studio/protocol";

export type SourceKind = "dom" | "diagram" | "visual-scene" | "raster";
export interface BaseObject { id: string; sourceId: string; sourceKind: SourceKind; x: number; y: number; width: number; height: number; zIndex: number; native: boolean; fallbackReason?: string; }
export interface TextObject extends BaseObject { type: "text"; text: string; fontFace?: string; fontSize?: number; color?: string; bold?: boolean; align?: "left" | "center" | "right"; }
export interface ShapeObject extends BaseObject { type: "shape"; shape: "rectangle" | "rounded-rectangle" | "ellipse" | "line"; fill?: string; stroke?: string; radius?: number; }
export interface ConnectorObject extends BaseObject { type: "connector"; points: Array<{ x: number; y: number }>; stroke?: string; dashed?: boolean; endArrow?: boolean; label?: string; }
export interface ImagePlacementMetadata {
  fit?: "contain" | "cover" | "stretch";
  crop?: { x: number; y: number; width: number; height: number };
  focal?: { x: number; y: number };
  pan?: { x: number; y: number };
  zoom?: number;
  rotation?: number;
  alt?: string;
  layoutSlot?: string;
  sourceDimensions?: { width: number; height: number };
}
export interface ImageObject extends BaseObject, ImagePlacementMetadata { type: "image"; path: string; }
export interface SvgObject extends BaseObject { type: "svg"; svg: string; }
export interface RasterRegionObject extends BaseObject { type: "raster-region"; path: string; }
export type PresentationObject = TextObject | ShapeObject | ConnectorObject | ImageObject | SvgObject | RasterRegionObject;
export interface PresentationSlide { id: string; width: number; height: number; objects: PresentationObject[]; }
export interface PresentationObjectGraphV1 { schemaVersion: 1; title: string; slides: PresentationSlide[]; }

function graphError(message: string): never { throw new TypeError(`Invalid presentation object graph: ${message}`); }
function finite(value: unknown, label: string, nonnegative = false): number { if (typeof value !== "number" || !Number.isFinite(value) || (nonnegative && value < 0)) graphError(`${label} must be a ${nonnegative ? "nonnegative " : ""}finite number`); return value; }
function identifier(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) graphError(`${label} must be a nonempty string`); return value; }

/** Runtime validation for JSON graphs before any native/fallback inventory is trusted. */
export function parsePresentationObjectGraph(input: unknown): PresentationObjectGraphV1 {
  if (!input || typeof input !== "object") graphError("root must be an object");
  const graph = input as Partial<PresentationObjectGraphV1>;
  if (graph.schemaVersion !== 1) graphError("schemaVersion must be 1"); identifier(graph.title, "title");
  if (!Array.isArray(graph.slides) || graph.slides.length === 0) graphError("slides must be a nonempty array");
  const ids = new Set<string>();
  for (const [slideIndex, slide] of graph.slides.entries()) {
    identifier(slide?.id, `slides[${slideIndex}].id`); finite(slide?.width, `slides[${slideIndex}].width`); finite(slide?.height, `slides[${slideIndex}].height`);
    if (slide.width <= 0 || slide.height <= 0) graphError(`slides[${slideIndex}] dimensions must be positive`);
    if (!Array.isArray(slide.objects)) graphError(`slides[${slideIndex}].objects must be an array`);
    for (const [objectIndex, object] of slide.objects.entries()) {
      const label = `slides[${slideIndex}].objects[${objectIndex}]`; const id = identifier(object?.id, `${label}.id`);
      if (ids.has(id)) graphError(`duplicate object id ${id}`); ids.add(id);
      identifier(object.sourceId, `${label}.sourceId`); if (!(["dom", "diagram", "visual-scene", "raster"] as string[]).includes(object.sourceKind)) graphError(`${label}.sourceKind is unsupported`);
      finite(object.x, `${label}.x`); finite(object.y, `${label}.y`); finite(object.width, `${label}.width`, true); finite(object.height, `${label}.height`, true); finite(object.zIndex, `${label}.zIndex`);
      if (typeof object.native !== "boolean") graphError(`${label}.native must be boolean`); if (!object.native) identifier(object.fallbackReason, `${label}.fallbackReason`);
      if (!(["text", "shape", "connector", "image", "svg", "raster-region"] as string[]).includes(object.type)) graphError(`${label}.type is unsupported`);
      if (object.type === "text") identifier(object.text, `${label}.text`);
      if (object.type === "shape" && !(["rectangle", "rounded-rectangle", "ellipse", "line"] as string[]).includes(object.shape)) graphError(`${label}.shape is unsupported`);
      if (object.type === "connector") { if (!Array.isArray(object.points) || object.points.length < 2) graphError(`${label}.points requires at least two points`); object.points.forEach((point, pointIndex) => { finite(point?.x, `${label}.points[${pointIndex}].x`); finite(point?.y, `${label}.points[${pointIndex}].y`); }); }
      if (object.type === "image" || object.type === "raster-region") identifier(object.path, `${label}.path`);
      if (object.type === "svg") identifier(object.svg, `${label}.svg`);
      if (object.type === "image" && object.crop) { const crop = object.crop; finite(crop.x, `${label}.crop.x`, true); finite(crop.y, `${label}.crop.y`, true); finite(crop.width, `${label}.crop.width`, true); finite(crop.height, `${label}.crop.height`, true); if (crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) graphError(`${label}.crop must be a positive normalized rectangle`); }
    }
  }
  return input as PresentationObjectGraphV1;
}

export const presentationObjectGraphSchema = { parse: parsePresentationObjectGraph } as const;

export interface DomSnapshotElement { id: string; tagName: string; text?: string; bbox: { x: number; y: number; width: number; height: number }; style: Record<string, string | number | undefined>; imagePath?: string; media?: ImagePlacementMetadata; supported: boolean; fallbackPath?: string; zIndex?: number; }

export function domSnapshotToSlide(slideId: string, elements: DomSnapshotElement[], width = 1920, height = 1080): PresentationSlide {
  const objects: PresentationObject[] = [];
  elements.forEach((element, index) => {
    const base = { id: element.id, sourceId: element.id, sourceKind: "dom" as const, ...element.bbox, zIndex: element.zIndex ?? index, native: element.supported };
    if (!element.supported) { if (element.fallbackPath) objects.push({ ...base, type: "raster-region", path: element.fallbackPath, native: false, fallbackReason: "unsupported DOM/CSS feature" }); return; }
    if (element.imagePath) objects.push({ ...base, type: "image", path: element.imagePath, fit: element.media?.fit ?? "contain", ...element.media });
    else if (element.text !== undefined) objects.push({ ...base, type: "text", text: element.text, fontFace: String(element.style.fontFamily ?? "Arial"), fontSize: Number(element.style.fontSize ?? 24), color: String(element.style.color ?? "#000000"), bold: Number(element.style.fontWeight ?? 400) >= 600, align: (element.style.textAlign as TextObject["align"]) ?? "left" });
    else objects.push({ ...base, type: "shape", shape: "rectangle", fill: String(element.style.backgroundColor ?? "#ffffff"), stroke: String(element.style.borderColor ?? "#000000") });
  });
  return { id: slideId, width, height, objects };
}

export function diagramToSlide(spec: DiagramSpecAny, slideId = spec.id): PresentationSlide {
  const layout = layoutDiagram(spec);
  const objects: PresentationObject[] = layout.primitives.map((primitive): PresentationObject => {
    const base = { id: primitive.id, sourceId: primitive.sourceId, sourceKind: "diagram" as const, zIndex: primitive.z, native: true };
    if (primitive.kind === "rect") return { ...base, type: "shape", x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height, shape: primitive.radius > 0 ? "rounded-rectangle" : "rectangle", fill: primitive.fill, stroke: primitive.stroke, radius: primitive.radius };
    if (primitive.kind === "ellipse") return { ...base, type: "shape", x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height, shape: "ellipse", fill: primitive.fill, stroke: primitive.stroke };
    if (primitive.kind === "text") return { ...base, type: "text", x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height, text: primitive.text, fontFace: primitive.fontFamily, fontSize: primitive.fontSize, color: primitive.color, bold: (primitive.fontWeight ?? 400) >= 600, align: primitive.align ?? "center" };
    const xs = primitive.points.map((point) => point.x); const ys = primitive.points.map((point) => point.y);
    const x = xs.length ? Math.min(...xs) : 0; const y = ys.length ? Math.min(...ys) : 0;
    const width = xs.length ? Math.max(...xs) - x : 0; const height = ys.length ? Math.max(...ys) - y : 0;
    return { ...base, type: "connector", x, y, width, height, points: primitive.points, stroke: primitive.stroke, dashed: primitive.dashed ?? false, endArrow: primitive.endArrow ?? false, ...(primitive.label ? { label: primitive.label } : {}) };
  });
  return { id: slideId, width: layout.width, height: layout.height, objects: objects.toSorted((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id)) };
}

export interface VisualSceneInput { slideId: string; width: number; height: number; cleanPlate: string; elements: Array<{ id: string; type: "native_text" | "native_shape" | "connector" | "image_layer" | "raster_region"; bbox: [number, number, number, number]; zIndex: number; content?: string; style?: Record<string, unknown>; asset?: string; media?: ImagePlacementMetadata }>; }
export function visualSceneToSlide(scene: VisualSceneInput): PresentationSlide {
  const objects: PresentationObject[] = [{ id: `${scene.slideId}-clean-plate`, sourceId: "clean_plate", sourceKind: "visual-scene", type: "image", x: 0, y: 0, width: scene.width, height: scene.height, zIndex: 0, native: false, fallbackReason: "visual-master clean plate", path: scene.cleanPlate, fit: "stretch" }];
  for (const element of scene.elements) {
    const [x, y, width, height] = element.bbox;
    const base = { id: element.id, sourceId: element.id, sourceKind: "visual-scene" as const, x, y, width, height, zIndex: element.zIndex, native: element.type !== "raster_region" };
    if (element.type === "native_text") objects.push({ ...base, type: "text", text: element.content ?? "", fontFace: String(element.style?.fontFace ?? "Arial"), fontSize: Number(element.style?.fontSize ?? 24), color: String(element.style?.color ?? "#000000"), bold: Boolean(element.style?.bold), align: "left" });
    else if (element.type === "native_shape") objects.push({ ...base, type: "shape", shape: "rectangle", fill: String(element.style?.fill ?? "#ffffff"), stroke: String(element.style?.stroke ?? "#000000") });
    else if (element.type === "connector") objects.push({ ...base, type: "connector", points: [{ x, y: y + height / 2 }, { x: x + width, y: y + height / 2 }], stroke: String(element.style?.stroke ?? "#000000"), dashed: Boolean(element.style?.dashed), endArrow: element.style?.endArrow !== false, ...(element.content ? { label: element.content } : {}) });
    else if (element.type === "image_layer" && element.asset) objects.push({ ...base, type: "image", path: element.asset, fit: element.media?.fit ?? "contain", ...element.media });
    else if (element.asset) objects.push({ ...base, type: "raster-region", path: element.asset, native: false, fallbackReason: "declared visual-scene raster fallback" });
  }
  return { id: scene.slideId, width: scene.width, height: scene.height, objects: objects.toSorted((left, right) => left.zIndex - right.zIndex) };
}

export function summarizeGraph(graph: PresentationObjectGraphV1): { native: number; fallback: number; byType: Record<string, number>; reasons: Record<string, number> } {
  const summary = { native: 0, fallback: 0, byType: {} as Record<string, number>, reasons: {} as Record<string, number> };
  for (const object of graph.slides.flatMap((slide) => slide.objects)) { object.native ? summary.native++ : summary.fallback++; summary.byType[object.type] = (summary.byType[object.type] ?? 0) + 1; if (object.fallbackReason) summary.reasons[object.fallbackReason] = (summary.reasons[object.fallbackReason] ?? 0) + 1; }
  return summary;
}
