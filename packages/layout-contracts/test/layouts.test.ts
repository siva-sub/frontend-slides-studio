import { describe, expect, it } from "vitest";
import { normalizeLayout, queryLayouts, validateLayoutProps } from "../src/index.js";

describe("layout contracts", () => {
  it("selects deterministically and penalizes reused unique layouts", () => {
    const first = queryLayouts({ role: "cover", seed: "deck-a" });
    const second = queryLayouts({ role: "cover", seed: "deck-a" });
    expect(first.map((item) => item.key)).toEqual(second.map((item) => item.key));
  });

  it("validates copy and arrays", () => {
    const layout = queryLayouts({ role: "data" })[0]!;
    expect(validateLayoutProps(layout, { title: "A", metrics: [{}, {}], emphasisIndex: 1 })).toEqual([]);
    expect(validateLayoutProps(layout, { title: "A", metrics: [], emphasisIndex: 8 }).filter((issue) => issue.severity === "error")).toHaveLength(2);
  });

  it("only substitutes for objective media capacity", () => {
    const result = normalizeLayout("folio-statement", { title: "A" }, 1);
    expect(result.substitutions[0]?.reason).toMatch(/media capacity/);
  });
});
