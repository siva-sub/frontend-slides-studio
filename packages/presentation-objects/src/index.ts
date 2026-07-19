import { layoutDiagram } from "@slides-studio/diagram-kit";
import { assertNativePptxTransition, resolveNativeShapePreset, type NativePptxTransition, type NativeTransitionMapping, type ShapePresetInput } from "@slides-studio/pptx-compat/browser";
import type { DiagramSpecAny } from "@slides-studio/protocol";

export type SourceKind = "dom" | "diagram" | "visual-scene" | "raster";
export interface BaseObject { id: string; sourceId: string; sourceKind: SourceKind; x: number; y: number; width: number; height: number; zIndex: number; native: boolean; fallbackReason?: string; }
export interface TextObject extends BaseObject { type: "text"; text: string; fontFace?: string; fontSize?: number; color?: string; bold?: boolean; align?: "left" | "center" | "right"; }
export interface ShapeGradientStop { color: string; position: number; transparency?: number; }
export interface ShapeGradient { angle: number; stops: ShapeGradientStop[]; }
export interface ShapeObject extends BaseObject {
  type: "shape";
  shape: ShapePresetInput;
  fill?: string;
  fillTransparency?: number;
  gradient?: ShapeGradient;
  stroke?: string;
  lineWidth?: number;
  lineTransparency?: number;
  lineDash?: "solid" | "dash" | "dashDot" | "lgDash" | "lgDashDot" | "lgDashDotDot" | "sysDash" | "sysDot";
  beginArrow?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
  endArrow?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
  radius?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  text?: string;
  fontFace?: string;
  fontSize?: number;
  textColor?: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
  hyperlink?: { url: string; tooltip?: string };
}
export interface ConnectorObject extends BaseObject { type: "connector"; points: Array<{ x: number; y: number }>; stroke?: string; dashed?: boolean; endArrow?: boolean; label?: string; }
export interface TableCellObject { text: string; fill?: string; color?: string; bold?: boolean; align?: "left" | "center" | "right"; colspan?: number; rowspan?: number; }
export interface TableObject extends BaseObject { type: "table"; rows: TableCellObject[][]; columnWidths?: number[]; rowHeights?: number[]; fontFace?: string; fontSize?: number; borderColor?: string; borderWidth?: number; }
export type NativeChartType = "bar" | "barHorizontal" | "barStacked" | "barStacked100" | "line" | "lineMarkers" | "lineStacked" | "pie" | "doughnut" | "area" | "areaStacked" | "areaStacked100" | "radar" | "radarFilled";
export interface ChartSeriesObject { name: string; labels: string[]; values: number[]; color?: string; }
export interface ChartObject extends BaseObject { type: "chart"; chartType: NativeChartType; series: ChartSeriesObject[]; title?: string; showLegend?: boolean; showValue?: boolean; showCategoryName?: boolean; colors?: string[]; }

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
export type PresentationObject = TextObject | ShapeObject | ConnectorObject | TableObject | ChartObject | ImageObject | SvgObject | RasterRegionObject;
export interface PresentationSlide { id: string; width: number; height: number; objects: PresentationObject[]; notes?: string; nativeTransition?: NativePptxTransition; transitionMapping?: NativeTransitionMapping; }
export interface PresentationObjectGraphV1 { schemaVersion: 1; title: string; slides: PresentationSlide[]; }

function graphError(message: string): never { throw new TypeError(`Invalid presentation object graph: ${message}`); }
function finite(value: unknown, label: string, nonnegative = false): number { if (typeof value !== "number" || !Number.isFinite(value) || (nonnegative && value < 0)) graphError(`${label} must be a ${nonnegative ? "nonnegative " : ""}finite number`); return value; }
function identifier(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) graphError(`${label} must be a nonempty string`); return value; }

function resolvedTableColumnCount(rows: TableCellObject[][], label: string): number {
  const occupiedUntil: number[] = [];
  const coverage: boolean[][] = [];
  rows.forEach((row, rowIndex) => {
    const rowCoverage = occupiedUntil.map((endRow) => endRow > rowIndex);
    let cursor = 0;
    row.forEach((cell, cellIndex) => {
      if (typeof cell?.text !== "string") graphError(`${label}.rows[${rowIndex}][${cellIndex}].text must be a string`);
      for (const [name, span] of [["colspan", cell.colspan], ["rowspan", cell.rowspan]] as const) if (span !== undefined && (!Number.isInteger(span) || span < 1)) graphError(`${label}.rows[${rowIndex}][${cellIndex}].${name} must be a positive integer`);
      const colspan = cell.colspan ?? 1; const rowspan = cell.rowspan ?? 1;
      if (rowIndex + rowspan > rows.length) graphError(`${label}.rows[${rowIndex}][${cellIndex}].rowspan exceeds the table row count`);
      while (true) {
        while ((occupiedUntil[cursor] ?? 0) > rowIndex) cursor += 1;
        let blockedAt = -1;
        for (let offset = 0; offset < colspan; offset += 1) if ((occupiedUntil[cursor + offset] ?? 0) > rowIndex) { blockedAt = offset; break; }
        if (blockedAt < 0) break;
        cursor += blockedAt + 1;
      }
      for (let offset = 0; offset < colspan; offset += 1) { const column = cursor + offset; occupiedUntil[column] = Math.max(occupiedUntil[column] ?? 0, rowIndex + rowspan); rowCoverage[column] = true; }
      cursor += colspan;
    });
    coverage.push(rowCoverage);
  });
  const columnCount = Math.max(0, ...coverage.map((row) => row.length));
  if (columnCount === 0 || coverage.some((row) => Array.from({ length: columnCount }, (_, column) => row[column] === true).includes(false))) graphError(`${label}.rows must resolve to the same column count after row and column spans`);
  return columnCount;
}

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
    if (slide.notes !== undefined && typeof slide.notes !== "string") graphError(`slides[${slideIndex}].notes must be a string`);
    if (slide.nativeTransition) {
      try { assertNativePptxTransition(slide.nativeTransition); }
      catch (error) { graphError(`slides[${slideIndex}].nativeTransition is invalid: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (!Array.isArray(slide.objects)) graphError(`slides[${slideIndex}].objects must be an array`);
    for (const [objectIndex, object] of slide.objects.entries()) {
      const label = `slides[${slideIndex}].objects[${objectIndex}]`; const id = identifier(object?.id, `${label}.id`);
      if (ids.has(id)) graphError(`duplicate object id ${id}`); ids.add(id);
      identifier(object.sourceId, `${label}.sourceId`); if (!(["dom", "diagram", "visual-scene", "raster"] as string[]).includes(object.sourceKind)) graphError(`${label}.sourceKind is unsupported`);
      finite(object.x, `${label}.x`); finite(object.y, `${label}.y`); finite(object.width, `${label}.width`, true); finite(object.height, `${label}.height`, true); finite(object.zIndex, `${label}.zIndex`);
      if (typeof object.native !== "boolean") graphError(`${label}.native must be boolean`); if (!object.native) identifier(object.fallbackReason, `${label}.fallbackReason`);
      if (!(["text", "shape", "connector", "table", "chart", "image", "svg", "raster-region"] as string[]).includes(object.type)) graphError(`${label}.type is unsupported`);
      if (object.type === "text") identifier(object.text, `${label}.text`);
      if (object.type === "shape") {
        if (!resolveNativeShapePreset(object.shape)) graphError(`${label}.shape is unsupported or has no schema-valid compatibility mapping`);
        if (object.rotation !== undefined) finite(object.rotation, `${label}.rotation`);
        for (const [key, value] of [["fillTransparency", object.fillTransparency], ["lineTransparency", object.lineTransparency]] as const) if (value !== undefined && (finite(value, `${label}.${key}`) < 0 || value > 100)) graphError(`${label}.${key} must be from 0 to 100`);
        if (object.lineWidth !== undefined && finite(object.lineWidth, `${label}.lineWidth`) < 0) graphError(`${label}.lineWidth must be nonnegative`);
        if (object.fill && object.gradient) graphError(`${label} cannot declare both fill and gradient`);
        if (object.gradient) {
          finite(object.gradient.angle, `${label}.gradient.angle`);
          if (!Array.isArray(object.gradient.stops) || object.gradient.stops.length < 2) graphError(`${label}.gradient requires at least two stops`);
          object.gradient.stops.forEach((stop, stopIndex) => { identifier(stop?.color, `${label}.gradient.stops[${stopIndex}].color`); const position = finite(stop?.position, `${label}.gradient.stops[${stopIndex}].position`); if (position < 0 || position > 1) graphError(`${label}.gradient.stops[${stopIndex}].position must be from 0 to 1`); if (stop.transparency !== undefined && (finite(stop.transparency, `${label}.gradient.stops[${stopIndex}].transparency`) < 0 || stop.transparency > 100)) graphError(`${label}.gradient.stops[${stopIndex}].transparency must be from 0 to 100`); });
        }
        if (object.hyperlink) { const url = identifier(object.hyperlink.url, `${label}.hyperlink.url`); if (/^(?:javascript|vbscript|data):/i.test(url.trim())) graphError(`${label}.hyperlink.url uses an unsafe scheme`); }
      }
      if (object.type === "connector") { if (!Array.isArray(object.points) || object.points.length < 2) graphError(`${label}.points requires at least two points`); object.points.forEach((point, pointIndex) => { finite(point?.x, `${label}.points[${pointIndex}].x`); finite(point?.y, `${label}.points[${pointIndex}].y`); }); }
      if (object.type === "table") {
        if (!Array.isArray(object.rows) || object.rows.length === 0 || object.rows.some((row) => !Array.isArray(row) || row.length === 0)) graphError(`${label}.rows must be a nonempty rectangular cell matrix`);
        const columnCount = resolvedTableColumnCount(object.rows, label);
        if (object.columnWidths && (object.columnWidths.length !== columnCount || object.columnWidths.some((value, index) => finite(value, `${label}.columnWidths[${index}]`) <= 0))) graphError(`${label}.columnWidths must contain one positive value per resolved column`);
        if (object.rowHeights && (object.rowHeights.length !== object.rows.length || object.rowHeights.some((value, index) => finite(value, `${label}.rowHeights[${index}]`) <= 0))) graphError(`${label}.rowHeights must contain one positive value per row`);
      }
      if (object.type === "chart") {
        const chartTypes: NativeChartType[] = ["bar", "barHorizontal", "barStacked", "barStacked100", "line", "lineMarkers", "lineStacked", "pie", "doughnut", "area", "areaStacked", "areaStacked100", "radar", "radarFilled"];
        if (!chartTypes.includes(object.chartType)) graphError(`${label}.chartType is unsupported`);
        if (!Array.isArray(object.series) || object.series.length === 0) graphError(`${label}.series must be nonempty`);
        object.series.forEach((series, seriesIndex) => { identifier(series?.name, `${label}.series[${seriesIndex}].name`); if (!Array.isArray(series.labels) || !Array.isArray(series.values) || series.labels.length === 0 || series.labels.length !== series.values.length) graphError(`${label}.series[${seriesIndex}] labels and values must be equal nonempty arrays`); series.labels.forEach((value, index) => identifier(value, `${label}.series[${seriesIndex}].labels[${index}]`)); series.values.forEach((value, index) => finite(value, `${label}.series[${seriesIndex}].values[${index}]`)); });
      }
      if (object.type === "image" || object.type === "raster-region") identifier(object.path, `${label}.path`);
      if (object.type === "svg") identifier(object.svg, `${label}.svg`);
      if (object.type === "image" && object.crop) { const crop = object.crop; finite(crop.x, `${label}.crop.x`, true); finite(crop.y, `${label}.crop.y`, true); finite(crop.width, `${label}.crop.width`, true); finite(crop.height, `${label}.crop.height`, true); if (crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) graphError(`${label}.crop must be a positive normalized rectangle`); }
    }
  }
  return input as PresentationObjectGraphV1;
}

export const presentationObjectGraphSchema = { parse: parsePresentationObjectGraph } as const;

export type NativeShapeMetadata = Pick<ShapeObject, "shape" | "fill" | "fillTransparency" | "gradient" | "stroke" | "lineWidth" | "lineTransparency" | "lineDash" | "beginArrow" | "endArrow" | "radius" | "rotation" | "flipH" | "flipV" | "text" | "fontFace" | "fontSize" | "textColor" | "bold" | "align" | "hyperlink">;
export type NativeTableMetadata = Pick<TableObject, "rows" | "columnWidths" | "rowHeights" | "fontFace" | "fontSize" | "borderColor" | "borderWidth">;
export type NativeChartMetadata = Pick<ChartObject, "chartType" | "series" | "title" | "showLegend" | "showValue" | "showCategoryName" | "colors">;
export interface DomSnapshotElement { id: string; tagName: string; text?: string; bbox: { x: number; y: number; width: number; height: number }; style: Record<string, string | number | undefined>; imagePath?: string; media?: ImagePlacementMetadata; nativeShape?: NativeShapeMetadata; nativeTable?: NativeTableMetadata; nativeChart?: NativeChartMetadata; supported: boolean; fallbackPath?: string; zIndex?: number; }

export function domSnapshotToSlide(slideId: string, elements: DomSnapshotElement[], width = 1920, height = 1080): PresentationSlide {
  const objects: PresentationObject[] = [];
  elements.forEach((element, index) => {
    const base = { id: element.id, sourceId: element.id, sourceKind: "dom" as const, ...element.bbox, zIndex: element.zIndex ?? index, native: element.supported };
    if (!element.supported) { if (element.fallbackPath) objects.push({ ...base, type: "raster-region", path: element.fallbackPath, native: false, fallbackReason: "unsupported DOM/CSS feature" }); return; }
    if (element.imagePath) objects.push({ ...base, type: "image", path: element.imagePath, fit: element.media?.fit ?? "contain", ...element.media });
    else if (element.nativeShape) objects.push({ ...base, type: "shape", ...element.nativeShape });
    else if (element.nativeTable) objects.push({ ...base, type: "table", ...element.nativeTable });
    else if (element.nativeChart) objects.push({ ...base, type: "chart", ...element.nativeChart });
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

export function placeDiagramObjects(spec: DiagramSpecAny, frame: { x: number; y: number; width: number; height: number }, prefix = `diagram-${spec.id}`, hostZIndex?: number): PresentationObject[] {
  const source = diagramToSlide(spec);
  const scaleX = frame.width / source.width; const scaleY = frame.height / source.height; const fontScale = Math.min(scaleX, scaleY);
  return source.objects.map((object, index): PresentationObject => {
    const zIndex = hostZIndex === undefined ? object.zIndex : hostZIndex + ((index + 1) / (source.objects.length + 1)) * 0.001;
    const placement = { id: `${prefix}-${object.id}`, x: frame.x + object.x * scaleX, y: frame.y + object.y * scaleY, width: object.width * scaleX, height: object.height * scaleY, zIndex };
    if (object.type === "connector") return { ...object, ...placement, points: object.points.map((point) => ({ x: frame.x + point.x * scaleX, y: frame.y + point.y * scaleY })) };
    if (object.type === "text") return { ...object, ...placement, ...(object.fontSize !== undefined ? { fontSize: object.fontSize * fontScale } : {}) };
    if (object.type === "shape") return { ...object, ...placement };
    if (object.type === "table") return { ...object, ...placement };
    if (object.type === "chart") return { ...object, ...placement };
    if (object.type === "image") return { ...object, ...placement };
    if (object.type === "svg") return { ...object, ...placement };
    return { ...object, ...placement };
  });
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
