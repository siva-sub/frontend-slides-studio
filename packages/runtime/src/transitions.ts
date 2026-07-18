import type { TransitionSpecV1 } from "@slides-studio/protocol";

export interface TransitionFrames {
  outgoing: Keyframe[];
  incoming: Keyframe[];
}

export interface TransitionSessionOptions {
  outgoing: HTMLElement;
  incoming: HTMLElement;
  container: HTMLElement;
  spec: TransitionSpecV1;
  reducedMotion: boolean;
  prefix: string;
  onTargetEntrance(clone: HTMLElement): void;
  onCommit(): void;
}

export interface TransitionSession {
  readonly targetClone: HTMLElement | null;
  readonly animations: Animation[];
  readonly timers: Set<number>;
  readonly finished: Promise<void>;
  readonly committed: boolean;
  cancel(commit?: boolean): void;
}

function directionSign(direction: TransitionSpecV1["direction"]): { x: number; y: number } {
  if (direction === "rtl") return { x: -1, y: 0 };
  if (direction === "ttb") return { x: 0, y: 1 };
  if (direction === "btt") return { x: 0, y: -1 };
  return { x: 1, y: 0 };
}

export function transitionFrames(spec: TransitionSpecV1): TransitionFrames {
  const direction = directionSign(spec.direction);
  const travel = `${direction.x * 10}% ${direction.y * 10}%`;
  const reverseTravel = `${direction.x * -10}% ${direction.y * -10}%`;
  if (spec.kind === "none") return { outgoing: [{ opacity: 1 }, { opacity: 1 }], incoming: [{ opacity: 1 }, { opacity: 1 }] };
  if (spec.kind === "crossfade") return { outgoing: [{ opacity: 1 }, { opacity: 0 }], incoming: [{ opacity: 0 }, { opacity: 1 }] };
  if (spec.kind === "slide") return { outgoing: [{ opacity: 1, translate: "0 0" }, { opacity: 0.18, translate: reverseTravel }], incoming: [{ opacity: 0.2, translate: travel }, { opacity: 1, translate: "0 0" }] };
  if (spec.kind === "zoom") {
    const outward = spec.direction === "out";
    return { outgoing: [{ opacity: 1, scale: 1 }, { opacity: 0, scale: outward ? 1.08 : 0.94 }], incoming: [{ opacity: 0, scale: outward ? 0.94 : 1.08 }, { opacity: 1, scale: 1 }] };
  }
  if (spec.kind === "circle-reveal") {
    const origin = spec.direction === "rtl" ? "0% 50%" : spec.direction === "ttb" ? "50% 0%" : spec.direction === "btt" ? "50% 100%" : "50% 50%";
    return { outgoing: [{ opacity: 1 }, { opacity: 0.5 }], incoming: [{ clipPath: `circle(0% at ${origin})`, opacity: 0.8 }, { clipPath: `circle(150% at ${origin})`, opacity: 1 }] };
  }
  if (spec.kind === "clip-wipe") {
    const start = spec.direction === "rtl" ? "inset(0 0 0 100%)" : spec.direction === "ttb" ? "inset(0 0 100% 0)" : spec.direction === "btt" ? "inset(100% 0 0 0)" : "inset(0 100% 0 0)";
    return { outgoing: [{ opacity: 1 }, { opacity: 0.65 }], incoming: [{ clipPath: start }, { clipPath: "inset(0 0 0 0)" }] };
  }
  if (spec.kind === "pixel-grid") return { outgoing: [{ opacity: 1, filter: "contrast(1)" }, { opacity: 0, filter: "contrast(1.4)" }], incoming: [{ opacity: 0, scale: 1.025, filter: "blur(6px)" }, { opacity: 1, scale: 1, filter: "blur(0px)" }] };
  if (spec.kind === "pixel-bars") return { outgoing: [{ opacity: 1, clipPath: "inset(0 0 0 0)" }, { opacity: 0.35, clipPath: "inset(0 0 0 18%)" }], incoming: [{ opacity: 0.2, clipPath: "inset(0 82% 0 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }] };
  if (spec.kind === "slice-vertical") return { outgoing: [{ opacity: 1, translate: "0 0" }, { opacity: 0.28, translate: "0 -3%" }], incoming: [{ opacity: 0, clipPath: "inset(0 50% 0 50%)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }] };
  return { outgoing: [{ opacity: 1, translate: "0 0" }, { opacity: 0.28, translate: "-3% 0" }], incoming: [{ opacity: 0, clipPath: "inset(50% 0 50% 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }] };
}

export function effectiveTransitionSpec(spec: TransitionSpecV1, reducedMotion: boolean): TransitionSpecV1 {
  if (!reducedMotion) return spec;
  if (spec.reducedMotion === "skip" || spec.reducedMotion === "none") return { ...spec, kind: "none", durationMs: 0 };
  return { ...spec, kind: "crossfade", durationMs: Math.min(spec.durationMs, 180) };
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function rewriteReference(value: string, ids: Map<string, string>): string {
  let rewritten = value.replace(/url\(#([^)]+)\)/g, (match, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
  if (rewritten.startsWith("#") && ids.has(rewritten.slice(1))) rewritten = `#${ids.get(rewritten.slice(1))}`;
  return rewritten;
}

export function sanitizeTransitionClone(source: HTMLElement, prefix: string): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script,iframe,object,embed").forEach((element) => element.remove());
  const elements = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
  const ids = new Map<string, string>();
  for (const element of elements) {
    if (!element.id) continue;
    const next = `${prefix}-${element.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    ids.set(element.id, next);
    element.id = next;
  }
  clone.querySelectorAll("style").forEach((style) => {
    let content = style.textContent ?? "";
    for (const [id, next] of ids) {
      content = content.replaceAll(`url(#${id})`, `url(#${next})`).replace(new RegExp(`#${escapeRegex(id)}(?=[\\s.{,:>+~\\[])`, "g"), `#${next}`);
    }
    style.textContent = content;
  });
  for (const element of elements) {
    if (element.dataset.objectId) {
      element.dataset.cloneSourceId = element.dataset.objectId;
      delete element.dataset.objectId;
    }
    if (element.dataset.slideId) { element.dataset.cloneSlideId = element.dataset.slideId; delete element.dataset.slideId; }
    element.removeAttribute("contenteditable");
    element.removeAttribute("autofocus");
    element.removeAttribute("autoplay");
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) { element.removeAttribute(attribute.name); continue; }
      if ((name === "href" || name === "xlink:href" || name === "src") && /^(?:javascript|vbscript):/i.test(attribute.value.trim())) { element.removeAttribute(attribute.name); continue; }
      if (name === "for" && ids.has(attribute.value)) {
        element.setAttribute(attribute.name, ids.get(attribute.value)!);
      } else if (["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"].includes(name)) {
        element.setAttribute(attribute.name, attribute.value.split(/\s+/).map((id) => ids.get(id) ?? id).join(" "));
      } else if (name !== "id") {
        element.setAttribute(attribute.name, rewriteReference(attribute.value, ids));
      }
    }
    if (element.matches("a,button,input,select,textarea,[tabindex]")) element.setAttribute("tabindex", "-1");
    if (element.matches("button,input,select,textarea")) element.setAttribute("disabled", "");
  }
  clone.dataset.transitionClone = "true";
  clone.setAttribute("aria-hidden", "true");
  clone.classList.add("active", "visible");
  Object.assign(clone.style, { position: "absolute", inset: "0", width: "100%", height: "100%", margin: "0", visibility: "visible", pointerEvents: "none", zIndex: "2147480000" });
  return clone;
}

function animate(element: HTMLElement, frames: Keyframe[], spec: TransitionSpecV1): Animation | null {
  if (typeof element.animate !== "function") return null;
  try { return element.animate(frames, { duration: spec.durationMs, easing: spec.easing, fill: "both" }); }
  catch { return element.animate([{ opacity: 1 }, { opacity: 1 }], { duration: spec.durationMs, easing: "linear", fill: "both" }); }
}

export function createTransitionSession(options: TransitionSessionOptions): TransitionSession {
  const spec = effectiveTransitionSpec(options.spec, options.reducedMotion);
  const timers = new Set<number>();
  const animations: Animation[] = [];
  let committed = false;
  let entranceStarted = false;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  let outgoingClone: HTMLElement | null = null;
  let incomingClone: HTMLElement | null = null;

  const startEntrance = () => {
    if (entranceStarted || !incomingClone) return;
    entranceStarted = true;
    options.onTargetEntrance(incomingClone);
  };
  const cleanup = () => {
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    for (const animation of animations) { try { animation.cancel(); } catch { /* detached animation */ } }
    outgoingClone?.remove();
    incomingClone?.remove();
    outgoingClone = null;
    incomingClone = null;
  };
  const commit = () => {
    if (committed) return;
    committed = true;
    startEntrance();
    cleanup();
    options.onCommit();
    resolveFinished();
  };

  if (spec.kind === "none" || spec.durationMs === 0) {
    incomingClone = sanitizeTransitionClone(options.incoming, `${options.prefix}-in`);
    startEntrance();
    incomingClone.remove();
    incomingClone = null;
    committed = true;
    options.onCommit();
    resolveFinished();
  } else {
    outgoingClone = sanitizeTransitionClone(options.outgoing, `${options.prefix}-out`);
    incomingClone = sanitizeTransitionClone(options.incoming, `${options.prefix}-in`);
    incomingClone.style.zIndex = "2147480001";
    options.container.append(outgoingClone, incomingClone);
    const frames = transitionFrames(spec);
    const outgoingAnimation = animate(outgoingClone, frames.outgoing, spec);
    const incomingAnimation = animate(incomingClone, frames.incoming, spec);
    if (outgoingAnimation) animations.push(outgoingAnimation);
    if (incomingAnimation) animations.push(incomingAnimation);
    const entranceDelay = Math.max(0, Math.round(spec.durationMs * (spec.targetEntranceStartFraction ?? 0.55)));
    if (entranceDelay === 0) startEntrance();
    else {
      const timer = window.setTimeout(() => { timers.delete(timer); startEntrance(); }, entranceDelay);
      timers.add(timer);
    }
    const commitTimer = window.setTimeout(() => { timers.delete(commitTimer); commit(); }, spec.durationMs);
    timers.add(commitTimer);
  }

  return {
    get targetClone() { return incomingClone; },
    animations,
    timers,
    finished,
    get committed() { return committed; },
    cancel(shouldCommit = true) {
      if (committed) return;
      if (shouldCommit) commit();
      else { committed = true; cleanup(); resolveFinished(); }
    },
  };
}

function mediaUrls(slide: HTMLElement): Array<{ url: string; as: "image" | "video" | "audio" }> {
  const values: Array<{ url: string; as: "image" | "video" | "audio" }> = [];
  slide.querySelectorAll<HTMLImageElement>("img").forEach((image) => { const url = image.currentSrc || image.src; if (url) values.push({ url, as: "image" }); });
  slide.querySelectorAll<HTMLVideoElement>("video").forEach((video) => { if (video.poster) values.push({ url: video.poster, as: "image" }); if (video.currentSrc || video.src) values.push({ url: video.currentSrc || video.src, as: "video" }); });
  slide.querySelectorAll<HTMLAudioElement>("audio").forEach((audio) => { if (audio.currentSrc || audio.src) values.push({ url: audio.currentSrc || audio.src, as: "audio" }); });
  slide.querySelectorAll<HTMLSourceElement>("source[src]").forEach((source) => { const parent = source.parentElement; values.push({ url: source.src, as: parent?.tagName === "AUDIO" ? "audio" : "video" }); });
  return values;
}

export function preloadAdjacentSlides(slides: HTMLElement[], index: number, seen = new Set<string>()): Set<string> {
  for (const adjacent of [slides[index - 1], slides[index + 1]]) {
    if (!adjacent) continue;
    for (const item of mediaUrls(adjacent)) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = item.as;
      link.href = item.url;
      link.dataset.transitionPreload = "true";
      document.head.append(link);
    }
  }
  return seen;
}
