import {
  DIAGRAM_TYPE_FAMILY,
  type DiagramEdge,
  type DiagramNode,
  type DiagramType,
} from "@slides-studio/protocol";
import type { NormalizedDiagram } from "./normalize.js";
import type {
  Box,
  ConnectorPrimitive,
  DiagramAdapterMetadata,
  DiagramLayout,
  DiagramPrimitive,
  EllipsePrimitive,
  Point,
  RectPrimitive,
  TextPrimitive,
} from "./primitives.js";
import { routeOrthogonal, roundedPath } from "./routing.js";

const VIEW_W = 1000;
const VIEW_H = 560;
const NODE_W = 160;
const NODE_H = 72;
const GRID = 4;
const roundGrid = (value: number) => Math.round(value / GRID) * GRID;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const records = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];

export interface DiagramAdapter {
  metadata: DiagramAdapterMetadata;
  layout(diagram: NormalizedDiagram): DiagramLayout;
}

type BoxBuilder = (node: DiagramNode, index: number, nodes: DiagramNode[], diagram: NormalizedDiagram) => Box;
type LayoutBuilder = (diagram: NormalizedDiagram, metadata: DiagramAdapterMetadata) => DiagramLayout;

function withExplicit(node: DiagramNode, fallback: Box): Box {
  return {
    x: node.x ?? fallback.x,
    y: node.y ?? fallback.y,
    width: node.width ?? fallback.width,
    height: node.height ?? fallback.height,
  };
}

function boxMap(diagram: NormalizedDiagram, builder: BoxBuilder): Map<string, DiagramNode & Box> {
  return new Map(diagram.nodes.map((node, index) => [node.id, { ...node, ...withExplicit(node, builder(node, index, diagram.nodes, diagram)) }]));
}

function horizontalBoxes(node: DiagramNode, index: number, nodes: DiagramNode[]): Box {
  const columns = Math.min(5, Math.max(1, nodes.length));
  const rows = Math.ceil(nodes.length / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const gap = (VIEW_W - 120 - columns * NODE_W) / Math.max(1, columns - 1);
  const rowGap = rows === 1 ? 0 : 128;
  return { x: roundGrid(60 + column * (NODE_W + gap)), y: roundGrid(244 - ((rows - 1) * rowGap) / 2 + row * rowGap), width: NODE_W, height: NODE_H };
}

function verticalBoxes(_node: DiagramNode, index: number, nodes: DiagramNode[]): Box {
  const height = 64;
  const gap = Math.min(42, (VIEW_H - 100 - nodes.length * height) / Math.max(1, nodes.length - 1));
  return { x: 420, y: roundGrid(50 + index * (height + Math.max(16, gap))), width: 160, height };
}

function gridBoxes(_node: DiagramNode, index: number, nodes: DiagramNode[]): Box {
  const columns = Math.min(4, Math.ceil(Math.sqrt(Math.max(1, nodes.length))));
  const row = Math.floor(index / columns);
  const column = index % columns;
  return { x: roundGrid(90 + column * 220), y: roundGrid(76 + row * 126), width: 170, height: 76 };
}

function radialBoxes(_node: DiagramNode, index: number, nodes: DiagramNode[]): Box {
  if (index === 0) return { x: 420, y: 244, width: 160, height: 72 };
  const satellites = Math.max(1, nodes.length - 1);
  const angle = -Math.PI / 2 + ((index - 1) * Math.PI * 2) / satellites;
  return { x: roundGrid(500 + Math.cos(angle) * 330 - 75), y: roundGrid(280 + Math.sin(angle) * 205 - 34), width: 150, height: 68 };
}

function treeBoxes(diagram: NormalizedDiagram, org = false): Map<string, DiagramNode & Box> {
  const parents = new Map<string, string>();
  for (const edge of diagram.edges) parents.set(edge.target, edge.source);
  const depthOf = (id: string) => {
    let depth = 0;
    let cursor = id;
    const seen = new Set<string>();
    while (parents.has(cursor) && !seen.has(cursor)) { seen.add(cursor); cursor = parents.get(cursor)!; depth += 1; }
    return depth;
  };
  const levels = new Map<number, DiagramNode[]>();
  for (const node of diagram.nodes) {
    const depth = depthOf(node.id);
    levels.set(depth, [...(levels.get(depth) ?? []), node]);
  }
  const map = new Map<string, DiagramNode & Box>();
  for (const [depth, nodes] of [...levels.entries()].sort(([left], [right]) => left - right)) {
    const width = org ? 172 : 150;
    const gap = (VIEW_W - 120 - nodes.length * width) / Math.max(1, nodes.length - 1);
    nodes.forEach((node, index) => map.set(node.id, { ...node, ...withExplicit(node, { x: roundGrid(60 + index * (width + Math.max(24, gap))), y: 62 + depth * 132, width, height: org ? 70 : 62 }) }));
  }
  return map;
}

function rect(id: string, sourceId: string, box: Box, fill: string, stroke: string, z: number, radius = 6, extras: Partial<RectPrimitive> = {}): RectPrimitive {
  return { kind: "rect", id, sourceId, x: box.x, y: box.y, width: box.width, height: box.height, fill, stroke, radius, z, ...extras };
}

function ellipse(id: string, sourceId: string, box: Box, fill: string, stroke: string, z: number, extras: Partial<EllipsePrimitive> = {}): EllipsePrimitive {
  return { kind: "ellipse", id, sourceId, x: box.x, y: box.y, width: box.width, height: box.height, fill, stroke, z, ...extras };
}

function textPrimitive(id: string, sourceId: string, box: Box, value: string, diagram: NormalizedDiagram, z: number, extras: Partial<TextPrimitive> = {}): TextPrimitive {
  return { kind: "text", id, sourceId, x: box.x, y: box.y, width: box.width, height: box.height, text: value, color: diagram.theme.ink, fontFamily: diagram.theme.bodyFont, fontSize: 13, fontWeight: 700, align: "center", z, ...extras };
}

function connector(id: string, sourceId: string, points: Point[], stroke: string, z: number, extras: Partial<ConnectorPrimitive> = {}): ConnectorPrimitive {
  return { kind: "connector", id, sourceId, points, stroke, z, ...extras };
}

function nodeStyle(node: DiagramNode, diagram: NormalizedDiagram): { fill: string; stroke: string; dash?: string } {
  if (node.kind === "focal") return { fill: diagram.theme.accentTint, stroke: diagram.theme.accent };
  if (node.kind === "store") return { fill: diagram.theme.paper2, stroke: diagram.theme.muted };
  if (node.kind === "optional") return { fill: diagram.theme.paper, stroke: diagram.theme.rule, dash: "5 4" };
  if (node.kind === "security") return { fill: diagram.theme.accentTint, stroke: diagram.theme.accent, dash: "4 4" };
  return { fill: diagram.theme.paper2, stroke: diagram.theme.ink };
}

function nodePrimitives(diagram: NormalizedDiagram, nodes: Map<string, DiagramNode & Box>, shape: "rect" | "ellipse" = "rect"): DiagramPrimitive[] {
  return [...nodes.values()].flatMap((node) => {
    const style = nodeStyle(node, diagram);
    const shapePrimitive = shape === "ellipse"
      ? ellipse(node.id, node.id, node, style.fill, style.stroke, 20, { ...(style.dash ? { dash: style.dash } : {}) })
      : rect(node.id, node.id, node, style.fill, style.stroke, 20, node.kind === "actor" ? 3 : 7, { ...(style.dash ? { dash: style.dash } : {}) });
    return [
      shapePrimitive,
      textPrimitive(`${node.id}-text`, node.id, { x: node.x + 10, y: node.y + 22, width: node.width - 20, height: node.height - 28 }, node.label, diagram, 21),
    ];
  });
}

function routedPrimitives(diagram: NormalizedDiagram, edges: ReturnType<typeof routeOrthogonal>): DiagramPrimitive[] {
  return edges.map((item) => connector(item.edge.id, item.edge.id, item.points, item.edge.kind === "accent" ? diagram.theme.accent : item.edge.kind === "link" ? diagram.theme.link : diagram.theme.muted, 10, {
    dashed: ["async", "return", "transit"].includes(item.edge.kind),
    endArrow: true,
    ...(item.edge.label ? { label: item.edge.label, labelPoint: item.labelPoint } : {}),
    bridges: item.bridges,
    sourceObjectId: item.edge.source,
    targetObjectId: item.edge.target,
  }));
}

function groupBackgrounds(diagram: NormalizedDiagram, nodes: Map<string, DiagramNode & Box>): DiagramPrimitive[] {
  return diagram.groups.flatMap((group) => {
    const members = group.nodeIds.map((id) => nodes.get(id)).filter((member): member is DiagramNode & Box => Boolean(member));
    if (!members.length) return [];
    const x = Math.min(...members.map((member) => member.x)) - 22;
    const y = Math.min(...members.map((member) => member.y)) - 32;
    const right = Math.max(...members.map((member) => member.x + member.width)) + 22;
    const bottom = Math.max(...members.map((member) => member.y + member.height)) + 20;
    return [
      rect(`${group.id}-zone`, group.id, { x, y, width: right - x, height: bottom - y }, diagram.theme.paper2, diagram.theme.rule, 1, 10, { opacity: 0.55 }),
      textPrimitive(`${group.id}-label`, group.id, { x: x + 12, y: y + 8, width: right - x - 24, height: 18 }, group.label.toUpperCase(), diagram, 2, { color: diagram.theme.muted, fontFamily: diagram.theme.monoFont, fontSize: 9, fontWeight: 600, align: "left", mono: true }),
    ];
  });
}

function graphLayout(diagram: NormalizedDiagram, metadata: DiagramAdapterMetadata, boxes: Map<string, DiagramNode & Box>, extras: DiagramPrimitive[] = [], showGroups = false, nodeShape: "rect" | "ellipse" = "rect"): DiagramLayout {
  const edges = routeOrthogonal(diagram.edges, boxes);
  return {
    width: VIEW_W,
    height: VIEW_H,
    nodes: boxes,
    edges,
    primitives: [
      ...(showGroups ? groupBackgrounds(diagram, boxes) : []),
      ...extras,
      ...routedPrimitives(diagram, edges),
      ...nodePrimitives(diagram, boxes, nodeShape),
    ].toSorted((left, right) => left.z - right.z || left.id.localeCompare(right.id)),
    adapter: metadata,
  };
}

function preserveEdges(diagram: NormalizedDiagram, nodes: Map<string, DiagramNode & Box>, primitives: DiagramPrimitive[]): { edges: DiagramLayout["edges"]; primitives: DiagramPrimitive[] } {
  const edges = routeOrthogonal(diagram.edges, nodes);
  return {
    edges,
    primitives: [...routedPrimitives(diagram, edges), ...primitives].toSorted((left, right) => left.z - right.z || left.id.localeCompare(right.id)),
  };
}

function createAdapter(type: DiagramType, grammar: string, budget: DiagramAdapterMetadata["budget"], builder: LayoutBuilder, allowNodeOverlap = false): DiagramAdapter {
  const metadata: DiagramAdapterMetadata = { type, family: DIAGRAM_TYPE_FAMILY[type], grammar, budget, ...(allowNodeOverlap ? { allowNodeOverlap: true } : {}) };
  return { metadata, layout: (diagram) => builder(diagram, metadata) };
}

function graphBuilder(mode: "zones" | "columns" | "entities" | "hub" | "flow" | "stages"): LayoutBuilder {
  return (diagram, metadata) => {
    let boxes: Map<string, DiagramNode & Box>;
    if (mode === "hub") boxes = boxMap(diagram, radialBoxes);
    else if (mode === "entities") boxes = boxMap(diagram, gridBoxes);
    else if (mode === "columns") boxes = boxMap(diagram, (_node, index) => ({ x: index % 2 === 0 ? 130 : 650, y: 80 + Math.floor(index / 2) * 118, width: 220, height: 68 }));
    else boxes = boxMap(diagram, horizontalBoxes);
    const extras: DiagramPrimitive[] = mode === "stages" ? [...boxes.values()].map((box, index) => textPrimitive(`${box.id}-stage`, box.id, { x: box.x, y: box.y - 24, width: box.width, height: 16 }, `STAGE ${String(index + 1).padStart(2, "0")}`, diagram, 4, { color: diagram.theme.accent, fontFamily: diagram.theme.monoFont, fontSize: 9, mono: true })) : [];
    return graphLayout(diagram, metadata, boxes, extras, mode === "zones");
  };
}

function medallionBuilder(diagram: NormalizedDiagram, metadata: DiagramAdapterMetadata): DiagramLayout {
  const nodes = new Map<string, DiagramNode & Box>();
  const primitives: DiagramPrimitive[] = [];
  const count = Math.max(1, diagram.nodes.length);
  diagram.nodes.forEach((node, index) => {
    const inset = index * 46;
    const box = withExplicit(node, { x: 120 + inset, y: 56 + inset / 2, width: 760 - inset * 2, height: 448 - inset });
    nodes.set(node.id, { ...node, ...box });
    primitives.push(ellipse(node.id, node.id, box, index % 2 ? diagram.theme.paper2 : diagram.theme.accentTint, index === count - 1 ? diagram.theme.accent : diagram.theme.rule, 2 + index, { opacity: 0.84 }));
    primitives.push(textPrimitive(`${node.id}-text`, node.id, { x: box.x + 20, y: box.y + 18, width: box.width - 40, height: 22 }, node.label, diagram, 20 + index, { fontSize: 12 + index }));
  });
  const preserved = preserveEdges(diagram, nodes, primitives);
  return { width: VIEW_W, height: VIEW_H, nodes, ...preserved, adapter: metadata };
}

function hierarchyBuilder(mode: "nested" | "tree" | "org" | "layers" | "pyramid"): LayoutBuilder {
  return (diagram, metadata) => {
    if (mode === "tree" || mode === "org") return graphLayout(diagram, metadata, treeBoxes(diagram, mode === "org"));
    const nodes = new Map<string, DiagramNode & Box>();
    const primitives: DiagramPrimitive[] = [];
    if (mode === "nested") {
      diagram.nodes.forEach((node, index) => {
        const inset = index * 42;
        const box = withExplicit(node, { x: 90 + inset, y: 50 + inset, width: 820 - inset * 2, height: 460 - inset * 2 });
        nodes.set(node.id, { ...node, ...box });
        primitives.push(rect(node.id, node.id, box, index % 2 ? diagram.theme.paper2 : diagram.theme.paper, index === diagram.nodes.length - 1 ? diagram.theme.accent : diagram.theme.rule, index + 1, 12));
        primitives.push(textPrimitive(`${node.id}-text`, node.id, { x: box.x + 18, y: box.y + 14, width: box.width - 36, height: 20 }, node.label, diagram, 20 + index, { align: "left", color: index === diagram.nodes.length - 1 ? diagram.theme.accent : diagram.theme.muted, fontSize: 11 }));
      });
    } else if (mode === "layers") {
      diagram.nodes.forEach((node, index) => {
        const box = withExplicit(node, { x: 160 + index * 18, y: 74 + index * 88, width: 680 - index * 36, height: 64 });
        nodes.set(node.id, { ...node, ...box });
        primitives.push(rect(node.id, node.id, box, index === diagram.nodes.length - 1 ? diagram.theme.accentTint : diagram.theme.paper2, index === diagram.nodes.length - 1 ? diagram.theme.accent : diagram.theme.rule, 10 + index, 4));
        primitives.push(textPrimitive(`${node.id}-text`, node.id, { x: box.x + 16, y: box.y + 20, width: box.width - 32, height: 24 }, node.label, diagram, 20 + index));
      });
    } else {
      diagram.nodes.forEach((node, index) => {
        const width = 300 + (diagram.nodes.length - index - 1) * 120;
        const box = withExplicit(node, { x: (VIEW_W - width) / 2, y: 430 - index * 82, width, height: 68 });
        nodes.set(node.id, { ...node, ...box });
        primitives.push(rect(node.id, node.id, box, index === diagram.nodes.length - 1 ? diagram.theme.accent : diagram.theme.accentTint, diagram.theme.accent, 10 + index, 2));
        primitives.push(textPrimitive(`${node.id}-text`, node.id, { x: box.x + 20, y: box.y + 21, width: box.width - 40, height: 24 }, node.label, diagram, 20 + index, { color: index === diagram.nodes.length - 1 ? diagram.theme.paper : diagram.theme.ink }));
      });
    }
    const preserved = preserveEdges(diagram, nodes, primitives);
    return { width: VIEW_W, height: VIEW_H, nodes, ...preserved, adapter: metadata };
  };
}

function processBuilder(mode: "flowchart" | "state" | "swimlane" | "process"): LayoutBuilder {
  return (diagram, metadata) => {
    if (mode === "swimlane") {
      const lanes = diagram.groups.length ? diagram.groups : [{ id: "lane", label: "PROCESS", nodeIds: diagram.nodes.map((node) => node.id) }];
      const nodes = new Map<string, DiagramNode & Box>();
      const extras: DiagramPrimitive[] = [];
      lanes.forEach((lane, laneIndex) => {
        const y = 54 + laneIndex * (440 / lanes.length);
        const height = 410 / lanes.length;
        extras.push(rect(`${lane.id}-lane`, lane.id, { x: 70, y, width: 860, height }, laneIndex % 2 ? diagram.theme.paper : diagram.theme.paper2, diagram.theme.rule, 1, 0, { opacity: 0.78 }));
        extras.push(textPrimitive(`${lane.id}-label`, lane.id, { x: 78, y: y + 10, width: 100, height: 18 }, lane.label.toUpperCase(), diagram, 2, { align: "left", fontFamily: diagram.theme.monoFont, fontSize: 9, color: diagram.theme.muted, mono: true }));
        const members = lane.nodeIds.map((id) => diagram.nodes.find((node) => node.id === id)).filter((node): node is DiagramNode => Boolean(node));
        members.forEach((node, index) => nodes.set(node.id, { ...node, ...withExplicit(node, { x: 210 + index * (650 / Math.max(1, members.length)), y: y + height / 2 - 30, width: 140, height: 60 }) }));
      });
      return graphLayout(diagram, metadata, nodes, extras);
    }
    const boxes = boxMap(diagram, mode === "process" || mode === "state" ? horizontalBoxes : mode === "flowchart" ? (_node, index, nodes) => index < 3 ? { x: 420, y: 42 + index * 112, width: 160, height: 68 } : { x: 120 + ((index - 3) * 600) / Math.max(1, nodes.length - 4), y: 414, width: 160, height: 68 } : verticalBoxes);
    const layout = graphLayout(diagram, metadata, boxes, mode === "process" ? [...boxes.values()].map((box, index) => ellipse(`${box.id}-number`, box.id, { x: box.x - 38, y: box.y + 14, width: 28, height: 28 }, diagram.theme.accent, diagram.theme.accent, 22)) : [], mode === "flowchart");
    if (mode === "flowchart") {
      layout.primitives = layout.primitives.map((primitive) => primitive.kind === "rect" && (diagram.nodes.find((node) => node.id === primitive.sourceId)?.kind === "focal" || diagram.nodes.find((node) => node.id === primitive.sourceId)?.kind === "store") ? ellipse(primitive.id, primitive.sourceId, primitive, primitive.fill, primitive.stroke, primitive.z) : primitive);
    }
    return layout;
  };
}

function sequenceBuilder(mode: "sequence" | "timeline"): LayoutBuilder {
  return (diagram, metadata) => {
    const nodes = new Map<string, DiagramNode & Box>();
    const primitives: DiagramPrimitive[] = [];
    if (mode === "sequence") {
      const gap = 760 / Math.max(1, diagram.nodes.length - 1);
      diagram.nodes.forEach((node, index) => {
        const box = withExplicit(node, { x: 80 + index * gap, y: 48, width: 140, height: 50 });
        nodes.set(node.id, { ...node, ...box });
        primitives.push(rect(node.id, node.id, box, diagram.theme.paper2, node.kind === "focal" ? diagram.theme.accent : diagram.theme.ink, 20, 4));
        primitives.push(textPrimitive(`${node.id}-text`, node.id, { x: box.x + 8, y: box.y + 16, width: box.width - 16, height: 20 }, node.label, diagram, 21, { fontSize: 11 }));
        primitives.push(connector(`${node.id}-lifeline`, node.id, [{ x: box.x + box.width / 2, y: box.y + box.height }, { x: box.x + box.width / 2, y: 500 }], diagram.theme.rule, 4, { dashed: true }));
      });
      const routedEdges: DiagramLayout["edges"] = [];
      diagram.edges.forEach((edge, index) => {
        const source = nodes.get(edge.source); const target = nodes.get(edge.target);
        if (!source || !target) return;
        const y = 142 + index * Math.min(52, 310 / Math.max(1, diagram.edges.length));
        const points = [{ x: source.x + source.width / 2, y }, { x: target.x + target.width / 2, y }];
        const labelPoint = { x: (points[0]!.x + points[1]!.x) / 2, y: y - 14 };
        routedEdges.push({ edge, points, path: roundedPath(points), labelPoint, bridges: [] });
        primitives.push(connector(edge.id, edge.id, points, edge.kind === "accent" ? diagram.theme.accent : diagram.theme.muted, 10, { endArrow: true, sourceObjectId: edge.source, targetObjectId: edge.target, ...(edge.label ? { label: edge.label, labelPoint } : {}) }));
      });
      return { width: VIEW_W, height: VIEW_H, nodes, edges: routedEdges, primitives, adapter: metadata };
    }
    primitives.push(connector(`${diagram.id}-axis`, diagram.id, [{ x: 90, y: 280 }, { x: 910, y: 280 }], diagram.theme.ink, 5));
    const gap = 760 / Math.max(1, diagram.nodes.length - 1);
    diagram.nodes.forEach((node, index) => {
      const x = 120 + index * gap;
      const above = index % 2 === 0;
      const box = withExplicit(node, { x: x - 70, y: above ? 130 : 334, width: 140, height: 70 });
      nodes.set(node.id, { ...node, ...box });
      primitives.push(ellipse(`${node.id}-milestone`, node.id, { x: x - 8, y: 272, width: 16, height: 16 }, diagram.theme.accent, diagram.theme.accent, 12));
      primitives.push(connector(`${node.id}-stem`, node.id, [{ x, y: above ? box.y + box.height : 288 }, { x, y: above ? 272 : box.y }], diagram.theme.rule, 8));
      primitives.push(rect(node.id, node.id, box, diagram.theme.paper2, diagram.theme.rule, 20, 5));
      primitives.push(textPrimitive(`${node.id}-text`, node.id, { x: box.x + 8, y: box.y + 20, width: box.width - 16, height: 30 }, node.label, diagram, 21, { fontSize: 11 }));
    });
    const preserved = preserveEdges(diagram, nodes, primitives);
    return { width: VIEW_W, height: VIEW_H, nodes, ...preserved, adapter: metadata };
  };
}

function matrixBuilder(security: boolean): LayoutBuilder {
  return (diagram, metadata) => {
    if (!diagram.data) {
      const boxes = boxMap(diagram, gridBoxes);
      const axes = [
        connector(`${diagram.id}-matrix-x`, diagram.id, [{ x: 70, y: 500 }, { x: 930, y: 500 }], diagram.theme.ink, 2),
        connector(`${diagram.id}-matrix-y`, diagram.id, [{ x: 70, y: 50 }, { x: 70, y: 500 }], diagram.theme.ink, 2),
      ];
      return graphLayout(diagram, metadata, boxes, axes);
    }
    const data = diagram.data;
    const rows = records(data.rows);
    const columns = records(data.columns);
    const cells = records(data.cells);
    const rowCount = Math.max(2, rows.length);
    const columnCount = Math.max(2, columns.length);
    const x0 = security ? 210 : 160;
    const y0 = 100;
    const width = security ? 700 : 680;
    const height = 380;
    const cellW = width / columnCount;
    const cellH = height / rowCount;
    const nodes = new Map<string, DiagramNode & Box>();
    const primitives: DiagramPrimitive[] = [];
    primitives.push(rect(`${diagram.id}-matrix`, diagram.id, { x: x0, y: y0, width, height }, diagram.theme.paper2, diagram.theme.ink, 1, 0));
    for (let column = 1; column < columnCount; column += 1) primitives.push(connector(`${diagram.id}-v-${column}`, diagram.id, [{ x: x0 + column * cellW, y: y0 }, { x: x0 + column * cellW, y: y0 + height }], diagram.theme.rule, 2));
    for (let row = 1; row < rowCount; row += 1) primitives.push(connector(`${diagram.id}-h-${row}`, diagram.id, [{ x: x0, y: y0 + row * cellH }, { x: x0 + width, y: y0 + row * cellH }], diagram.theme.rule, 2));
    columns.forEach((column, index) => primitives.push(textPrimitive(`column-${String(column.id)}-label`, String(column.id), { x: x0 + index * cellW, y: y0 - 30, width: cellW, height: 20 }, String(column.label ?? column.id), diagram, 4, { fontFamily: diagram.theme.monoFont, fontSize: 9, color: diagram.theme.muted, mono: true })));
    rows.forEach((row, index) => primitives.push(textPrimitive(`row-${String(row.id)}-label`, String(row.id), { x: x0 - 120, y: y0 + index * cellH + cellH / 2 - 10, width: 108, height: 20 }, String(row.label ?? row.id), diagram, 4, { align: "right", fontFamily: diagram.theme.monoFont, fontSize: 9, color: diagram.theme.muted, mono: true })));
    cells.forEach((cell, index) => {
      const rowIndex = Math.max(0, rows.findIndex((row) => row.id === cell.rowId));
      const columnIndex = Math.max(0, columns.findIndex((column) => column.id === cell.columnId));
      const id = `cell-${String(cell.rowId)}-${String(cell.columnId)}`;
      const box = { x: x0 + columnIndex * cellW + 6, y: y0 + rowIndex * cellH + 6, width: cellW - 12, height: cellH - 12 };
      const model = diagram.nodes.find((node) => node.id === id) ?? { id, label: String(cell.label ?? cell.value ?? index + 1), kind: "metric" as const };
      nodes.set(id, { ...model, ...box });
      const emphasized = security ? String(cell.value ?? "").toLowerCase().includes("required") : index === 1 || index === 2;
      primitives.push(rect(id, id, box, emphasized ? diagram.theme.accentTint : diagram.theme.paper2, emphasized ? diagram.theme.accent : diagram.theme.rule, 8, security ? 3 : 0));
      primitives.push(textPrimitive(`${id}-text`, id, { x: box.x + 8, y: box.y + box.height / 2 - 12, width: box.width - 16, height: 24 }, model.label, diagram, 9, { fontSize: security ? 10 : 12, color: emphasized ? diagram.theme.accent : diagram.theme.ink }));
    });
    if (!security) {
      primitives.push(textPrimitive(`${diagram.id}-axis-x`, diagram.id, { x: x0 + width - 180, y: y0 + height + 20, width: 180, height: 18 }, "HIGH IMPACT →", diagram, 5, { align: "right", fontFamily: diagram.theme.monoFont, fontSize: 9, color: diagram.theme.muted, mono: true }));
      primitives.push(textPrimitive(`${diagram.id}-axis-y`, diagram.id, { x: x0 - 20, y: y0 - 24, width: 180, height: 18 }, "HIGH CONFIDENCE ↑", diagram, 5, { align: "left", fontFamily: diagram.theme.monoFont, fontSize: 9, color: diagram.theme.muted, mono: true }));
    }
    const preserved = preserveEdges(diagram, nodes, primitives);
    return { width: VIEW_W, height: VIEW_H, nodes, ...preserved, adapter: metadata };
  };
}

function seriesValues(diagram: NormalizedDiagram): { categories: string[]; values: number[] } {
  const data = diagram.data ?? {};
  const categories = records(data.categories).map((item, index) => String(item.label ?? item.id ?? `C${index + 1}`));
  const series = records(data.series);
  const values = Array.isArray(series[0]?.values) ? series[0]!.values.filter((value): value is number => typeof value === "number") : [];
  if (categories.length && values.length) return { categories, values };
  return { categories: diagram.nodes.map((node) => node.label), values: diagram.nodes.map((node, index) => typeof node.data?.value === "number" ? node.data.value : index + 1) };
}

function quantitativeBuilder(mode: "bar" | "line" | "scatter" | "radar"): LayoutBuilder {
  return (diagram, metadata) => {
    const { categories, values } = seriesValues(diagram);
    const max = Math.max(1, ...values.map(Math.abs));
    const nodes = new Map<string, DiagramNode & Box>();
    const primitives: DiagramPrimitive[] = [];
    if (mode === "radar") {
      const center = { x: 500, y: 282 };
      const radius = 190;
      const points = categories.map((category, index) => {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(3, categories.length);
        const axis = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
        const point = { x: center.x + Math.cos(angle) * radius * ((values[index] ?? 0) / max), y: center.y + Math.sin(angle) * radius * ((values[index] ?? 0) / max) };
        primitives.push(connector(`${diagram.id}-axis-${index}`, diagram.id, [center, axis], diagram.theme.rule, 2));
        primitives.push(textPrimitive(`${diagram.id}-label-${index}`, diagram.nodes[index]?.id ?? diagram.id, { x: axis.x - 65, y: axis.y - 10, width: 130, height: 20 }, category, diagram, 5, { fontSize: 10 }));
        const pointId = diagram.nodes[index]?.id ?? `${diagram.id}-point-${index}`;
        primitives.push(ellipse(pointId, pointId, { x: point.x - 5, y: point.y - 5, width: 10, height: 10 }, diagram.theme.accent, diagram.theme.accent, 12));
        const model = diagram.nodes[index];
        if (model) nodes.set(model.id, { ...model, x: point.x - 5, y: point.y - 5, width: 10, height: 10 });
        return point;
      });
      if (points.length > 1) primitives.push(connector(`${diagram.id}-radar-series`, diagram.id, [...points, points[0]!], diagram.theme.accent, 10, { strokeWidth: 2 }));
      const preserved = preserveEdges(diagram, nodes, primitives);
      return { width: VIEW_W, height: VIEW_H, nodes, ...preserved, adapter: metadata };
    }
    const chart = { x: 110, y: 70, width: 800, height: 410 };
    primitives.push(connector(`${diagram.id}-axis-x`, diagram.id, [{ x: chart.x, y: chart.y + chart.height }, { x: chart.x + chart.width, y: chart.y + chart.height }], diagram.theme.ink, 2));
    primitives.push(connector(`${diagram.id}-axis-y`, diagram.id, [{ x: chart.x, y: chart.y }, { x: chart.x, y: chart.y + chart.height }], diagram.theme.ink, 2));
    const step = chart.width / Math.max(1, categories.length);
    const points: Point[] = [];
    categories.forEach((category, index) => {
      const value = values[index] ?? 0;
      const x = chart.x + step * index + step / 2;
      const y = chart.y + chart.height - (value / max) * (chart.height - 44);
      const model = diagram.nodes[index] ?? { id: `category-${index + 1}`, label: category, kind: "metric" as const };
      if (mode === "bar") {
        const box = { x: x - step * 0.28, y, width: step * 0.56, height: chart.y + chart.height - y };
        nodes.set(model.id, { ...model, ...box });
        primitives.push(rect(model.id, model.id, box, index === values.length - 1 ? diagram.theme.accent : diagram.theme.link, "none", 10, 2, { opacity: index === values.length - 1 ? 1 : 0.72 }));
        primitives.push(textPrimitive(`${model.id}-value`, model.id, { x: box.x, y: box.y - 24, width: box.width, height: 20 }, String(value), diagram, 12, { fontFamily: diagram.theme.monoFont, fontSize: 10, color: index === values.length - 1 ? diagram.theme.accent : diagram.theme.muted, mono: true }));
      } else {
        const jitterX = mode === "scatter" ? ((index % 3) - 1) * 18 : 0;
        const point = { x: x + jitterX, y };
        points.push(point);
        const box = { x: point.x - 6, y: point.y - 6, width: 12, height: 12 };
        nodes.set(model.id, { ...model, ...box });
        primitives.push(ellipse(model.id, model.id, box, mode === "scatter" ? diagram.theme.link : diagram.theme.accent, diagram.theme.paper, 12, { strokeWidth: 2 }));
      }
      primitives.push(textPrimitive(`${model.id}-label`, model.id, { x: x - step / 2, y: chart.y + chart.height + 16, width: step, height: 20 }, category, diagram, 5, { fontSize: 9, color: diagram.theme.muted }));
    });
    if (mode === "line" && points.length > 1) primitives.push(connector(`${diagram.id}-series`, diagram.id, points, diagram.theme.accent, 10, { strokeWidth: 2 }));
    const preserved = preserveEdges(diagram, nodes, primitives);
    return { width: VIEW_W, height: VIEW_H, nodes, ...preserved, adapter: metadata };
  };
}

function setBuilder(mode: "venn" | "loop"): LayoutBuilder {
  return (diagram, metadata) => {
    const nodes = new Map<string, DiagramNode & Box>();
    const primitives: DiagramPrimitive[] = [];
    if (mode === "venn") {
      const positions = [{ x: 270, y: 130 }, { x: 450, y: 130 }, { x: 360, y: 280 }];
      diagram.nodes.slice(0, 3).forEach((node, index) => {
        const position = positions[index] ?? positions[0]!;
        const box = withExplicit(node, { ...position, width: 280, height: 220 });
        nodes.set(node.id, { ...node, ...box });
        primitives.push(ellipse(node.id, node.id, box, index === 0 ? diagram.theme.accentTint : index === 1 ? diagram.theme.paper2 : diagram.theme.paper, index === 0 ? diagram.theme.accent : diagram.theme.link, 10 + index, { opacity: 0.72 }));
        primitives.push(textPrimitive(`${node.id}-text`, node.id, { x: box.x + 40, y: box.y + 36, width: box.width - 80, height: 24 }, node.label, diagram, 20 + index));
      });
      const preserved = preserveEdges(diagram, nodes, primitives);
      return { width: VIEW_W, height: VIEW_H, nodes, ...preserved, adapter: metadata };
    }
    const boxes = boxMap(diagram, (_node, index, nodes) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(1, nodes.length);
      return { x: roundGrid(500 + Math.cos(angle) * 300 - 70), y: roundGrid(280 + Math.sin(angle) * 185 - 34), width: 140, height: 68 };
    });
    const loopEdges: DiagramEdge[] = diagram.edges.length ? diagram.edges : diagram.nodes.map((node, index) => ({ id: `loop-${index + 1}`, source: node.id, target: diagram.nodes[(index + 1) % Math.max(1, diagram.nodes.length)]?.id ?? node.id, kind: index === diagram.nodes.length - 1 ? "accent" : "default" }));
    const loopDiagram = { ...diagram, edges: loopEdges };
    return graphLayout(loopDiagram, metadata, boxes);
  };
}

function ganttBuilder(diagram: NormalizedDiagram, metadata: DiagramAdapterMetadata): DiagramLayout {
  const tasks = diagram.nodes;
  const starts = tasks.map((node) => typeof node.data?.startMs === "number" ? node.data.startMs : 0);
  const ends = tasks.map((node, index) => typeof node.data?.endMs === "number" ? node.data.endMs : index + 1);
  const min = Math.min(0, ...starts);
  const max = Math.max(1, ...ends);
  const x0 = 230;
  const chartWidth = 680;
  const rowHeight = Math.min(64, 400 / Math.max(1, tasks.length));
  const nodes = new Map<string, DiagramNode & Box>();
  const primitives: DiagramPrimitive[] = [];
  for (let tick = 0; tick <= 4; tick += 1) {
    const x = x0 + (chartWidth * tick) / 4;
    primitives.push(connector(`${diagram.id}-tick-${tick}`, diagram.id, [{ x, y: 76 }, { x, y: 500 }], diagram.theme.rule, 1));
    primitives.push(textPrimitive(`${diagram.id}-tick-label-${tick}`, diagram.id, { x: x - 30, y: 48, width: 60, height: 18 }, String(Math.round(min + ((max - min) * tick) / 4)), diagram, 2, { fontFamily: diagram.theme.monoFont, fontSize: 9, color: diagram.theme.muted, mono: true }));
  }
  tasks.forEach((node, index) => {
    const start = starts[index] ?? 0;
    const end = ends[index] ?? start + 1;
    const box = withExplicit(node, { x: x0 + ((start - min) / (max - min)) * chartWidth, y: 92 + index * rowHeight, width: Math.max(12, ((end - start) / (max - min)) * chartWidth), height: Math.max(24, rowHeight - 18) });
    nodes.set(node.id, { ...node, ...box });
    primitives.push(textPrimitive(`${node.id}-label`, node.id, { x: 68, y: box.y + 5, width: 145, height: 22 }, node.label, diagram, 5, { align: "right", fontSize: 10 }));
    primitives.push(rect(node.id, node.id, box, index === tasks.length - 1 ? diagram.theme.accent : diagram.theme.link, "none", 10, 3, { opacity: index === tasks.length - 1 ? 1 : 0.72 }));
  });
  const preserved = preserveEdges(diagram, nodes, primitives);
  return { width: VIEW_W, height: VIEW_H, nodes, ...preserved, adapter: metadata };
}

export const DIAGRAM_ADAPTERS = {
  architecture: createAdapter("architecture", "architecture-zones", { items: 12, connections: 16 }, graphBuilder("zones")),
  "it-state": createAdapter("it-state", "current-target-columns", { items: 10, connections: 14 }, graphBuilder("columns")),
  er: createAdapter("er", "entity-relationship", { items: 10, connections: 14 }, graphBuilder("entities")),
  "high-level": createAdapter("high-level", "hub-and-spoke", { items: 8, connections: 10 }, graphBuilder("hub")),
  medallion: createAdapter("medallion", "concentric-medallion", { items: 6, connections: 4 }, medallionBuilder, true),
  "data-flow": createAdapter("data-flow", "source-transform-store", { items: 10, connections: 14 }, graphBuilder("flow")),
  "dp-integration": createAdapter("dp-integration", "integration-stages", { items: 9, connections: 12 }, graphBuilder("stages")),
  nested: createAdapter("nested", "nested-boundaries", { items: 6, connections: 4 }, hierarchyBuilder("nested"), true),
  tree: createAdapter("tree", "branching-tree", { items: 12, connections: 14 }, hierarchyBuilder("tree")),
  "org-chart": createAdapter("org-chart", "organization-levels", { items: 14, connections: 14 }, hierarchyBuilder("org")),
  layers: createAdapter("layers", "stacked-layers", { items: 7, connections: 6 }, hierarchyBuilder("layers")),
  pyramid: createAdapter("pyramid", "pyramid-tiers", { items: 6, connections: 5 }, hierarchyBuilder("pyramid")),
  flowchart: createAdapter("flowchart", "flowchart-terminals", { items: 12, connections: 16 }, processBuilder("flowchart")),
  state: createAdapter("state", "state-machine", { items: 10, connections: 16 }, processBuilder("state")),
  swimlane: createAdapter("swimlane", "swimlane-process", { items: 12, connections: 16 }, processBuilder("swimlane")),
  process: createAdapter("process", "numbered-process", { items: 9, connections: 10 }, processBuilder("process")),
  sequence: createAdapter("sequence", "sequence-lifelines", { items: 8, connections: 14 }, sequenceBuilder("sequence")),
  timeline: createAdapter("timeline", "timeline-milestones", { items: 10, connections: 9 }, sequenceBuilder("timeline")),
  quadrant: createAdapter("quadrant", "impact-confidence-quadrant", { items: 12, connections: 8 }, matrixBuilder(false)),
  "dp-security-matrix": createAdapter("dp-security-matrix", "security-control-matrix", { items: 24, connections: 12 }, matrixBuilder(true)),
  bar: createAdapter("bar", "categorical-bars", { items: 12, connections: 6 }, quantitativeBuilder("bar")),
  line: createAdapter("line", "series-line", { items: 16, connections: 15 }, quantitativeBuilder("line")),
  scatter: createAdapter("scatter", "scatter-field", { items: 20, connections: 6 }, quantitativeBuilder("scatter")),
  radar: createAdapter("radar", "radar-spokes", { items: 10, connections: 10 }, quantitativeBuilder("radar")),
  venn: createAdapter("venn", "venn-sets", { items: 3, connections: 4 }, setBuilder("venn"), true),
  loop: createAdapter("loop", "feedback-loop", { items: 8, connections: 8 }, setBuilder("loop")),
  gantt: createAdapter("gantt", "gantt-schedule", { items: 14, connections: 8 }, ganttBuilder),
} as const satisfies Record<DiagramType, DiagramAdapter>;

export function adapterForType(type: DiagramType): DiagramAdapter {
  return DIAGRAM_ADAPTERS[type];
}

export function layoutWithAdapter(diagram: NormalizedDiagram): DiagramLayout {
  return adapterForType(diagram.type).layout(diagram);
}

export function primitiveConnectorPath(primitive: ConnectorPrimitive): string {
  return roundedPath(primitive.points);
}
