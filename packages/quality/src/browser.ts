import type { QualityIssue, QualityReport } from "@slides-studio/protocol";

export interface RenderedAuditOptions {
  id: string;
  deckId?: string;
  canvas?: { width: number; height: number };
  mode?: "canonical" | "imported";
  strict?: boolean;
  requireSettled?: boolean;
  slideIndex?: number;
}

/** Self-contained by design: Playwright serializes this function into page.evaluate. */
export function collectRenderedAudit(options: RenderedAuditOptions): QualityReport {
  type Rect = { x: number; y: number; width: number; height: number; right: number; bottom: number };
  const mode = options.mode ?? "canonical";
  const strict = options.strict ?? false;
  const issues: QualityIssue[] = [];
  const round = (value: number) => Math.round(value * 100) / 100;
  const boundsTuple = (rect: Rect): [number, number, number, number] => [round(rect.x), round(rect.y), round(rect.width), round(rect.height)];
  const issue = (value: Omit<QualityIssue, "evidence"> & { evidence?: string[] }) => issues.push({ ...value, evidence: value.evidence ?? [] });
  const severity = (hardCategory = false): Pick<QualityIssue, "severity" | "hard"> => {
    if (hardCategory) return { severity: mode === "imported" && !strict ? "warning" : "error", hard: mode === "canonical" || strict };
    return strict && mode === "canonical" ? { severity: "error", hard: true } : { severity: "warning", hard: false };
  };
  const ignored = (element: Element, category: string) => (element.getAttribute("data-quality-ignore") ?? "").split(",").map((item) => item.trim()).includes(category) || element.hasAttribute("data-quality-ignore-all");
  const visible = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return !element.hidden && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  };
  const rectOf = (element: Element): Rect => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  const inside = (inner: Rect, outer: Rect, tolerance = 1) => inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
  const intersects = (left: Rect, right: Rect) => left.x < right.right && left.right > right.x && left.y < right.bottom && left.bottom > right.y;
  const intersectionArea = (left: Rect, right: Rect) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.x, right.x)) * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y));
  const idFor = (element: Element) => (element as HTMLElement).dataset.objectId ?? (element.id || undefined);

  const allSlides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
  const slides = options.slideIndex === undefined ? allSlides : (allSlides[options.slideIndex] ? [allSlides[options.slideIndex]!] : []);
  const primaryStage = document.querySelector<HTMLElement>(".deck-stage") ?? slides[0]?.parentElement ?? null;
  const canvas = options.canvas ?? { width: primaryStage?.offsetWidth || slides[0]?.offsetWidth || 1920, height: primaryStage?.offsetHeight || slides[0]?.offsetHeight || 1080 };
  if (!primaryStage || slides.length === 0 || canvas.width <= 0 || canvas.height <= 0) {
    issue({ category: "stage-bounds", severity: "critical", hard: true, reason: "A measurable .deck-stage and at least one .slide are required." });
  }

  const duplicateValues = (elements: Element[], value: (element: Element) => string | undefined, category: "duplicate-id") => {
    const seen = new Map<string, number>();
    for (const element of elements) {
      const id = value(element);
      if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const [id, count] of seen) if (count > 1) issue({ category, severity: "error", hard: true, objectId: id, reason: `Identifier ${id} appears ${count} times.` });
  };
  duplicateValues(Array.from(document.querySelectorAll("[id]")), (element) => element.id, "duplicate-id");
  duplicateValues(Array.from(document.querySelectorAll("[data-object-id]")), (element) => (element as HTMLElement).dataset.objectId, "duplicate-id");

  for (const clone of Array.from(document.querySelectorAll<HTMLElement>("[data-transition-clone]"))) {
    const unsafe = clone.querySelector("script,[data-object-id],[autofocus],[contenteditable=true],[tabindex]:not([tabindex='-1'])") ?? (clone.matches("[data-object-id],[autofocus],[contenteditable=true],[tabindex]:not([tabindex='-1'])") ? clone : null);
    if (unsafe) issue({ category: "unsafe-clone-content", severity: "critical", hard: true, ...(idFor(unsafe) ? { objectId: idFor(unsafe) } : {}), reason: "Transition clone contains executable, focusable, or duplicate authored content." });
  }

  for (const [slideIndex, slide] of slides.entries()) {
    const sourceSlideIndex = options.slideIndex ?? slideIndex;
    const slideId = slide.dataset.slideId ?? `slide-${sourceSlideIndex + 1}`;
    const stage = slide.closest<HTMLElement>(".deck-stage") ?? primaryStage;
    if (!stage) continue;
    const stageRect = rectOf(stage);
    const slideRect = rectOf(slide);
    if (!ignored(slide, "stage-bounds") && (slide.offsetWidth <= 0 || slide.offsetHeight <= 0 || Math.abs(slide.offsetWidth - canvas.width) > 2 || Math.abs(slide.offsetHeight - canvas.height) > 2)) {
      issue({ slideId, category: "stage-bounds", ...severity(true), reason: `Slide intrinsic size ${slide.offsetWidth}×${slide.offsetHeight} does not match canvas ${canvas.width}×${canvas.height}.`, bounds: [0, 0, slide.offsetWidth, slide.offsetHeight] });
    }
    if (!ignored(slide, "stage-bounds") && stageRect.width > 0 && slideRect.width > 0 && !inside(slideRect, stageRect, 2)) {
      issue({ slideId, category: "stage-bounds", ...severity(true), reason: "Rendered slide extends outside its stage.", bounds: boundsTuple(slideRect) });
    }
    if (!ignored(slide, "scroll-overflow") && (slide.scrollWidth > slide.clientWidth + 1 || slide.scrollHeight > slide.clientHeight + 1)) {
      issue({ slideId, category: "scroll-overflow", ...severity(), reason: `Slide scroll extent ${slide.scrollWidth}×${slide.scrollHeight} exceeds ${slide.clientWidth}×${slide.clientHeight}.`, bounds: [0, 0, slide.scrollWidth, slide.scrollHeight] });
    }

    const authored = Array.from(slide.querySelectorAll<HTMLElement>("[data-object-id]")).filter((element) => {
      if (!visible(element) || element.getBoundingClientRect().width <= 0 || element.getBoundingClientRect().height <= 0) return false;
      if (element.dataset.objectRole === "background" || element.dataset.objectRole === "decorative") return false;
      const ancestor = element.parentElement?.closest<HTMLElement>("[data-object-id]");
      return !ancestor || !slide.contains(ancestor);
    });
    const authoredRects = new Map(authored.map((element) => [element, rectOf(element)]));

    for (const element of authored) {
      const rect = authoredRects.get(element)!;
      const objectId = element.dataset.objectId;
      if (!ignored(element, "clipped-content") && !inside(rect, slideRect, 1)) issue({ slideId, objectId, category: "clipped-content", ...severity(), reason: "Authored object extends outside slide bounds.", bounds: boundsTuple(rect) });
      if (!ignored(element, "text-overflow") && !element.matches("img,video,audio,canvas,svg") && (element.textContent ?? "").trim() && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)) {
        issue({ slideId, objectId, category: "text-overflow", ...severity(), reason: `Text scroll extent ${element.scrollWidth}×${element.scrollHeight} exceeds ${element.clientWidth}×${element.clientHeight}.`, bounds: boundsTuple(rect) });
      }
    }

    for (const media of Array.from(slide.querySelectorAll<HTMLElement>("img,video,canvas,svg")).filter(visible)) {
      const rect = rectOf(media);
      if (!ignored(media, "media-bounds") && !inside(rect, slideRect, 1)) issue({ slideId, objectId: idFor(media), category: "media-bounds", ...severity(), reason: "Rendered media extends outside slide bounds.", bounds: boundsTuple(rect) });
      if (media instanceof HTMLImageElement && !ignored(media, "missing-asset") && (!media.complete || media.naturalWidth === 0)) issue({ slideId, objectId: idFor(media), category: "missing-asset", ...severity(true), reason: `Image failed to load: ${media.currentSrc || media.src || "unknown source"}.`, bounds: boundsTuple(rect) });
      if (media instanceof HTMLVideoElement && !ignored(media, "missing-asset") && media.error) issue({ slideId, objectId: idFor(media), category: "missing-asset", ...severity(true), reason: `Video failed to load: ${media.currentSrc || media.src || "unknown source"}.`, bounds: boundsTuple(rect) });
    }

    for (let leftIndex = 0; leftIndex < authored.length; leftIndex += 1) {
      const left = authored[leftIndex]!;
      if (ignored(left, "object-overlap") || left.hasAttribute("data-overlap-allow")) continue;
      for (const right of authored.slice(leftIndex + 1)) {
        if (ignored(right, "object-overlap") || right.hasAttribute("data-overlap-allow")) continue;
        const leftId = left.dataset.objectId!; const rightId = right.dataset.objectId!;
        const sameGroup = Boolean(left.dataset.overlapGroup && left.dataset.overlapGroup === right.dataset.overlapGroup);
        const sameSource = Boolean(left.dataset.sourceId && left.dataset.sourceId === right.dataset.sourceId);
        const declared = (left.dataset.intentionalOverlap ?? "").split(",").includes(rightId) || (right.dataset.intentionalOverlap ?? "").split(",").includes(leftId);
        if (sameGroup || sameSource || declared) continue;
        const leftRect = authoredRects.get(left)!; const rightRect = authoredRects.get(right)!;
        if (!intersects(leftRect, rightRect)) continue;
        const ratio = intersectionArea(leftRect, rightRect) / Math.max(1, Math.min(leftRect.width * leftRect.height, rightRect.width * rightRect.height));
        if (ratio < 0.05) continue;
        issue({ slideId, category: "object-overlap", ...severity(), pair: [leftId, rightId], reason: `Authored objects overlap by ${Math.round(ratio * 100)}% of the smaller object.` });
      }
    }

    const connectors = Array.from(slide.querySelectorAll<SVGGraphicsElement>("[data-connector='true'],svg path[data-connector],svg line[data-connector],svg polyline[data-connector]"));
    for (const connector of connectors) {
      if (ignored(connector, "connector-collision")) continue;
      const owner = connector.closest<HTMLElement>("[data-object-id]");
      const connectorId = owner?.dataset.objectId ?? connector.getAttribute("data-object-id") ?? undefined;
      const sourceId = connector.getAttribute("data-connector-source") ?? owner?.getAttribute("data-connector-source");
      const targetId = connector.getAttribute("data-connector-target") ?? owner?.getAttribute("data-connector-target");
      const hit = (point: { x: number; y: number }) => authored.find((object) => {
        const objectId = object.dataset.objectId;
        if (!objectId || objectId === connectorId || objectId === sourceId || objectId === targetId) return false;
        const rect = authoredRects.get(object)!;
        return point.x > rect.x + 2 && point.x < rect.right - 2 && point.y > rect.y + 2 && point.y < rect.bottom - 2;
      });
      let collision: HTMLElement | undefined;
      if (typeof SVGGeometryElement !== "undefined" && connector instanceof SVGGeometryElement && typeof connector.getTotalLength === "function" && typeof connector.getPointAtLength === "function" && typeof DOMPoint !== "undefined") {
        const length = connector.getTotalLength();
        const matrix = connector.getScreenCTM();
        if (matrix) for (let distance = 0; distance <= length; distance += Math.max(4, length / 80)) {
          const local = connector.getPointAtLength(distance);
          const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
          collision = hit(screen);
          if (collision) break;
        }
      } else {
        const rect = rectOf(connector);
        collision = authored.find((object) => {
          const objectId = object.dataset.objectId;
          return objectId !== sourceId && objectId !== targetId && objectId !== connectorId && intersects(rect, authoredRects.get(object)!);
        });
      }
      if (collision) issue({ slideId, objectId: connectorId, category: "connector-collision", ...severity(), pair: connectorId ? [connectorId, collision.dataset.objectId!] : undefined, reason: `Connector crosses authored object ${collision.dataset.objectId}.` });
    }
  }

  if (options.requireSettled) {
    const clones = document.querySelectorAll("[data-transition-clone]").length;
    const running = (document.getAnimations?.() ?? []).filter((animation) => animation.playState === "running").length;
    const settled = document.documentElement.dataset.exportState === "settled" && clones === 0 && running === 0;
    if (!settled) issue({ category: "export-settlement", severity: "critical", hard: true, settled: false, reason: `Export is not settled (state=${document.documentElement.dataset.exportState ?? "missing"}, clones=${clones}, runningAnimations=${running}).` });
  }

  const summary = { total: issues.length, info: 0, warning: 0, error: 0, critical: 0, hard: 0 };
  for (const item of issues) { summary[item.severity] += 1; if (item.hard) summary.hard += 1; }
  const blocking = issues.some((item) => item.hard || item.severity === "error" || item.severity === "critical" || (item.category === "export-settlement" && item.settled !== true));
  return {
    schemaVersion: 1,
    id: options.id,
    ...(options.deckId ? { deckId: options.deckId } : {}),
    canvas,
    mode,
    strict,
    issues,
    passed: !blocking,
    summary,
  };
}
