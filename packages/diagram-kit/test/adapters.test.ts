import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DIAGRAM_ADAPTERS,
  DIAGRAM_TYPES,
  createAllDiagramFixtures,
  createDiagramFixture,
  layoutDiagram,
  renderDiagramSvg,
  validateDiagram,
} from "../src/index.js";
import { migrateDiagramV1ToV2, type DiagramSpecV1 } from "@slides-studio/protocol";

const theme = { paper: "#f5f5f2", paper2: "#fff", ink: "#20231f", muted: "#6f756d", rule: "#d8dbd4", accent: "#f05a36", accentTint: "#fde8e1", link: "#315f9d", titleFont: "Fraunces", bodyFont: "Manrope", monoFont: "IBM Plex Mono" };

describe("type-specific diagram adapters", () => {
  it("registers exactly 27 exhaustive adapters with distinct grammar markers and budgets", () => {
    expect(DIAGRAM_TYPES).toHaveLength(27);
    expect(Object.keys(DIAGRAM_ADAPTERS).toSorted()).toEqual([...DIAGRAM_TYPES].toSorted());
    const grammars = Object.values(DIAGRAM_ADAPTERS).map((adapter) => adapter.metadata.grammar);
    expect(new Set(grammars).size).toBe(27);
    for (const adapter of Object.values(DIAGRAM_ADAPTERS)) {
      expect(adapter.metadata.budget.items).toBeGreaterThan(0);
      expect(adapter.metadata.budget.connections).toBeGreaterThanOrEqual(0);
    }
  });

  it("renders every canonical fixture deterministically with its type grammar", () => {
    const hashes: string[] = [];
    for (const fixture of createAllDiagramFixtures()) {
      const issues = validateDiagram(fixture).filter((issue) => issue.severity === "error");
      expect(issues, fixture.type).toEqual([]);
      const first = renderDiagramSvg(fixture);
      const second = renderDiagramSvg(createDiagramFixture(fixture.type));
      expect(first).toBe(second);
      expect(first).toContain(`data-diagram-type="${fixture.type}"`);
      expect(first).toContain(`data-diagram-grammar="${DIAGRAM_ADAPTERS[fixture.type].metadata.grammar}"`);
      const layout = layoutDiagram(fixture);
      expect(layout.primitives.length).toBeGreaterThan(0);
      expect(layout.primitives.every((primitive) => ["rect", "ellipse", "text", "connector"].includes(primitive.kind))).toBe(true);
      hashes.push(createHash("sha256").update(first).digest("hex"));
    }
    expect(new Set(hashes).size).toBe(27);
  });

  it("preserves every legacy V1 node, edge, label, and stable ID across all 27 adapters", () => {
    for (const type of DIAGRAM_TYPES) {
      const legacy: DiagramSpecV1 = {
        schemaVersion: 1, id: `legacy-${type}`, type, variant: "editorial", direction: "ltr", theme,
        nodes: [{ id: "alpha", label: "Alpha", kind: "focal" }, { id: "beta", label: "Beta", kind: "step" }, { id: "gamma", label: "Gamma", kind: "store" }],
        edges: [{ id: "edge-alpha-beta", source: "alpha", target: "beta", label: "first", kind: "accent" }, { id: "edge-beta-gamma", source: "beta", target: "gamma", label: "second", kind: "link" }],
      };
      expect(validateDiagram(legacy).filter((issue) => issue.severity === "error"), type).toEqual([]);
      const layout = layoutDiagram(legacy);
      expect(layout.nodes.size, type).toBe(legacy.nodes.length);
      expect(layout.edges.length, type).toBe(legacy.edges.length);
      const svg = renderDiagramSvg(legacy);
      for (const item of [...legacy.nodes, ...legacy.edges]) expect(svg, `${type}:${item.id}`).toContain(`data-object-id="${item.id}"`);
      expect(svg, type).toContain("first");
      expect(svg, type).toContain("second");
      expect(svg, type).toBe(renderDiagramSvg(migrateDiagramV1ToV2(legacy)));
    }
  });

  it("renders migrated legacy V1 and V2 graphs byte-identically", () => {
    const v1: DiagramSpecV1 = {
      schemaVersion: 1, id: "legacy-equivalence", type: "architecture", variant: "editorial", direction: "ltr", theme,
      nodes: [{ id: "a", label: "A", kind: "focal" }, { id: "b", label: "B", kind: "step" }],
      edges: [{ id: "edge", source: "a", target: "b", label: "same", kind: "accent" }],
    };
    expect(renderDiagramSvg(v1)).toBe(renderDiagramSvg(migrateDiagramV1ToV2(v1)));
  });

  it("fans shared ports, records deterministic bridges, and masks connector labels", () => {
    const spec: DiagramSpecV1 = {
      schemaVersion: 1, id: "routing", type: "architecture", variant: "light", direction: "ltr", theme,
      nodes: [
        { id: "left", label: "Left", x: 80, y: 240, width: 160, height: 72 },
        { id: "right", label: "Right", x: 760, y: 240, width: 160, height: 72 },
        { id: "top", label: "Top", x: 420, y: 40, width: 160, height: 72 },
        { id: "bottom", label: "Bottom", x: 420, y: 440, width: 160, height: 72 },
        { id: "fan-a", label: "Fan A", x: 760, y: 80, width: 160, height: 72 },
      ],
      edges: [
        { id: "horizontal", source: "left", target: "right", label: "masked label", kind: "default" },
        { id: "vertical", source: "top", target: "bottom", kind: "link" },
        { id: "fan-one", source: "left", target: "fan-a", kind: "default" },
      ],
    };
    const layout = layoutDiagram(spec);
    const horizontal = layout.edges.find((edge) => edge.edge.id === "horizontal")!;
    const fan = layout.edges.find((edge) => edge.edge.id === "fan-one")!;
    expect(horizontal.points[0]).not.toEqual(fan.points[0]);
    expect(layout.edges.find((edge) => edge.edge.id === "vertical")?.bridges.some((point) => point.x === 500)).toBe(true);
    const svg = renderDiagramSvg(spec);
    expect(svg).toContain('data-label-mask="true"');
    expect(svg).toContain('data-bridge="true"');
  });
});
