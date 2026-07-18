import {
  migrateDiagramV1ToV2,
  parseDiagramSpec,
  type DiagramEdge,
  type DiagramFamily,
  type DiagramNode,
  type DiagramSpecAny,
  type DiagramSpecV2,
  type DiagramTheme,
  type DiagramType,
} from "@slides-studio/protocol";

export interface NormalizedDiagram {
  original: DiagramSpecAny;
  v2: DiagramSpecV2;
  id: string;
  type: DiagramType;
  family: DiagramFamily;
  variant: DiagramSpecV2["variant"];
  direction: DiagramSpecV2["direction"];
  theme: DiagramTheme;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: Array<{ id: string; label: string; nodeIds: string[] }>;
  annotations: Array<{ id: string; targetId: string; text: string }>;
  legend?: { title: string; items: Array<{ label: string; kind: string }> };
  data?: Record<string, unknown>;
}

const records = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
const text = (value: unknown, fallback: string) => typeof value === "string" && value.length > 0 ? value : fallback;
const optionalText = (value: unknown) => typeof value === "string" && value.length > 0 ? value : undefined;

function node(id: string, label: string, kind: DiagramNode["kind"] = "step", data?: Record<string, unknown>): DiagramNode {
  return { id, label, kind, ...(data ? { data } : {}) };
}

function edge(id: string, source: string, target: string, label?: string, kind: DiagramEdge["kind"] = "default"): DiagramEdge {
  return { id, source, target, kind, ...(label ? { label: label.slice(0, 24) } : {}) };
}

function fromFamilyData(v2: DiagramSpecV2): { nodes: DiagramNode[]; edges: DiagramEdge[]; groups: NormalizedDiagram["groups"] } {
  const data = v2.data as Record<string, unknown>;
  if (v2.family === "graph-topology") {
    const nodes = records(data.nodes).map((item) => node(text(item.id, "node"), text(item.label, text(item.id, "Node")), (item.kind as DiagramNode["kind"] | undefined) ?? "step", { zoneId: item.zoneId }));
    const edges = records(data.connections).map((item) => edge(text(item.id, "connection"), text(item.source, ""), text(item.target, ""), optionalText(item.label), item.kind === "accent" || item.kind === "link" || item.kind === "async" || item.kind === "return" || item.kind === "transit" ? item.kind : "default"));
    const zones = records(data.zones);
    const groups = zones.map((zone) => ({ id: text(zone.id, "zone"), label: text(zone.label, text(zone.id, "Zone")), nodeIds: nodes.filter((candidate) => candidate.data?.zoneId === zone.id).map((candidate) => candidate.id) }));
    return { nodes, edges, groups };
  }
  if (v2.family === "hierarchy") {
    const nodes = records(data.items).map((item, index) => node(text(item.id, `item-${index + 1}`), text(item.label, text(item.id, `Item ${index + 1}`)), index === 0 ? "focal" : "step"));
    const edges = records(data.parents).map((item, index) => edge(`parent-${index + 1}-${text(item.id, "item")}`, text(item.parentId, ""), text(item.id, "")));
    return { nodes, edges, groups: [] };
  }
  if (v2.family === "process-state") {
    const terminalIds = new Set(Array.isArray(data.terminalIds) ? data.terminalIds.filter((id): id is string => typeof id === "string") : []);
    const startId = optionalText(data.startId);
    const nodes = records(data.steps).map((item, index) => {
      const id = text(item.id, `step-${index + 1}`);
      const kind: DiagramNode["kind"] = id === startId ? "focal" : terminalIds.has(id) ? "store" : "step";
      return node(id, text(item.label, id), kind, { laneId: item.laneId });
    });
    const edges = records(data.transitions).map((item, index) => edge(text(item.id, `transition-${index + 1}`), text(item.source, ""), text(item.target, ""), optionalText(item.label), item.kind === "accent" || item.kind === "async" || item.kind === "return" ? item.kind : "default"));
    const groups = records(data.lanes).map((lane) => ({ id: text(lane.id, "lane"), label: text(lane.label, text(lane.id, "Lane")), nodeIds: nodes.filter((candidate) => candidate.data?.laneId === lane.id).map((candidate) => candidate.id) }));
    return { nodes, edges, groups };
  }
  if (v2.family === "sequence-time") {
    const nodes = records(data.actors).map((item, index) => node(text(item.id, `actor-${index + 1}`), text(item.label, text(item.id, `Actor ${index + 1}`)), "actor"));
    const edges = records(data.events).map((item, index) => edge(text(item.id, `event-${index + 1}`), text(item.from, ""), text(item.to, text(item.from, "")), optionalText(item.label), "default"));
    return { nodes, edges, groups: [] };
  }
  if (v2.family === "matrix") {
    const rows = records(data.rows);
    const columns = records(data.columns);
    const nodes = records(data.cells).map((item, index) => {
      const rowId = text(item.rowId, `row-${index + 1}`);
      const columnId = text(item.columnId, `column-${index + 1}`);
      return node(`cell-${rowId}-${columnId}`, text(item.label, item.value === undefined ? `${rowId} × ${columnId}` : String(item.value)), "metric", { rowId, columnId });
    });
    const groups = [
      ...rows.map((item) => ({ id: `row-${text(item.id, "row")}`, label: text(item.label, text(item.id, "Row")), nodeIds: nodes.filter((candidate) => candidate.data?.rowId === item.id).map((candidate) => candidate.id) })),
      ...columns.map((item) => ({ id: `column-${text(item.id, "column")}`, label: text(item.label, text(item.id, "Column")), nodeIds: nodes.filter((candidate) => candidate.data?.columnId === item.id).map((candidate) => candidate.id) })),
    ];
    return { nodes, edges: [], groups };
  }
  if (v2.family === "quantitative-series") {
    const nodes = records(data.categories).map((item, index) => node(text(item.id, `category-${index + 1}`), text(item.label, text(item.id, `Category ${index + 1}`)), "metric", { index }));
    return { nodes, edges: [], groups: [] };
  }
  if (v2.family === "set-radial") {
    const nodes = records(data.sets).map((item, index) => node(text(item.id, `set-${index + 1}`), text(item.label, text(item.id, `Set ${index + 1}`)), index === 0 ? "focal" : "step"));
    return { nodes, edges: [], groups: [] };
  }
  const nodes = records(data.tasks).map((item, index) => node(text(item.id, `task-${index + 1}`), text(item.label, text(item.id, `Task ${index + 1}`)), "step", { startMs: item.startMs, endMs: item.endMs }));
  return { nodes, edges: [], groups: [] };
}

export function normalizeDiagram(input: unknown): NormalizedDiagram {
  const original = parseDiagramSpec(input);
  const v2 = original.schemaVersion === 1 ? migrateDiagramV1ToV2(original) : original;
  if (v2.legacyGraph) {
    return {
      original,
      v2,
      id: v2.id,
      type: v2.type,
      family: v2.family,
      variant: v2.variant,
      direction: v2.direction,
      theme: v2.theme,
      nodes: v2.legacyGraph.nodes,
      edges: v2.legacyGraph.edges,
      groups: v2.legacyGraph.groups ?? [],
      annotations: v2.legacyGraph.annotations ?? [],
      ...(v2.legacyGraph.legend ? { legend: v2.legacyGraph.legend } : {}),
    };
  }
  const converted = fromFamilyData(v2);
  return {
    original,
    v2,
    id: v2.id,
    type: v2.type,
    family: v2.family,
    variant: v2.variant,
    direction: v2.direction,
    theme: v2.theme,
    nodes: converted.nodes,
    edges: converted.edges,
    groups: converted.groups,
    annotations: [],
    data: v2.data as Record<string, unknown>,
  };
}
