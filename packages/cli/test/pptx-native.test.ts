import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (args: string[]) => spawnSync("pnpm", ["exec", "tsx", "src/index.ts", ...args], { cwd: packageRoot, encoding: "utf8" });

describe("CLI native PPTX discovery", () => {
  it("lists externally validated shapes and every ppt-rs transition kind", () => {
    const shapes = run(["pptx", "shapes", "list"]); expect(shapes.status, shapes.stderr).toBe(0);
    const shapeData = JSON.parse(shapes.stdout); expect(shapeData.count).toBeGreaterThanOrEqual(178); expect(shapeData.presets).toContain("foldedCorner"); expect(shapeData.presets).not.toContain("folderCorner");
    const alias = run(["pptx", "shapes", "resolve", "--name", "flowChartOffPageConnector"]); expect(alias.status, alias.stderr).toBe(0); expect(JSON.parse(alias.stdout)).toMatchObject({ preset: "flowChartOffpageConnector", compatibilityAlias: "flowChartOffPageConnector" });
    const unsupported = run(["pptx", "shapes", "resolve", "--name", "cone"]); expect(unsupported.status).not.toBe(0); expect(unsupported.stderr).toMatch(/no schema-valid native preset/);
    const transitions = run(["pptx", "transitions"]); expect(transitions.status, transitions.stderr).toBe(0); expect(JSON.parse(transitions.stdout).transitions).toEqual(["none", "cut", "fade", "push", "wipe", "split", "reveal", "cover", "zoom"]);
  }, 30_000);
});
