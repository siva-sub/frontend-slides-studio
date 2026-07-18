export type LayerAction = "forward" | "backward" | "front" | "back";

const parseTranslate = (value: string | undefined): [number, number] => {
  const parts = (value ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return [parts[0] ?? 0, parts[1] ?? 0];
};

const serialize = (doc: Document): string => `<!doctype html>\n${doc.documentElement.outerHTML}`;

export function nudgeObject(html: string, objectId: string, dx: number, dy: number): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const object = doc.querySelector<HTMLElement>(`[data-object-id="${CSS.escape(objectId)}"]`);
  if (!object) return html;
  const [x, y] = parseTranslate(object.style.translate);
  object.dataset.tx = String(x + dx); object.dataset.ty = String(y + dy);
  object.style.setProperty("translate", `${x + dx}px ${y + dy}px`);
  return serialize(doc);
}

export function changeObjectLayer(html: string, objectId: string, action: LayerAction): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const selected = doc.querySelector<HTMLElement>(`[data-object-id="${CSS.escape(objectId)}"]`);
  if (!selected) return html;
  const scope = selected.closest(".slide") ?? selected.parentElement;
  if (!scope) return html;
  const objects = Array.from(scope.querySelectorAll<HTMLElement>("[data-object-id]")).filter((object) => !object.parentElement?.closest("[data-object-id]"));
  const ordered = objects.map((object, index) => ({ object, index, z: Number.parseInt(object.style.zIndex || "", 10) || index + 1 })).toSorted((left, right) => left.z - right.z || left.index - right.index).map((entry) => entry.object);
  const current = ordered.indexOf(selected); if (current < 0) return html;
  const target = action === "front" ? ordered.length - 1 : action === "back" ? 0 : action === "forward" ? Math.min(ordered.length - 1, current + 1) : Math.max(0, current - 1);
  ordered.splice(current, 1); ordered.splice(target, 0, selected); ordered.forEach((object, index) => { object.style.zIndex = String(index + 1); });
  return serialize(doc);
}
