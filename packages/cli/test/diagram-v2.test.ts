import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(packageRoot, "../..");

describe("CLI DiagramSpecV2 rendering", () => {
  it("renders a checked-in typed fixture through the public CLI", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "slides-studio-cli-diagram-v2-"));
    const output = join(tempRoot, "gantt.svg");
    try {
      const result = spawnSync("pnpm", ["exec", "tsx", "src/index.ts", "diagram", "render", "--input", resolve(projectRoot, "examples/diagram-gallery/fixtures/gantt.json"), "--output", output], { cwd: packageRoot, encoding: "utf8" });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const svg = readFileSync(output, "utf8");
      expect(svg).toContain('data-diagram-type="gantt"');
      expect(svg).toContain('data-diagram-grammar="gantt-schedule"');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
