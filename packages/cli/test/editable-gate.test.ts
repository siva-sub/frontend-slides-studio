import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("CLI editable evidence gate", () => {
  it("requires quality evidence unless explicitly unverified", () => {
    const root = mkdtempSync(join(tmpdir(), "slides-studio-cli-editable-"));
    try {
      const graph = join(root, "graph.json"); const output = join(root, "deck.pptx");
      writeFileSync(graph, JSON.stringify({ schemaVersion: 1, title: "Gate", slides: [{ id: "s1", width: 1920, height: 1080, objects: [{ id: "shape", sourceId: "shape", sourceKind: "dom", type: "shape", x: 0, y: 0, width: 100, height: 100, zIndex: 0, native: true, shape: "rectangle" }] }] }));
      const result = spawnSync("pnpm", ["exec", "tsx", "src/index.ts", "pptx", "editable", "--graph", graph, "--output", output], { cwd: packageRoot, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/--quality-report is required/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);
});
