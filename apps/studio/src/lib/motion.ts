import {
  motionProgramSchema,
  transitionSpecSchema,
  type MotionProgramV1,
  type TransitionSpecV1,
} from "@slides-studio/protocol";

export type MotionPreset = "reveal" | "fade" | "slide" | "scale" | "draw" | "focus" | "loop" | "blur" | "wipe" | "rotate" | "pulse" | "stagger";
export type MotionTrack = MotionProgramV1["tracks"][number];

const serialize = (doc: Document): string => `<!doctype html>\n${doc.documentElement.outerHTML}`;
const slideAt = (doc: Document, index: number) => doc.querySelectorAll<HTMLElement>(".slide")[index] ?? null;
const safeJson = (value: unknown) => JSON.stringify(value).replace(/<\//g, "<\\/");

function readJsonScript<T>(slide: HTMLElement, selector: string, parse: (value: unknown) => T): T | null {
  const script = slide.querySelector<HTMLScriptElement>(selector);
  if (!script?.textContent) return null;
  try { return parse(JSON.parse(script.textContent)); } catch { return null; }
}

function upsertJsonScript(slide: HTMLElement, attribute: "data-transition-spec" | "data-motion-program", value: unknown): void {
  let script = slide.querySelector<HTMLScriptElement>(`script[${attribute}]`);
  if (!script) {
    script = slide.ownerDocument.createElement("script");
    script.type = "application/json";
    script.setAttribute(attribute, "true");
    slide.append(script);
  }
  script.textContent = safeJson(value);
}

export function readSlideTransition(html: string, slideIndex: number): TransitionSpecV1 | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slide = slideAt(doc, slideIndex);
  return slide ? readJsonScript(slide, 'script[type="application/json"][data-transition-spec]', (value) => transitionSpecSchema.parse(value)) : null;
}

export function applySlideTransition(html: string, slideIndex: number, spec: TransitionSpecV1 | null): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slide = slideAt(doc, slideIndex);
  if (!slide) return html;
  if (spec === null) slide.querySelector('script[data-transition-spec]')?.remove();
  else upsertJsonScript(slide, "data-transition-spec", transitionSpecSchema.parse(spec));
  return serialize(doc);
}

export function motionKeyframes(effect: MotionPreset): Array<Record<string, string | number>> {
  if (effect === "reveal" || effect === "fade") return [{ opacity: 0 }, { opacity: 1 }];
  if (effect === "slide") return [{ opacity: 0, translate: "0 24px" }, { opacity: 1, translate: "0 0" }];
  if (effect === "scale") return [{ opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1 }];
  if (effect === "draw") return [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }];
  if (effect === "focus") return [{ opacity: 0.45, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0px)" }];
  if (effect === "loop") return [{ opacity: 0.7, translate: "0 0" }, { opacity: 1, translate: "0 -8px" }, { opacity: 0.7, translate: "0 0" }];
  if (effect === "blur") return [{ opacity: 0, filter: "blur(18px)" }, { opacity: 1, filter: "blur(0px)" }];
  if (effect === "wipe") return [{ clipPath: "inset(0 100% 0 0)", opacity: 0.4 }, { clipPath: "inset(0 0 0 0)", opacity: 1 }];
  if (effect === "rotate") return [{ opacity: 0, rotate: "-5deg", scale: 0.96 }, { opacity: 1, rotate: "0deg", scale: 1 }];
  if (effect === "pulse") return [{ scale: 1 }, { scale: 1.06 }, { scale: 1 }];
  return [{ opacity: 0, translate: "0 18px" }, { opacity: 1, translate: "0 0" }];
}

export function createMotionTrack(objectId: string, effect: MotionPreset, options: { durationMs?: number; delayMs?: number; easing?: string } = {}): MotionTrack {
  return motionProgramSchema.shape.tracks.element.parse({
    objectId,
    keyframes: motionKeyframes(effect),
    options: {
      duration: options.durationMs ?? (effect === "pulse" || effect === "loop" ? 1200 : 500),
      delay: options.delayMs ?? 0,
      easing: options.easing ?? "ease-out",
      iterations: effect === "loop" ? 99_999 : 1,
      fill: "both",
    },
    reducedMotion: { opacity: 1 },
  });
}

export function readMotionProgram(html: string, slideIndex: number): MotionProgramV1 | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slide = slideAt(doc, slideIndex);
  return slide ? readJsonScript(slide, 'script[type="application/json"][data-motion-program]', (value) => motionProgramSchema.parse(value)) : null;
}

export function applyObjectMotion(html: string, slideIndex: number, objectId: string, track: MotionTrack, replay: MotionProgramV1["replay"]): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slide = slideAt(doc, slideIndex);
  if (!slide) return html;
  const objectExists = Array.from(slide.querySelectorAll<HTMLElement>("[data-object-id]")).some((element) => element.dataset.objectId === objectId);
  if (!objectExists) return html;
  const existing = readJsonScript(slide, 'script[type="application/json"][data-motion-program]', (value) => motionProgramSchema.parse(value));
  const program = motionProgramSchema.parse({
    schemaVersion: 1,
    replay,
    tracks: [...(existing?.tracks.filter((candidate) => candidate.objectId !== objectId) ?? []), { ...track, objectId }],
  });
  upsertJsonScript(slide, "data-motion-program", program);
  return serialize(doc);
}

export function removeObjectMotion(html: string, slideIndex: number, objectId: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slide = slideAt(doc, slideIndex);
  if (!slide) return html;
  const existing = readJsonScript(slide, 'script[type="application/json"][data-motion-program]', (value) => motionProgramSchema.parse(value));
  if (!existing) return html;
  const tracks = existing.tracks.filter((track) => track.objectId !== objectId);
  if (tracks.length === 0) slide.querySelector('script[data-motion-program]')?.remove();
  else upsertJsonScript(slide, "data-motion-program", { ...existing, tracks });
  return serialize(doc);
}
