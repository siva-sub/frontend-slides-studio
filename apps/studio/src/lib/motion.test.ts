import { describe, expect, it } from "vitest";
import { applyObjectMotion, applySlideTransition, createMotionTrack, motionKeyframes, readMotionProgram, readSlideTransition, removeObjectMotion } from "./motion";

const html = '<!doctype html><html><body><section class="slide" data-slide-id="s1"><h1 data-object-id="title">Title</h1></section><section class="slide" data-slide-id="s2"><p data-object-id="body">Body</p></section></body></html>';

describe("Studio transition and object-motion helpers", () => {
  it("round-trips a validated page transition without changing other slides", () => {
    const updated = applySlideTransition(html, 1, { schemaVersion: 1, kind: "circle-reveal", durationMs: 720, easing: "ease-out", direction: "clockwise", targetEntranceStartFraction: 0.42, reducedMotion: "fade" });
    expect(readSlideTransition(updated, 1)).toMatchObject({ kind: "circle-reveal", durationMs: 720, targetEntranceStartFraction: 0.42 });
    expect(readSlideTransition(updated, 0)).toBeNull();
    expect(readSlideTransition(applySlideTransition(updated, 1, null), 1)).toBeNull();
  });

  it("persists replay semantics and replaces only the selected object track", () => {
    const title = createMotionTrack("title", "blur", { durationMs: 640, delayMs: 80 });
    const first = applyObjectMotion(html, 0, "title", title, "once");
    expect(readMotionProgram(first, 0)).toMatchObject({ replay: "once", tracks: [{ objectId: "title" }] });
    const replacement = createMotionTrack("title", "rotate", { durationMs: 400 });
    const second = applyObjectMotion(first, 0, "title", replacement, "always");
    const program = readMotionProgram(second, 0)!;
    expect(program.replay).toBe("always");
    expect(program.tracks).toHaveLength(1);
    expect(program.tracks[0]?.keyframes[0]).toHaveProperty("rotate", "-5deg");
    expect(readMotionProgram(removeObjectMotion(second, 0, "title"), 0)).toBeNull();
  });

  it("provides deterministic keyframes for every supported preset", () => {
    const presets = ["reveal", "fade", "slide", "scale", "draw", "focus", "loop", "blur", "wipe", "rotate", "pulse", "stagger"] as const;
    const first = presets.map((preset) => JSON.stringify(motionKeyframes(preset)));
    expect(first).toEqual(presets.map((preset) => JSON.stringify(motionKeyframes(preset))));
    expect(new Set(first).size).toBeGreaterThanOrEqual(10);
  });

  it("leaves HTML unchanged when the target slide or object is absent", () => {
    expect(applySlideTransition(html, 9, null)).toBe(html);
    expect(applyObjectMotion(html, 0, "missing", createMotionTrack("missing", "fade"), "once")).toBe(html);
  });
});
