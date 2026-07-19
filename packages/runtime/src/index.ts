import type { TransitionSpecV1 } from "@slides-studio/protocol";
import { MotionController } from "./motion.js";
import { createTransitionSession, preloadAdjacentSlides, type TransitionSession } from "./transitions.js";

export { MotionController, readMotionProgram } from "./motion.js";
export { createTransitionSession, effectiveTransitionSpec, preloadAdjacentSlides, sanitizeTransitionClone, transitionFrames } from "./transitions.js";
export { BroadcastChannelPresentationTransport, PresentationSessionController, presentationChannelName } from "./presenter.js";
export type { PresentationPeer, PresentationSessionControllerOptions, PresentationSessionIdentity, PresentationTransport } from "./presenter.js";
export type RuntimeMode = "present" | "author" | "export";

export interface SlidesRuntimeOptions {
  slideSelector?: string;
  initialIndex?: number;
  keyboard?: boolean;
  mode?: RuntimeMode;
  defaultTransition?: TransitionSpecV1;
}

export interface ExportFreezeOptions { posterProgress?: number; mediaPosterTime?: number; }

interface RuntimeApi {
  next(): void;
  previous(): void;
  goTo(index: number): void;
  settleTransitions(): void;
  freezeForExport(options?: ExportFreezeOptions): Promise<void>;
  resumeFromExport(): void;
  destroy(): void;
  readonly currentIndex: number;
  readonly slideCount: number;
  readonly transitioning: boolean;
}

const ACTIVE_CLASSES = ["active", "visible"] as const;
const TRANSITION_KINDS = new Set(["none", "crossfade", "slide", "zoom", "circle-reveal", "clip-wipe", "pixel-grid", "pixel-bars", "slice-vertical", "slice-horizontal"]);
const DEFAULT_NONE: TransitionSpecV1 = { schemaVersion: 1, kind: "none", durationMs: 0, easing: "ease-out", reducedMotion: "fade" };

function parseTransition(value: unknown): TransitionSpecV1 | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!TRANSITION_KINDS.has(String(input.kind))) return null;
  const duration = input.durationMs === undefined ? 400 : Number(input.durationMs);
  if (!Number.isFinite(duration) || duration < 0 || duration > 4000) return null;
  return {
    schemaVersion: 1,
    kind: input.kind as TransitionSpecV1["kind"],
    durationMs: duration,
    easing: typeof input.easing === "string" ? input.easing as TransitionSpecV1["easing"] : "ease-out",
    ...(typeof input.direction === "string" ? { direction: input.direction as TransitionSpecV1["direction"] } : {}),
    ...(typeof input.targetEntranceStartFraction === "number" ? { targetEntranceStartFraction: Math.max(0, Math.min(1, input.targetEntranceStartFraction)) } : {}),
    reducedMotion: ["skip", "fade", "crossfade", "none"].includes(String(input.reducedMotion)) ? input.reducedMotion as TransitionSpecV1["reducedMotion"] : "fade",
    ...(input.params && typeof input.params === "object" ? { params: input.params as TransitionSpecV1["params"] } : {}),
  };
}

function readDeckTransitions(): { defaultTransition?: TransitionSpecV1; bySlide: Map<string, TransitionSpecV1> } {
  const bySlide = new Map<string, TransitionSpecV1>();
  const script = document.querySelector<HTMLScriptElement>('script[type="application/json"][data-deck-goal]');
  if (!script?.textContent) return { bySlide };
  try {
    const deck = JSON.parse(script.textContent) as { defaultTransition?: unknown; slides?: Array<{ id?: unknown; transition?: unknown }> };
    for (const slide of deck.slides ?? []) {
      if (typeof slide.id !== "string") continue;
      const transition = parseTransition(slide.transition);
      if (transition) bySlide.set(slide.id, transition);
    }
    const defaultTransition = parseTransition(deck.defaultTransition);
    return { ...(defaultTransition ? { defaultTransition } : {}), bySlide };
  } catch {
    return { bySlide };
  }
}

function transitionFromSlide(slide: HTMLElement): TransitionSpecV1 | null {
  const script = slide.querySelector<HTMLScriptElement>('script[type="application/json"][data-transition-spec]');
  if (!script?.textContent) return null;
  try { return parseTransition(JSON.parse(script.textContent)); } catch { return null; }
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  });
}

async function settleMedia(media: HTMLMediaElement, declared: number): Promise<void> {
  media.pause();
  if (!Number.isFinite(declared) || media.readyState < 1) return;
  const target = Math.min(Math.max(0, declared), media.duration || declared);
  if (Math.abs(media.currentTime - target) < 0.001) return;
  await new Promise<void>((resolve) => {
    const done = () => { window.clearTimeout(timer); resolve(); };
    const timer = window.setTimeout(done, 1000);
    media.addEventListener("seeked", done, { once: true });
    try { media.currentTime = target; } catch { done(); }
  });
}

export class SlidesRuntime implements RuntimeApi {
  readonly slides: HTMLElement[];
  readonly options: Required<Omit<SlidesRuntimeOptions, "defaultTransition">> & { defaultTransition?: TransitionSpecV1 };
  #currentIndex = 0;
  #transition: TransitionSession | null = null;
  #motion = new MotionController();
  #preloaded = new Set<string>();
  #deckTransitions = readDeckTransitions();
  #hiddenState = new Map<HTMLElement, boolean>();
  #animationState: Array<{ animation: Animation; running: boolean }> = [];
  #onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable='true']")) return;
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); this.next(); }
    if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); this.previous(); }
    if (event.key === "Home") { event.preventDefault(); this.goTo(0); }
    if (event.key === "End") { event.preventDefault(); this.goTo(this.slideCount - 1); }
  };

  constructor(options: SlidesRuntimeOptions = {}) {
    this.options = {
      slideSelector: options.slideSelector ?? ".slide",
      initialIndex: options.initialIndex ?? 0,
      keyboard: options.keyboard ?? true,
      mode: options.mode ?? "present",
      ...(options.defaultTransition ? { defaultTransition: options.defaultTransition } : {}),
    };
    const discovered = Array.from(document.querySelectorAll<HTMLElement>(this.options.slideSelector));
    this.slides = this.options.mode === "present" ? discovered.filter((slide) => slide.dataset.slideSkipped !== "true") : discovered;
    discovered.filter((slide) => !this.slides.includes(slide)).forEach((slide) => { slide.classList.remove("active", "visible"); slide.setAttribute("aria-hidden", "true"); });
    if (this.slides.length === 0) throw new Error(`No unskipped slides found for ${this.options.slideSelector}`);
    this.slides.forEach((slide, index) => {
      slide.dataset.slideId ||= `slide-${String(index + 1).padStart(2, "0")}`;
      slide.setAttribute("aria-roledescription", "slide");
    });
    this.#currentIndex = Math.max(0, Math.min(this.options.initialIndex, this.slideCount - 1));
    this.#render();
    this.#preloaded = preloadAdjacentSlides(this.slides, this.#currentIndex, this.#preloaded);
    if (this.options.keyboard) window.addEventListener("keydown", this.#onKeyDown);
    document.documentElement.dataset.slidesStudioRuntime = "ready";
    document.documentElement.dataset.transitionState = "idle";
  }

  get currentIndex(): number { return this.#currentIndex; }
  get slideCount(): number { return this.slides.length; }
  get transitioning(): boolean { return Boolean(this.#transition && !this.#transition.committed); }
  next(): void { this.goTo(this.#currentIndex + 1); }
  previous(): void { this.goTo(this.#currentIndex - 1); }

  goTo(index: number): void {
    if (this.#transition && !this.#transition.committed) this.#transition.cancel(true);
    this.#transition = null;
    const next = Math.max(0, Math.min(index, this.slideCount - 1));
    if (next === this.#currentIndex) return;
    const previousIndex = this.#currentIndex;
    const outgoing = this.slides[previousIndex]!;
    const incoming = this.slides[next]!;
    this.#resetAnimations(outgoing);
    this.#currentIndex = next;
    history.replaceState(null, "", `#${incoming.dataset.slideId ?? next + 1}`);
    window.dispatchEvent(new CustomEvent("slides-studio:slide-change", { detail: { index: next, slideId: incoming.dataset.slideId } }));
    const spec = this.#transitionFor(incoming);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this.options.mode === "export" || spec.kind === "none" || spec.durationMs === 0) {
      this.#render();
      this.#preloaded = preloadAdjacentSlides(this.slides, next, this.#preloaded);
      return;
    }
    this.#prepareTransitionSlides(outgoing, incoming);
    let entranceStarted = false;
    let sessionRef: TransitionSession | null = null;
    const session = createTransitionSession({
      outgoing,
      incoming,
      container: incoming.parentElement ?? document.body,
      spec,
      reducedMotion: reduced,
      prefix: `transition-${previousIndex}-${next}-${Date.now()}`,
      onTargetEntrance: (clone) => {
        if (entranceStarted) return;
        entranceStarted = true;
        this.#motion.play(incoming, { reducedMotion: reduced, cloneRoot: clone });
      },
      onCommit: () => {
        if (!sessionRef || this.#transition === sessionRef) this.#transition = null;
        this.#render(entranceStarted ? incoming : undefined);
        this.#suspendMedia(outgoing);
        this.#preloaded = preloadAdjacentSlides(this.slides, next, this.#preloaded);
        document.documentElement.dataset.transitionState = "idle";
      },
    });
    sessionRef = session;
    this.#transition = session.committed ? null : session;
    document.documentElement.dataset.transitionState = session.committed ? "idle" : "active";
  }

  settleTransitions(): void {
    if (this.#transition && !this.#transition.committed) this.#transition.cancel(true);
    this.#transition = null;
    document.querySelectorAll<HTMLElement>("[data-transition-clone]").forEach((clone) => clone.remove());
    document.documentElement.dataset.transitionState = "settled";
  }

  async freezeForExport({ posterProgress = 0.5, mediaPosterTime = 0 }: ExportFreezeOptions = {}): Promise<void> {
    document.documentElement.dataset.exportState = "settling";
    this.settleTransitions();
    this.#hiddenState.clear();
    document.querySelectorAll<HTMLElement>("[data-authoring-ui], .presenter-tools, .slides-studio-chrome").forEach((element) => {
      this.#hiddenState.set(element, element.hidden);
      element.hidden = true;
    });
    this.slides.forEach((slide) => this.#motion.settle(slide, posterProgress));
    this.#animationState = [];
    for (const animation of document.getAnimations?.() ?? []) {
      this.#animationState.push({ animation, running: animation.playState === "running" });
      const effect = animation.effect; const timing = (effect as KeyframeEffect | null)?.getTiming?.();
      const duration = typeof timing?.duration === "number" && Number.isFinite(timing.duration) ? timing.duration : 1000;
      const iterations = typeof timing?.iterations === "number" ? timing.iterations : 1; const looping = iterations === Infinity || iterations > 1;
      const computed = effect?.getComputedTiming();
      if (looping) animation.currentTime = duration * Math.max(0, Math.min(1, posterProgress));
      else if (computed && Number.isFinite(computed.endTime)) animation.currentTime = Number(computed.endTime);
      else animation.currentTime = duration * Math.max(0, Math.min(1, posterProgress));
      animation.pause();
    }
    const mediaTasks = Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio")).map((media) => {
      const declared = Number(media.dataset.posterTime ?? mediaPosterTime);
      return settleMedia(media, declared);
    });
    for (const loop of document.querySelectorAll<HTMLElement>("[data-motion-loop]")) loop.style.setProperty("--poster-progress", String(Number(loop.dataset.posterProgress ?? posterProgress)));
    await Promise.all([
      document.fonts?.ready,
      ...Array.from(document.querySelectorAll<HTMLImageElement>("img")).map(waitForImage),
      ...mediaTasks,
    ]);
    document.documentElement.dataset.exportState = "settled";
    window.dispatchEvent(new CustomEvent("slides-studio:export-settled"));
  }

  resumeFromExport(): void {
    delete document.documentElement.dataset.exportState;
    for (const [element, hidden] of this.#hiddenState) element.hidden = hidden;
    this.#hiddenState.clear();
    this.#motion.resumeSettled();
    for (const state of this.#animationState) if (state.running) {
      try { state.animation.play(); } catch { /* detached animation */ }
    }
    this.#animationState = [];
    document.documentElement.dataset.transitionState = "idle";
  }

  destroy(): void {
    this.settleTransitions();
    this.#motion.cancelAll();
    window.removeEventListener("keydown", this.#onKeyDown);
    document.querySelectorAll("link[data-transition-preload]").forEach((link) => link.remove());
    delete document.documentElement.dataset.slidesStudioRuntime;
    delete document.documentElement.dataset.transitionState;
  }

  #transitionFor(slide: HTMLElement): TransitionSpecV1 {
    return transitionFromSlide(slide)
      ?? (slide.dataset.slideId ? this.#deckTransitions.bySlide.get(slide.dataset.slideId) : undefined)
      ?? this.options.defaultTransition
      ?? this.#deckTransitions.defaultTransition
      ?? DEFAULT_NONE;
  }

  #prepareTransitionSlides(outgoing: HTMLElement, incoming: HTMLElement): void {
    for (const className of ACTIVE_CLASSES) { outgoing.classList.add(className); incoming.classList.add(className); }
    outgoing.setAttribute("aria-hidden", "true");
    incoming.setAttribute("aria-hidden", "true");
    outgoing.style.pointerEvents = "none";
    incoming.style.pointerEvents = "none";
  }

  #render(suppressMotionFor?: HTMLElement): void {
    this.slides.forEach((slide, index) => {
      const active = index === this.#currentIndex;
      for (const className of ACTIVE_CLASSES) slide.classList.toggle(className, active);
      slide.setAttribute("aria-hidden", String(!active));
      slide.style.pointerEvents = active ? "auto" : "none";
      if (active) {
        if (slide !== suppressMotionFor) this.#motion.play(slide, { reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
      } else this.#suspendMedia(slide);
    });
  }

  #resetAnimations(slide: HTMLElement | undefined): void {
    if (!slide) return;
    this.#motion.reset(slide);
    (slide.getAnimations?.({ subtree: true }) ?? []).forEach((animation) => { try { animation.cancel(); } catch { /* detached animation */ } });
  }

  #suspendMedia(slide: HTMLElement): void { slide.querySelectorAll<HTMLMediaElement>("video, audio").forEach((media) => media.pause()); }
}

export function bootstrapSlidesRuntime(options: SlidesRuntimeOptions = {}): SlidesRuntime { return new SlidesRuntime(options); }

declare global { interface Window { SlidesStudio?: RuntimeApi; } }

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const auto = document.currentScript?.getAttribute("data-auto") !== "false";
  if (auto) window.addEventListener("DOMContentLoaded", () => { if (!window.SlidesStudio && document.querySelector(".slide")) window.SlidesStudio = bootstrapSlidesRuntime(); }, { once: true });
}
