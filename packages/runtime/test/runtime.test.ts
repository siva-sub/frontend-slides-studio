import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionController, SlidesRuntime, preloadAdjacentSlides, sanitizeTransitionClone, transitionFrames } from "../src/index.js";
import type { TransitionKind, TransitionSpecV1 } from "@slides-studio/protocol";

interface FakeAnimation extends Partial<Animation> {
  target: HTMLElement;
  frames: Keyframe[];
  playState: AnimationPlayState;
  currentTime: number | null;
  cancelled: boolean;
}

let animations: FakeAnimation[] = [];

function installAnimationStub(): void {
  animations = [];
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
      const duration = typeof options.duration === "number" ? options.duration : 0; const iterations = typeof options.iterations === "number" ? options.iterations : 1;
      const animation: FakeAnimation = {
        target: this,
        frames,
        currentTime: 0,
        playState: "running",
        cancelled: false,
        effect: { getComputedTiming: () => ({ endTime: duration * iterations }), getTiming: () => ({ duration, iterations }) } as unknown as AnimationEffect,
        finished,
        pause() { animation.playState = "paused"; },
        play() { animation.playState = "running"; },
        cancel() { animation.cancelled = true; animation.playState = "idle"; resolveFinished(); },
        finish() { animation.currentTime = duration; animation.playState = "finished"; resolveFinished(); },
      };
      animations.push(animation);
      return animation as Animation;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value() { return animations.filter((animation) => !animation.cancelled && (animation.target === this || this.contains(animation.target))) as Animation[]; },
  });
  Object.defineProperty(document, "getAnimations", {
    configurable: true,
    value: () => animations.filter((animation) => !animation.cancelled) as Animation[],
  });
}

const transition = (kind: TransitionKind, durationMs = 100): TransitionSpecV1 => ({ schemaVersion: 1, kind, durationMs, easing: "ease-out", reducedMotion: "fade", targetEntranceStartFraction: 0.5 });
const motionScript = (replay: "always" | "once" | "never" = "once", iterations = 1) => `<script type="application/json" data-motion-program>{"schemaVersion":1,"replay":"${replay}","tracks":[{"objectId":"target","keyframes":[{"opacity":0},{"opacity":1}],"options":{"duration":80,"delay":0,"easing":"ease-out","iterations":${iterations},"fill":"both"},"reducedMotion":{"opacity":1}}]}</script>`;

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = '<main class="deck-stage"><section class="slide">One</section><section class="slide">Two</section></main>';
  document.documentElement.removeAttribute("data-export-state");
  history.replaceState(null, "", "/");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  installAnimationStub();
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("SlidesRuntime", () => {
  it("assigns stable slide IDs and navigates without display toggles", () => {
    const runtime = new SlidesRuntime({ keyboard: false });
    expect(runtime.slides[0]?.dataset.slideId).toBe("slide-01");
    runtime.next();
    expect(runtime.currentIndex).toBe(1);
    expect(runtime.slides[1]?.classList.contains("active")).toBe(true);
    expect(runtime.slides[0]?.style.display).toBe("");
  });

  it("omits explicitly skipped slides in present mode", () => {
    document.querySelectorAll<HTMLElement>(".slide")[0]!.dataset.slideSkipped = "true";
    const runtime = new SlidesRuntime({ keyboard: false, mode: "present" });
    expect(runtime.slideCount).toBe(1); expect(runtime.slides[0]?.textContent).toBe("Two");
  });

  it("builds deterministic keyframes for all ten transition kinds", () => {
    const kinds: TransitionKind[] = ["none", "crossfade", "slide", "zoom", "circle-reveal", "clip-wipe", "pixel-grid", "pixel-bars", "slice-vertical", "slice-horizontal"];
    const frames = kinds.map((kind) => JSON.stringify(transitionFrames(transition(kind))));
    expect(frames).toHaveLength(10);
    expect(new Set(frames).size).toBe(10);
    expect(frames).toEqual(kinds.map((kind) => JSON.stringify(transitionFrames(transition(kind)))));
  });

  it("sanitizes transition clones and rewrites SVG/ARIA references", () => {
    document.body.innerHTML = '<section class="slide" id="slide"><svg id="icon" aria-labelledby="title"><defs><linearGradient id="paint"></linearGradient></defs><title id="title">Icon</title><rect id="shape" fill="url(#paint)" data-object-id="hero"/></svg><button id="action" onclick="bad()" data-object-id="button">Go</button><script>bad()</script></section>';
    const clone = sanitizeTransitionClone(document.querySelector("section")!, "clone-a");
    expect(clone.dataset.transitionClone).toBe("true");
    expect(clone.querySelector("script")).toBeNull();
    expect(clone.querySelector("[onclick]")).toBeNull();
    expect(clone.querySelector("[data-object-id]")).toBeNull();
    expect(clone.querySelector('[data-clone-source-id="hero"]')).not.toBeNull();
    expect(clone.querySelector("rect")?.getAttribute("fill")).toBe("url(#clone-a-paint)");
    expect(clone.querySelector("svg")?.getAttribute("aria-labelledby")).toBe("clone-a-title");
    expect(new Set(Array.from(clone.querySelectorAll("[id]")).map((element) => element.id)).size).toBe(clone.querySelectorAll("[id]").length);
  });

  it("honors replay once/never and reduced-motion final states", () => {
    document.body.innerHTML = `<section class="slide"><div data-object-id="target"></div>${motionScript("once")}</section>`;
    const slide = document.querySelector<HTMLElement>(".slide")!;
    const controller = new MotionController();
    expect(controller.play(slide)).toBe(true);
    expect(slide.dataset.motionPlayed).toBe("true");
    expect(controller.play(slide)).toBe(false);
    expect(animations.filter((animation) => animation.target.dataset.objectId === "target")).toHaveLength(1);
    slide.querySelector("script")!.textContent = motionScript("never").match(/>(.*)<\/script>/)![1]!;
    delete slide.dataset.motionPlayed;
    expect(controller.play(slide)).toBe(false);
    expect(slide.querySelector<HTMLElement>('[data-object-id="target"]')?.style.opacity).toBe("1");
    slide.querySelector("script")!.textContent = motionScript("always").match(/>(.*)<\/script>/)![1]!;
    expect(controller.play(slide, { reducedMotion: true })).toBe(false);
  });

  it("settles inactive motion programs to deterministic poster frames and restores styles", () => {
    document.body.innerHTML = `<section class="slide"><div data-object-id="target" style="color:red"></div>${motionScript("always")}</section>`;
    const slide = document.querySelector<HTMLElement>(".slide")!;
    const target = slide.querySelector<HTMLElement>('[data-object-id="target"]')!;
    const controller = new MotionController();
    controller.settle(slide, 0.5);
    expect(target.style.opacity).toBe("1");
    expect(target.dataset.motionSettled).toBe("true");
    controller.resumeSettled();
    expect(target.getAttribute("style")).toBe("color:red");
    expect(target.dataset.motionSettled).toBeUndefined();
  });

  it("interpolates finite loops at poster progress instead of snapping or finishing", async () => {
    document.body.innerHTML = `<main class="deck-stage"><section class="slide"><div data-object-id="target"></div>${motionScript("always", 3)}</section></main>`;
    const runtime = new SlidesRuntime({ keyboard: false }); const target = document.querySelector<HTMLElement>('[data-object-id="target"]')!;
    await runtime.freezeForExport({ posterProgress: 0.4 });
    expect(Number(target.style.opacity)).toBeCloseTo(0.4, 5);
    expect(animations.find((animation) => animation.target === target)?.currentTime).toBeCloseTo(32, 5);
  });

  it("starts target entrance exactly once and suppresses duplicate playback at commit", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main class="deck-stage"><section class="slide">One</section><section class="slide"><div data-object-id="target">Target</div>${motionScript("once")}</section></main>`;
    const runtime = new SlidesRuntime({ keyboard: false, defaultTransition: transition("crossfade") });
    runtime.next();
    expect(document.querySelectorAll("[data-transition-clone]")).toHaveLength(2);
    vi.advanceTimersByTime(50);
    expect(animations.filter((animation) => animation.target.dataset.objectId === "target")).toHaveLength(1);
    expect(animations.filter((animation) => animation.target.dataset.cloneSourceId === "target")).toHaveLength(1);
    vi.advanceTimersByTime(50);
    expect(document.querySelectorAll("[data-transition-clone]")).toHaveLength(0);
    expect(animations.filter((animation) => animation.target.dataset.objectId === "target")).toHaveLength(1);
    expect(runtime.currentIndex).toBe(1);
  });

  it("cancels rapid navigation without stale clones or timers", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main class="deck-stage"><section class="slide">One</section><section class="slide">Two</section><section class="slide">Three</section></main>';
    const runtime = new SlidesRuntime({ keyboard: false, defaultTransition: transition("slide", 120) });
    runtime.goTo(1);
    runtime.goTo(2);
    expect(runtime.currentIndex).toBe(2);
    expect(document.querySelectorAll("[data-transition-clone]")).toHaveLength(2);
    vi.runAllTimers();
    expect(document.querySelectorAll("[data-transition-clone]")).toHaveLength(0);
    expect(runtime.transitioning).toBe(false);
  });

  it("preloads adjacent media once", () => {
    document.body.innerHTML = '<section class="slide"><img src="/a.png"></section><section class="slide"><video poster="/poster.jpg"><source src="/clip.mp4"></video></section><section class="slide"><img src="/c.png"></section>';
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    const seen = preloadAdjacentSlides(slides, 1);
    preloadAdjacentSlides(slides, 1, seen);
    expect(document.querySelectorAll("link[data-transition-preload]")).toHaveLength(2);
  });

  it("freezes mid-transition with no clones and restores prior hidden states", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<main class="deck-stage"><section class="slide">One</section><section class="slide"><div data-object-id="target">Target</div>${motionScript("always")}</section></main><div data-authoring-ui hidden></div><div class="presenter-tools"></div>`;
    const runtime = new SlidesRuntime({ keyboard: false, defaultTransition: transition("zoom", 300) });
    runtime.next();
    expect(document.querySelectorAll("[data-transition-clone]")).toHaveLength(2);
    await runtime.freezeForExport({ posterProgress: 0.4 });
    expect(document.querySelectorAll("[data-transition-clone]")).toHaveLength(0);
    expect(document.documentElement.dataset.exportState).toBe("settled");
    expect(document.getAnimations().every((animation) => animation.playState !== "running")).toBe(true);
    runtime.resumeFromExport();
    const authoring = document.querySelector<HTMLElement>("[data-authoring-ui]")!;
    const presenter = document.querySelector<HTMLElement>(".presenter-tools")!;
    expect(authoring.hidden).toBe(true);
    expect(presenter.hidden).toBe(false);
  });
});
