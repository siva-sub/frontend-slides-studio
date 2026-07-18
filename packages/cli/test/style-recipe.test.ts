import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(args: string[]) {
  return spawnSync("pnpm", ["exec", "tsx", "src/index.ts", ...args], { cwd: packageRoot, encoding: "utf8" });
}

describe("CLI style and recipe discovery", () => {
  it("lists styles and scaffolds a deterministic recipe deck", () => {
    const styles = run(["styles", "list"]);
    expect(styles.status, styles.stderr || styles.stdout).toBe(0);
    const styleRecords = JSON.parse(styles.stdout) as Array<{ id: string }>;
    expect(styleRecords).toHaveLength(32);
    for (const inspectArgs of [[styleRecords[0]!.id], ["--id", styleRecords[0]!.id]]) {
      const inspected = run(["styles", "inspect", ...inspectArgs]);
      expect(inspected.status, inspected.stderr || inspected.stdout).toBe(0);
      expect(JSON.parse(inspected.stdout).style.id).toBe(styleRecords[0]!.id);
    }

    const recipes = run(["recipes", "list"]);
    expect(recipes.status, recipes.stderr || recipes.stdout).toBe(0);
    const recipeRecords = JSON.parse(recipes.stdout) as Array<{ id: string }>;
    expect(recipeRecords).toHaveLength(6);
    for (const inspectArgs of [[recipeRecords[0]!.id], ["--id", recipeRecords[0]!.id]]) {
      const inspected = run(["recipes", "inspect", ...inspectArgs]);
      expect(inspected.status, inspected.stderr || inspected.stdout).toBe(0);
      expect(JSON.parse(inspected.stdout).id).toBe(recipeRecords[0]!.id);
    }

    const root = mkdtempSync(join(tmpdir(), "slides-studio-cli-recipe-"));
    try {
      const compoundLayoutId = "swiss-grid/agenda-structured-overview";
      for (const inspectArgs of [[compoundLayoutId], ["--id", compoundLayoutId]]) {
        const inspected = run(["layouts", "inspect", ...inspectArgs]);
        expect(inspected.status, inspected.stderr || inspected.stdout).toBe(0);
        expect(JSON.parse(inspected.stdout).id).toBe(compoundLayoutId);
      }

      const queried = run(["layouts", "query", "--style", "swiss-grid", "--role", "agenda", "--seed", "stable"]);
      expect(queried.status, queried.stderr || queried.stdout).toBe(0);
      const queriedLayouts = JSON.parse(queried.stdout) as Array<{ id: string; styleId: string; role: string }>;
      expect(queriedLayouts.length).toBeGreaterThan(0);
      expect(queriedLayouts.every((layout) => layout.styleId === "swiss-grid" && layout.role === "agenda" && layout.id.includes("/"))).toBe(true);

      const propsPath = join(root, "layout-props.json");
      const props = { title: "  Agenda  ", items: [{ name: "A" }, { name: "B" }, { name: "C" }] };
      writeFileSync(propsPath, JSON.stringify(props));
      for (const normalizeArgs of [[compoundLayoutId, propsPath], ["--id", compoundLayoutId, "--props", propsPath]]) {
        const normalized = run(["layouts", "normalize", ...normalizeArgs]);
        expect(normalized.status, normalized.stderr || normalized.stdout).toBe(0);
        const result = JSON.parse(normalized.stdout) as { compoundId: string; props: { title: string }; issues: unknown[] };
        expect(result.compoundId).toBe(compoundLayoutId);
        expect(result.props.title).toBe("Agenda");
        expect(result.issues).toEqual([]);
      }

      const output = join(root, "deck-goal.json");
      const scaffold = run(["recipes", "scaffold", recipeRecords[0]!.id, "--seed", "stable", "--output", output]);
      expect(scaffold.status, scaffold.stderr || scaffold.stdout).toBe(0);
      const flagOutput = join(root, "deck-goal-flag.json");
      const flagScaffold = run(["recipes", "scaffold", "--id", recipeRecords[0]!.id, "--seed", "stable", "--output", flagOutput]);
      expect(flagScaffold.status, flagScaffold.stderr || flagScaffold.stdout).toBe(0);
      expect(readFileSync(flagOutput, "utf8")).toBe(readFileSync(output, "utf8"));
      const deck = JSON.parse(readFileSync(output, "utf8")) as { schemaVersion: number; theme?: string; slides: Array<{ layout?: string }> };
      expect(deck.schemaVersion).toBe(1);
      expect(deck.theme).toBe(styleRecords.find((style) => style.id === deck.theme)?.id);
      expect(deck.slides.length).toBeGreaterThan(0);
      expect(deck.slides.every((slide) => typeof slide.layout === "string")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
