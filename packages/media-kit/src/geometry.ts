/**
 * @slides-studio/media-kit — deterministic media placement geometry.
 *
 * Browser-safe: no Node built-ins. Pure finite-math placement shared by the
 * Studio renderer, the export pipeline, and the PPTX exporter so that a single
 * source crop + destination rectangle + exact CSS reproduction metadata is
 * computed once and reproduced identically everywhere.
 *
 * Invariants enforced for every result:
 *   - Aspect ratio is preserved: the source crop aspect ratio always equals the
 *     destination rectangle aspect ratio (no distortion).
 *   - All bounds are finite and positive (crop/destination/scale are validated).
 *   - "cover" never exposes empty area: the crop is fully contained in the
 *     source and the destination fills the slot exactly.
 *   - The `css` block is the authoritative reproduction: a clipping container of
 *     the destination size holds the full source scaled and offset so exactly
 *     the crop is visible. objectFit/objectPosition are convenience only.
 */

/** Integer or fractional pixel dimensions. */
export interface Dimensions {
  width: number;
  height: number;
}

/** An axis-aligned rectangle in pixel (or normalized) space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A 2D point. */
export interface Point {
  x: number;
  y: number;
}

/** Containment strategy, mirroring CSS `object-fit`. */
export type Fit = "contain" | "cover";

/**
 * A source-normalized [0,1] rectangle that stays within the unit box. Kept
 * structurally identical to the protocol `NormalizedRect` so results compose
 * with layout slots without an extra dependency.
 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_ZOOM = 1e-6;
/** Largest supported zoom factor (matches the protocol placement contract). */
export const MAX_ZOOM = 10;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number (received ${String(value)})`);
  }
}

function assertPositiveDimensions(d: Dimensions, label: string): void {
  assertFinite(d.width, `${label}.width`);
  assertFinite(d.height, `${label}.height`);
  if (d.width <= 0 || d.height <= 0) {
    throw new RangeError(`${label} dimensions must be positive (received ${d.width}x${d.height})`);
  }
}

/**
 * Authoritative CSS reproduction of a placement. The container clips to the
 * destination rectangle (overflow hidden); the full source image is rendered
 * absolutely inside it, scaled by `scale` and offset so exactly the crop region
 * is visible. The CSS-implied visible source crop equals {@link PlacementResult.crop}.
 */
export interface PlacementCss {
  /** Clipping container sized to the destination rectangle. */
  container: { width: number; height: number; overflow: "hidden"; transformOrigin: string; transform: string };
  /** Absolutely-positioned full-source image element. */
  image: { position: "absolute"; width: number; height: number; left: number; top: number };
}

/**
 * Inputs to {@link computePlacement}. Dimensions are concrete pixels; use
 * {@link computePlacementNormalized} for resolution-independent normalized
 * slots.
 */
export interface PlacementInput {
  /** Intrinsic source pixel dimensions. */
  source: Dimensions;
  /** Destination frame (slot) in canvas pixels. */
  slot: Rect;
  fit: Fit;
  /** Source-normalized focal anchor [0,1]; defaults to the center {0.5,0.5}. */
  focal?: Point;
  /**
   * Additional source-normalized offset added to the focal anchor; defaults to
   * {0,0}. `focal + pan` selects the visible crop center.
   */
  pan?: Point;
  /** Zoom factor; defaults to 1. Values >1 zoom in (smaller crop); 0 is clamped. */
  zoom?: number;
  /** Presentation-only rotation in degrees; carried through as a CSS transform. */
  rotation?: number;
}

/** A fully resolved placement. */
export interface PlacementResult {
  fit: Fit;
  /** Exact axis-aligned source crop in source pixels. */
  crop: Rect;
  /** Destination rectangle in canvas pixels. */
  destination: Rect;
  /** Source->canvas scale factor applied to the crop. */
  scale: number;
  /** Authoritative CSS reproduction metadata. */
  css: PlacementCss;
  /** CSS `object-fit` keyword (convenience, not authoritative). */
  objectFit: Fit;
  /** CSS `object-position` percentage string (convenience, not authoritative). */
  objectPosition: string;
  /** CSS `transform` string (e.g. `rotate(8deg)`) or "" when unrotated. */
  transform: string;
  /** Echoed inputs for traceability. */
  source: Dimensions;
  slot: Rect;
}

/** Result of {@link computePlacementNormalized}. */
export interface NormalizedPlacementResult extends PlacementResult {
  /** Crop expressed in source-normalized [0,1] coordinates. */
  cropNormalized: NormalizedRect;
  /** Destination expressed in canvas-normalized [0,1] coordinates. */
  destinationNormalized: NormalizedRect;
}

function rotateTransform(rotation: number): string {
  return rotation === 0 ? "" : `rotate(${rotation}deg)`;
}

/**
 * Build the authoritative CSS reproduction: a clipping container of the
 * destination size holding the full source scaled by `scale` and offset so the
 * crop origin aligns with the container origin.
 */
function buildCss(source: Dimensions, crop: Rect, destination: Rect, scale: number, rotation: number): PlacementCss {
  const transform = rotateTransform(rotation);
  return {
    container: {
      width: destination.width,
      height: destination.height,
      overflow: "hidden",
      transformOrigin: "center",
      transform,
    },
    image: {
      position: "absolute",
      width: source.width * scale,
      height: source.height * scale,
      left: -(crop.x * scale),
      top: -(crop.y * scale),
    },
  };
}

/**
 * Cover-mode object-position: the percentage of the source the crop origin
 * represents, given the slack between crop and source. Falls back to 50% when
 * there is no slack in a dimension (crop fills that axis).
 */
function coverObjectPosition(crop: Rect, source: Dimensions): string {
  const slackX = source.width - crop.width;
  const slackY = source.height - crop.height;
  const px = slackX > 0 ? (crop.x / slackX) * 100 : 50;
  const py = slackY > 0 ? (crop.y / slackY) * 100 : 50;
  return `${px}% ${py}%`;
}

/**
 * Contain-mode object-position: the percentage of slot slack the destination
 * origin consumes. Falls back to 50% when the destination fills the slot axis.
 */
function containObjectPosition(destination: Rect, slot: Rect): string {
  const slackX = slot.width - destination.width;
  const slackY = slot.height - destination.height;
  const px = slackX > 0 ? ((destination.x - slot.x) / slackX) * 100 : 50;
  const py = slackY > 0 ? ((destination.y - slot.y) / slackY) * 100 : 50;
  return `${px}% ${py}%`;
}

/**
 * Shrink a cover crop so it stays within the source while preserving the slot
 * aspect ratio. Runs a bounded fix-up so an over-large zoom-out crop collapses
 * to the largest in-bounds crop of the correct aspect.
 */
function capCoverCrop(cropW: number, cropH: number, source: Dimensions, slotAspect: number): { width: number; height: number } {
  let width = cropW;
  let height = cropH;
  for (let pass = 0; pass < 2; pass += 1) {
    if (width > source.width) {
      width = source.width;
      height = width / slotAspect;
    }
    if (height > source.height) {
      height = source.height;
      width = height * slotAspect;
    }
  }
  return { width, height };
}

function resolveFocal(input: PlacementInput): { cx: number; cy: number } {
  const focal = input.focal ?? { x: 0.5, y: 0.5 };
  assertFinite(focal.x, "focal.x");
  assertFinite(focal.y, "focal.y");
  const pan = input.pan ?? { x: 0, y: 0 };
  assertFinite(pan.x, "pan.x");
  assertFinite(pan.y, "pan.y");
  const fx = clamp(focal.x, 0, 1) + pan.x;
  const fy = clamp(focal.y, 0, 1) + pan.y;
  return { cx: fx, cy: fy };
}

/** Assert a computed rect is finite and (optionally) positive. */
function assertResultRect(rect: Rect, label: string, requirePositive: boolean): void {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    throw new RangeError(`${label} is not finite`);
  }
  if (requirePositive && (rect.width <= 0 || rect.height <= 0)) {
    throw new RangeError(`${label} must have positive width/height (received ${rect.width}x${rect.height})`);
  }
}

/**
 * Compute an exact placement from concrete pixel dimensions.
 *
 * Cover semantics: the destination fills the slot exactly (no empty area); the
 * crop is the largest in-bounds source region of the slot aspect, narrowed by
 * zoom and centered on the effective focal point.
 *
 * Contain semantics: the destination is the largest centered rectangle of the
 * source aspect that fits inside the slot; the crop is the whole source at
 * zoom=1, narrowing to the focal sub-region when zoomed in. Focal/zoom select
 * the visible crop; the displayed rectangle stays centered in the slot.
 */
export function computePlacement(input: PlacementInput): PlacementResult {
  assertPositiveDimensions(input.source, "source");
  assertFinite(input.slot.x, "slot.x");
  assertFinite(input.slot.y, "slot.y");
  assertFinite(input.slot.width, "slot.width");
  assertFinite(input.slot.height, "slot.height");
  if (input.slot.width <= 0 || input.slot.height <= 0) {
    throw new RangeError(`slot dimensions must be positive (received ${input.slot.width}x${input.slot.height})`);
  }
  if (input.fit !== "contain" && input.fit !== "cover") {
    throw new RangeError(`fit must be "contain" or "cover" (received ${String(input.fit)})`);
  }
  const zoomRaw = input.zoom ?? 1;
  assertFinite(zoomRaw, "zoom");
  if (zoomRaw < 0) {
    throw new RangeError(`zoom must be >= 0 (received ${zoomRaw})`);
  }
  const zoom = clamp(zoomRaw, MIN_ZOOM, MAX_ZOOM);
  const rotation = input.rotation ?? 0;
  assertFinite(rotation, "rotation");

  const { source, slot, fit } = input;
  const slotAspect = slot.width / slot.height;
  const { cx: fxN, cy: fyN } = resolveFocal(input);

  let crop: Rect;
  let destination: Rect;
  let scale: number;

  if (fit === "cover") {
    destination = { x: slot.x, y: slot.y, width: slot.width, height: slot.height };
    const baseScale = Math.max(slot.width / source.width, slot.height / source.height);
    const capped = capCoverCrop(slot.width / baseScale / zoom, slot.height / baseScale / zoom, source, slotAspect);
    const cropW = capped.width;
    const cropH = capped.height;
    const cx = clamp(fxN * source.width, cropW / 2, source.width - cropW / 2);
    const cy = clamp(fyN * source.height, cropH / 2, source.height - cropH / 2);
    crop = { x: cx - cropW / 2, y: cy - cropH / 2, width: cropW, height: cropH };
    scale = destination.width / cropW;
  } else {
    // contain
    const baseScale = Math.min(slot.width / source.width, slot.height / source.height);
    const destW = source.width * baseScale;
    const destH = source.height * baseScale;
    const cropW = Math.min(source.width / zoom, source.width);
    const cropH = Math.min(source.height / zoom, source.height);
    const cx = clamp(fxN * source.width, cropW / 2, source.width - cropW / 2);
    const cy = clamp(fyN * source.height, cropH / 2, source.height - cropH / 2);
    crop = { x: cx - cropW / 2, y: cy - cropH / 2, width: cropW, height: cropH };
    const destCx = slot.x + slot.width / 2;
    const destCy = slot.y + slot.height / 2;
    destination = { x: destCx - destW / 2, y: destCy - destH / 2, width: destW, height: destH };
    scale = destW / cropW;
  }

  // Validate all computed outputs are finite and positive (reject degenerate
  // arithmetic, e.g. from extreme Number.MIN_VALUE/MAX_VALUE inputs).
  assertResultRect(crop, "crop", true);
  assertResultRect(destination, "destination", true);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError(`scale must be finite and positive (received ${scale})`);
  }

  const objectPosition = fit === "cover" ? coverObjectPosition(crop, source) : containObjectPosition(destination, slot);
  return {
    fit,
    crop,
    destination,
    scale,
    css: buildCss(source, crop, destination, scale, rotation),
    objectFit: fit,
    objectPosition,
    transform: rotateTransform(rotation),
    source,
    slot,
  };
}

/**
 * Compute a placement from a normalized [0,1] slot. The normalized crop is
 * resolution-independent: two canvases with the same aspect ratio (e.g.
 * 1280x720 and 1920x1080) yield identical normalized crops and destinations.
 *
 * `canvas` defaults to a 16:9 unit canvas; supply the concrete canvas to obtain
 * exact pixel results alongside the normalized rectangles.
 */
export interface NormalizedPlacementInput {
  source: Dimensions;
  slot: NormalizedRect;
  canvas?: Dimensions;
  fit: Fit;
  focal?: Point;
  pan?: Point;
  zoom?: number;
  rotation?: number;
}

export function computePlacementNormalized(input: NormalizedPlacementInput): NormalizedPlacementResult {
  const canvas = input.canvas ?? { width: 1280, height: 720 };
  assertPositiveDimensions(canvas, "canvas");
  const { source, slot } = input;
  assertFinite(slot.x, "slot.x");
  assertFinite(slot.y, "slot.y");
  assertFinite(slot.width, "slot.width");
  assertFinite(slot.height, "slot.height");
  // Strict [0,1] containment: no tolerance leak.
  if (!(slot.x >= 0 && slot.y >= 0 && slot.x + slot.width <= 1 && slot.y + slot.height <= 1)) {
    throw new RangeError("normalized slot must be a positive rect strictly within the unit box [0,1]");
  }
  if (slot.width <= 0 || slot.height <= 0) {
    throw new RangeError("normalized slot must have positive width/height");
  }
  const placement: PlacementInput = {
    source,
    slot: { x: slot.x * canvas.width, y: slot.y * canvas.height, width: slot.width * canvas.width, height: slot.height * canvas.height },
    fit: input.fit,
  };
  if (input.focal !== undefined) placement.focal = input.focal;
  if (input.pan !== undefined) placement.pan = input.pan;
  if (input.zoom !== undefined) placement.zoom = input.zoom;
  if (input.rotation !== undefined) placement.rotation = input.rotation;
  const pixel = computePlacement(placement);
  return {
    ...pixel,
    cropNormalized: {
      x: pixel.crop.x / source.width,
      y: pixel.crop.y / source.height,
      width: pixel.crop.width / source.width,
      height: pixel.crop.height / source.height,
    },
    destinationNormalized: {
      x: pixel.destination.x / canvas.width,
      y: pixel.destination.y / canvas.height,
      width: pixel.destination.width / canvas.width,
      height: pixel.destination.height / canvas.height,
    },
  };
}

/**
 * Reframe a placement by overlaying partial changes. Returns a new input that
 * can be passed back through {@link computePlacement}. Fields not present in
 * `changes` are preserved from `input`.
 */
export function reframePlacement(input: PlacementInput, changes: Partial<PlacementInput>): PlacementInput {
  return { ...input, ...changes };
}

/**
 * Map a destination-space point back into source pixel space (ignoring rotation,
 * which is a presentation-only transform applied around the destination center).
 */
export function destinationToSource(point: Point, result: PlacementResult): Point {
  assertFinite(point.x, "point.x");
  assertFinite(point.y, "point.y");
  if (result.destination.width <= 0 || result.destination.height <= 0) {
    throw new RangeError("destination must be positive to invert");
  }
  const u = (point.x - result.destination.x) / result.destination.width;
  const v = (point.y - result.destination.y) / result.destination.height;
  return { x: result.crop.x + u * result.crop.width, y: result.crop.y + v * result.crop.height };
}

/** Validate a crop rect for the inverse helpers: finite, positive, in-bounds. */
function assertValidCrop(crop: Rect, source: Dimensions, requireAspect: number | null): void {
  assertFinite(crop.x, "crop.x");
  assertFinite(crop.y, "crop.y");
  assertFinite(crop.width, "crop.width");
  assertFinite(crop.height, "crop.height");
  if (crop.width <= 0 || crop.height <= 0) {
    throw new RangeError(`crop must have positive width/height (received ${crop.width}x${crop.height})`);
  }
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.width > source.width || crop.y + crop.height > source.height) {
    throw new RangeError(`crop must be within source bounds (received ${crop.x},${crop.y} ${crop.width}x${crop.height})`);
  }
  if (requireAspect !== null) {
    const aspect = crop.width / crop.height;
    if (Math.abs(aspect - requireAspect) > 1e-9) {
      throw new RangeError(`crop aspect ${aspect} does not match required aspect ${requireAspect}`);
    }
  }
}

/**
 * Invert a cover placement: reconstruct an input whose {@link computePlacement}
 * reproduces the given crop and slot. The focal anchor is set to the crop
 * center; zoom is derived from how much the crop is narrowed relative to the
 * natural cover crop. Rejects crops that are not finite/positive/in-bounds, that
 * do not match the slot aspect, or that would require zoom > MAX_ZOOM.
 */
export function placementFromCoverCrop(source: Dimensions, slot: Rect, crop: Rect): PlacementInput {
  assertPositiveDimensions(source, "source");
  assertFinite(slot.width, "slot.width");
  assertFinite(slot.height, "slot.height");
  if (slot.width <= 0 || slot.height <= 0) {
    throw new RangeError(`slot dimensions must be positive (received ${slot.width}x${slot.height})`);
  }
  const slotAspect = slot.width / slot.height;
  assertValidCrop(crop, source, slotAspect);
  const baseScale = Math.max(slot.width / source.width, slot.height / source.height);
  const naturalW = slot.width / baseScale;
  const zoom = naturalW / crop.width;
  if (!Number.isFinite(zoom) || zoom <= 0 || zoom > MAX_ZOOM) {
    throw new RangeError(`crop requires zoom ${zoom} outside supported range (0,${MAX_ZOOM}]`);
  }
  return {
    source,
    slot,
    fit: "cover",
    focal: { x: (crop.x + crop.width / 2) / source.width, y: (crop.y + crop.height / 2) / source.height },
    zoom,
  };
}

/**
 * Invert a contain placement: reconstruct an input whose {@link computePlacement}
 * reproduces the given crop with a centered destination. Rejects crops that are
 * not finite/positive/in-bounds, that do not match the source aspect, or that
 * would require zoom > MAX_ZOOM.
 */
export function placementFromContainCrop(source: Dimensions, slot: Rect, crop: Rect): PlacementInput {
  assertPositiveDimensions(source, "source");
  assertFinite(slot.width, "slot.width");
  assertFinite(slot.height, "slot.height");
  if (slot.width <= 0 || slot.height <= 0) {
    throw new RangeError(`slot dimensions must be positive (received ${slot.width}x${slot.height})`);
  }
  const sourceAspect = source.width / source.height;
  assertValidCrop(crop, source, sourceAspect);
  const zoom = source.width / crop.width;
  if (!Number.isFinite(zoom) || zoom <= 0 || zoom > MAX_ZOOM) {
    throw new RangeError(`crop requires zoom ${zoom} outside supported range (0,${MAX_ZOOM}]`);
  }
  return {
    source,
    slot,
    fit: "contain",
    focal: { x: (crop.x + crop.width / 2) / source.width, y: (crop.y + crop.height / 2) / source.height },
    zoom,
  };
}

/** Round a rect to a fixed number of decimals for stable comparisons. */
export function roundRect(rect: Rect, decimals = 6): Rect {
  const f = 10 ** decimals;
  const r = (n: number): number => Math.round(n * f) / f;
  return { x: r(rect.x), y: r(rect.y), width: r(rect.width), height: r(rect.height) };
}
