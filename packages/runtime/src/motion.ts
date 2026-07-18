import type { MotionProgramV1 } from "@slides-studio/protocol";

export interface MotionPlayOptions {
  reducedMotion?: boolean;
  cloneRoot?: HTMLElement | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readMotionProgram(slide: HTMLElement): MotionProgramV1 | null {
  const script = slide.querySelector<HTMLScriptElement>('script[type="application/json"][data-motion-program]');
  if (!script?.textContent) return null;
  try {
    const value = JSON.parse(script.textContent) as unknown;
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tracks)) return null;
    const replay = value.replay === undefined ? "always" : String(value.replay);
    if (!["always", "once", "never"].includes(replay)) return null;
    const tracks: MotionProgramV1["tracks"] = [];
    for (const candidate of value.tracks) {
      if (!isRecord(candidate) || typeof candidate.objectId !== "string" || !Array.isArray(candidate.keyframes) || candidate.keyframes.length < 2 || !candidate.keyframes.every(isRecord) || !isRecord(candidate.options)) return null;
      const duration = Number(candidate.options.duration);
      if (!Number.isFinite(duration) || duration <= 0) return null;
      const iterations = candidate.options.iterations === undefined ? 1 : Number(candidate.options.iterations);
      if (!Number.isFinite(iterations) || iterations <= 0) return null;
      tracks.push({
        objectId: candidate.objectId,
        keyframes: candidate.keyframes as Array<Record<string, string | number>>,
        options: {
          duration,
          delay: Math.max(0, Number(candidate.options.delay ?? 0) || 0),
          easing: typeof candidate.options.easing === "string" ? candidate.options.easing : "ease-out",
          iterations,
          fill: "both",
        },
        reducedMotion: isRecord(candidate.reducedMotion) ? candidate.reducedMotion as Record<string, string | number> : { opacity: 1 },
      });
    }
    return { schemaVersion: 1, replay: replay as MotionProgramV1["replay"], tracks };
  } catch {
    return null;
  }
}

function objectById(root: HTMLElement, id: string, clone: boolean): HTMLElement | null {
  const attribute = clone ? "data-clone-source-id" : "data-object-id";
  return Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`)).find((element) => element.getAttribute(attribute) === id) ?? null;
}

function cssProperty(name: string): string {
  return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function applyFrame(element: HTMLElement, frame: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(frame)) {
    if (["offset", "easing", "composite"].includes(name)) continue;
    element.style.setProperty(cssProperty(name), String(value));
  }
}

function interpolateValue(left: string | number | undefined, right: string | number | undefined, progress: number): string | number | undefined {
  if (left === undefined) return right; if (right === undefined) return left;
  if (typeof left === "number" && typeof right === "number") return left + (right - left) * progress;
  const parse = (value: string | number) => /^(-?\d+(?:\.\d+)?)([A-Za-z%]*)$/.exec(String(value)); const a = parse(left); const b = parse(right);
  if (a && b && a[2] === b[2]) return `${Number(a[1]) + (Number(b[1]) - Number(a[1])) * progress}${a[2]}`;
  return progress < 0.5 ? left : right;
}

function frameAtProgress(keyframes: Array<Record<string, string | number>>, progress: number): Record<string, string | number> {
  const normalized = Math.max(0, Math.min(1, progress));
  const offsets = keyframes.map((frame, index) => typeof frame.offset === "number" ? frame.offset : index / Math.max(1, keyframes.length - 1));
  let rightIndex = offsets.findIndex((offset) => offset >= normalized); if (rightIndex < 0) rightIndex = keyframes.length - 1;
  const leftIndex = Math.max(0, rightIndex - 1); const leftOffset = offsets[leftIndex] ?? 0; const rightOffset = offsets[rightIndex] ?? 1;
  const local = rightOffset === leftOffset ? 1 : (normalized - leftOffset) / (rightOffset - leftOffset); const left = keyframes[leftIndex] ?? {}; const right = keyframes[rightIndex] ?? left;
  const result: Record<string, string | number> = {};
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) { if (["offset", "easing", "composite"].includes(key)) continue; const value = interpolateValue(left[key], right[key], local); if (value !== undefined) result[key] = value; }
  return result;
}

function animate(element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof element.animate !== "function") {
    const final = keyframes.at(-1);
    if (final && isRecord(final)) applyFrame(element, final as Record<string, string | number>);
    return null;
  }
  return element.animate(keyframes, { ...options, fill: "both" });
}

export class MotionController {
  #active = new WeakMap<HTMLElement, Set<Animation>>();
  #all = new Set<Animation>();
  #settledStyles = new Map<HTMLElement, string | null>();

  play(slide: HTMLElement, options: MotionPlayOptions = {}): boolean {
    const program = readMotionProgram(slide);
    if (!program) return false;
    this.reset(slide);
    const playedOnce = slide.dataset.motionPlayed === "true";
    const shouldAnimate = !options.reducedMotion && program.replay !== "never" && !(program.replay === "once" && playedOnce);
    const roots: Array<{ root: HTMLElement; clone: boolean }> = [{ root: slide, clone: false }];
    if (options.cloneRoot) roots.push({ root: options.cloneRoot, clone: true });
    const active = new Set<Animation>();
    for (const track of program.tracks) {
      for (const candidate of roots) {
        const element = objectById(candidate.root, track.objectId, candidate.clone);
        if (!element) continue;
        if (!shouldAnimate) {
          const frame = options.reducedMotion ? track.reducedMotion : track.keyframes.at(-1);
          if (frame && isRecord(frame)) applyFrame(element, frame as Record<string, string | number>);
          continue;
        }
        const animation = animate(element, track.keyframes as Keyframe[], track.options);
        if (!animation) continue;
        active.add(animation);
        this.#all.add(animation);
        void animation.finished.then(
          () => { active.delete(animation); this.#all.delete(animation); },
          () => { active.delete(animation); this.#all.delete(animation); },
        );
      }
    }
    if (shouldAnimate && program.replay === "once") slide.dataset.motionPlayed = "true";
    if (active.size) this.#active.set(slide, active);
    return shouldAnimate;
  }

  reset(slide: HTMLElement): void {
    for (const animation of this.#active.get(slide) ?? []) {
      try { animation.cancel(); } catch { /* detached animation */ }
      this.#all.delete(animation);
    }
    this.#active.delete(slide);
  }

  settle(slide: HTMLElement, posterProgress = 1): void {
    const program = readMotionProgram(slide);
    if (!program) return;
    for (const track of program.tracks) {
      const element = objectById(slide, track.objectId, false);
      if (!element) continue;
      if (!this.#settledStyles.has(element)) this.#settledStyles.set(element, element.getAttribute("style"));
      const progress = Math.max(0, Math.min(1, posterProgress));
      const frame = track.options.iterations > 1 ? frameAtProgress(track.keyframes, progress) : track.keyframes.at(-1);
      if (frame) applyFrame(element, frame);
      element.dataset.motionSettled = "true";
    }
  }

  resumeSettled(): void {
    for (const [element, style] of this.#settledStyles) {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
      delete element.dataset.motionSettled;
    }
    this.#settledStyles.clear();
  }

  cancelAll(): void {
    for (const animation of this.#all) {
      try { animation.cancel(); } catch { /* detached animation */ }
    }
    this.#all.clear();
    this.resumeSettled();
  }

  activeCount(): number { return this.#all.size; }
}
