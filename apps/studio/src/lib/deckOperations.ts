const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const serialize = (document: Document) => `<!doctype html>\n${document.documentElement.outerHTML}`;
const slides = (document: Document) => Array.from(document.querySelectorAll<HTMLElement>(".slide"));
const uniqueId = (base: string, existing: Set<string>) => { let index = 2; let value = `${base}-copy`; while (existing.has(value)) value = `${base}-copy-${index++}`; return value; };

export function duplicateSlide(html: string, index: number): string {
  const doc = parse(html); const current = slides(doc); const source = current[index]; if (!source) return html;
  const ids = new Set(current.map((slide) => slide.dataset.slideId ?? "")); const clone = source.cloneNode(true) as HTMLElement; const old = clone.dataset.slideId ?? `slide-${index + 1}`; const next = uniqueId(old, ids); clone.dataset.slideId = next;
  clone.querySelectorAll<HTMLElement>("[data-object-id]").forEach((element) => { element.dataset.objectId = `${next}-${(element.dataset.objectId ?? "object").replace(`${old}-`, "")}`; });
  source.after(clone); return serialize(doc);
}
export function deleteSlide(html: string, index: number): string { const doc = parse(html); const current = slides(doc); if (current.length <= 1) throw new Error("A deck must keep at least one slide"); current[index]?.remove(); return serialize(doc); }
export function reorderSlide(html: string, from: number, to: number): string { const doc = parse(html); const current = slides(doc); const moving = current[from]; const target = current[to]; if (!moving || !target || from === to) return html; if (to > from) target.after(moving); else target.before(moving); return serialize(doc); }
export function toggleSlideSkipped(html: string, index: number): string { const doc = parse(html); const slide = slides(doc)[index]; if (!slide) return html; slide.dataset.slideSkipped = slide.dataset.slideSkipped === "true" ? "false" : "true"; return serialize(doc); }
