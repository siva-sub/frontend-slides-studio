import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (args: string[]) => spawnSync("pnpm", ["exec", "tsx", "src/index.ts", ...args], { cwd: packageRoot, encoding: "utf8" });

describe("CLI motion and transition workflows", () => {
  it("writes complete motion presets/replay and applies a transition contract", () => {
    const root = mkdtempSync(join(tmpdir(), "slides-studio-cli-motion-"));
    try {
      const analysis = join(root, "analysis.json"); const intent = join(root, "intent.json"); const motion = join(root, "motion.json");
      writeFileSync(analysis, JSON.stringify({ schemaVersion: 1, source: "clip.mp4", durationMs: 1000, fps: 30, energy: [], segments: [], caveats: [] }));
      writeFileSync(intent, JSON.stringify({ schemaVersion: 1, mappings: [{ objectId: "hero", effect: "blur", startMs: 120, durationMs: 640, easing: "ease-out" }] }));
      const motionResult = run(["motion", "apply", "--analysis", analysis, "--intent", intent, "--replay", "once", "--output", motion]);
      expect(motionResult.status, motionResult.stderr || motionResult.stdout).toBe(0);
      const program = JSON.parse(readFileSync(motion, "utf8"));
      expect(program.replay).toBe("once");
      expect(program.tracks[0].keyframes[0]).toMatchObject({ opacity: 0, filter: "blur(18px)" });
      expect(Number.isFinite(program.tracks[0].options.iterations)).toBe(true);

      const deck = join(root, "deck.json"); const spec = join(root, "transition.json"); const output = join(root, "deck-transition.json");
      writeFileSync(deck, JSON.stringify({ schemaVersion: 1, id: "deck", title: "Deck", slides: [{ id: "s1", role: "cover" }, { id: "s2", role: "content" }] }));
      writeFileSync(spec, JSON.stringify({ schemaVersion: 1, kind: "slice-horizontal", durationMs: 700, easing: "ease-out", reducedMotion: "fade" }));
      const transitionResult = run(["transition", "apply", "--input", deck, "--spec", spec, "--slide", "s2", "--output", output]);
      expect(transitionResult.status, transitionResult.stderr || transitionResult.stdout).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf8")).slides[1].transition.kind).toBe("slice-horizontal");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
