export interface MeasuredObject { id: string; element: HTMLElement; parent: HTMLElement; rect: DOMRect; parentRect: DOMRect; inFlow: boolean; }
export interface SnapGuide { axis: "x" | "y"; value: number; kind: "grid" | "edge" | "center" | "sibling"; }
export interface SnapResult { x: number; y: number; guides: SnapGuide[]; }
export interface GeometryRect { x: number; y: number; width: number; height: number; }

export function measureForFreeform(root: HTMLElement): MeasuredObject[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-object-id]")).map((element) => {
    const parent = (element.offsetParent as HTMLElement | null) ?? root;
    const style = getComputedStyle(element);
    return { id: element.dataset.objectId!, element, parent, rect: element.getBoundingClientRect(), parentRect: parent.getBoundingClientRect(), inFlow: !["absolute", "fixed"].includes(style.position) };
  });
}

export function detachMeasuredObjects(measured: MeasuredObject[]): void {
  for (const object of measured) {
    if (!object.inFlow) continue;
    const placeholder = document.createElement("span");
    placeholder.dataset.studioPlaceholder = object.id;
    placeholder.style.display = getComputedStyle(object.element).display === "inline" ? "inline-block" : "block";
    placeholder.style.width = `${object.rect.width}px`; placeholder.style.height = `${object.rect.height}px`; placeholder.style.visibility = "hidden";
    object.element.before(placeholder);
  }
  for (const object of measured) {
    Object.assign(object.element.style, { position: "absolute", left: `${object.rect.left - object.parentRect.left + object.parent.scrollLeft}px`, top: `${object.rect.top - object.parentRect.top + object.parent.scrollTop}px`, width: `${object.rect.width}px`, height: `${object.rect.height}px`, margin: "0" });
  }
}

export function snapRect(rect: GeometryRect, siblings: GeometryRect[], grid = 8, threshold = 6, bypass = false): SnapResult {
  if (bypass) return { x: rect.x, y: rect.y, guides: [] };
  type Candidate = { delta: number; guide: SnapGuide };
  const axisCandidates = (axis: "x" | "y"): Candidate[] => {
    const start = axis === "x" ? rect.x : rect.y;
    const size = axis === "x" ? rect.width : rect.height;
    const candidates: Candidate[] = [{ delta: Math.round(start / grid) * grid - start, guide: { axis, value: Math.round(start / grid) * grid, kind: "grid" } }];
    const movingAnchors = [start, start + size / 2, start + size];
    for (const sibling of siblings) {
      const siblingStart = axis === "x" ? sibling.x : sibling.y;
      const siblingSize = axis === "x" ? sibling.width : sibling.height;
      const siblingAnchors = [siblingStart, siblingStart + siblingSize / 2, siblingStart + siblingSize];
      for (let movingIndex = 0; movingIndex < movingAnchors.length; movingIndex++) {
        for (let siblingIndex = 0; siblingIndex < siblingAnchors.length; siblingIndex++) {
          const kind: SnapGuide["kind"] = movingIndex === 1 && siblingIndex === 1 ? "center" : movingIndex === siblingIndex ? "sibling" : "edge";
          candidates.push({ delta: siblingAnchors[siblingIndex]! - movingAnchors[movingIndex]!, guide: { axis, value: siblingAnchors[siblingIndex]!, kind } });
        }
      }
    }
    const priority: Record<SnapGuide["kind"], number> = { center: 0, sibling: 1, edge: 2, grid: 3 };
    return candidates.filter((candidate) => Math.abs(candidate.delta) <= threshold).toSorted((left, right) => Math.abs(left.delta) - Math.abs(right.delta) || priority[left.guide.kind] - priority[right.guide.kind]);
  };
  const xCandidate = axisCandidates("x")[0]; const yCandidate = axisCandidates("y")[0];
  return { x: rect.x + (xCandidate?.delta ?? 0), y: rect.y + (yCandidate?.delta ?? 0), guides: [xCandidate?.guide, yCandidate?.guide].filter((guide): guide is SnapGuide => Boolean(guide)) };
}

export function snapPoint(x: number, y: number, siblings: GeometryRect[], grid = 8, threshold = 6, bypass = false): SnapResult {
  return snapRect({ x, y, width: 0, height: 0 }, siblings, grid, threshold, bypass);
}
