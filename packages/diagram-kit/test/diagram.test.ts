import { describe, expect, it } from "vitest";
import type { DiagramSpecV1 } from "@slides-studio/protocol";
import { layoutDiagram, renderDiagramSvg, validateDiagram } from "../src/index.js";

const spec: DiagramSpecV1 = {
  schemaVersion: 1, id: "platform", type: "architecture", variant: "light", direction: "ltr",
  theme: { paper: "#f5f5f2", paper2: "#ffffff", ink: "#20231f", muted: "#6f756d", rule: "#d8dbd4", accent: "#f05a36", accentTint: "#fde8e1", link: "#315f9d", titleFont: "Fraunces", bodyFont: "Manrope", monoFont: "IBM Plex Mono" },
  nodes: [{ id: "studio", label: "Studio", kind: "focal" }, { id: "runtime", label: "Runtime", kind: "step" }, { id: "export", label: "Export", kind: "store" }],
  edges: [{ id: "e1", source: "studio", target: "runtime", label: "POSTMESSAGE", kind: "link" }, { id: "e2", source: "runtime", target: "export", kind: "accent" }],
};

describe("DiagramSpec", () => {
  it("routes every segment orthogonally with stable IDs", () => {
    const layout = layoutDiagram(spec);
    for (const edge of layout.edges) for (let index = 0; index < edge.points.length - 1; index++) { const a = edge.points[index]!; const b = edge.points[index + 1]!; expect(a.x === b.x || a.y === b.y).toBe(true); }
    expect(renderDiagramSvg(spec)).toContain('data-object-id="studio"');
  });

  it("rejects missing endpoints and excessive focal nodes", () => {
    const broken = { ...spec, nodes: [...spec.nodes, { id: "too", label: "Too", kind: "focal" as const }, { id: "also", label: "Also", kind: "focal" as const }], edges: [...spec.edges, { id: "bad", source: "missing", target: "studio", kind: "default" as const }] };
    const codes = validateDiagram(broken).map((issue) => issue.code);
    expect(codes).toContain("missing-endpoint");
    expect(codes).toContain("focal-count");
  });

  it("supports all 27 diagram type names through shared family adapters", () => {
    const types = ["architecture","it-state","flowchart","sequence","state","er","timeline","swimlane","quadrant","radar","loop","nested","tree","org-chart","layers","venn","pyramid","bar","line","gantt","scatter","high-level","process","medallion","data-flow","dp-integration","dp-security-matrix"] as const;
    expect(types.every((type) => validateDiagram({ ...spec, type }).every((issue) => issue.code !== "schema"))).toBe(true);
  });
});
