import type { DiagramSpecAny } from "@slides-studio/protocol";
import { adapterForType, DIAGRAM_ADAPTERS, layoutWithAdapter, primitiveConnectorPath } from "./adapters.js";
import { createAllDiagramFixtures, createDiagramFixture, DIAGRAM_TYPES } from "./fixtures.js";
import { normalizeDiagram } from "./normalize.js";
import type {
  Box,
  ConnectorPrimitive,
  DiagramIssue,
  DiagramLayout,
  DiagramPrimitive,
  EllipsePrimitive,
  Point,
  RectPrimitive,
  TextPrimitive,
} from "./primitives.js";
import { intersectsBox } from "./routing.js";

export type {
  Box,
  ConnectorPrimitive,
  DiagramAdapterMetadata,
  DiagramIssue,
  DiagramLayout,
  DiagramPrimitive,
  EllipsePrimitive,
  Point,
  RectPrimitive,
  RoutedEdge,
  TextPrimitive,
} from "./primitives.js";
export type { DiagramAdapter } from "./adapters.js";
export { adapterForType, createAllDiagramFixtures, createDiagramFixture, DIAGRAM_ADAPTERS, DIAGRAM_TYPES };

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");
const overlaps = (left: Box, right: Box) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
const optionalAttr = (name: string, value: string | number | undefined) => value === undefined ? "" : ` ${name}="${escapeXml(String(value))}"`;

export function layoutDiagram(input: DiagramSpecAny | unknown): DiagramLayout {
  return layoutWithAdapter(normalizeDiagram(input));
}

export function validateDiagram(input: DiagramSpecAny | unknown): DiagramIssue[] {
  let diagram: ReturnType<typeof normalizeDiagram>;
  try {
    diagram = normalizeDiagram(input);
  } catch (error) {
    const candidate = error as { issues?: Array<{ path: PropertyKey[]; message: string }> };
    if (candidate.issues) return candidate.issues.map((issue) => ({ severity: "error", code: "schema", target: issue.path.join("."), message: issue.message }));
    return [{ severity: "error", code: "schema", message: error instanceof Error ? error.message : String(error) }];
  }
  const issues: DiagramIssue[] = [];
  const ids = new Set<string>();
  for (const item of [...diagram.nodes, ...diagram.edges]) {
    if (ids.has(item.id)) issues.push({ severity: "error", code: "duplicate-id", target: item.id, message: "IDs must be unique across nodes and edges." });
    ids.add(item.id);
  }
  const nodeIds = new Set(diagram.nodes.map((node) => node.id));
  for (const edge of diagram.edges) if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) issues.push({ severity: "error", code: "missing-endpoint", target: edge.id, message: "Edge endpoint does not exist." });
  const adapter = adapterForType(diagram.type);
  if (diagram.nodes.length > adapter.metadata.budget.items) issues.push({ severity: "error", code: "complexity", message: `${diagram.type} exceeds its ${adapter.metadata.budget.items}-item presentation budget; split overview and detail.` });
  if (diagram.edges.length > adapter.metadata.budget.connections) issues.push({ severity: "error", code: "complexity", message: `${diagram.type} exceeds its ${adapter.metadata.budget.connections}-connection presentation budget.` });
  if (diagram.nodes.filter((node) => node.kind === "focal").length > 2) issues.push({ severity: "error", code: "focal-count", message: "Use at most two focal nodes." });
  if (issues.some((issue) => issue.code === "missing-endpoint")) return issues;
  const layout = layoutWithAdapter(diagram);
  const boxes = [...layout.nodes.values()];
  if (!layout.adapter.allowNodeOverlap) {
    boxes.forEach((box, index) => boxes.slice(index + 1).forEach((other) => {
      if (overlaps(box, other)) issues.push({ severity: "error", code: "node-overlap", target: `${box.id},${other.id}`, message: "Node boxes overlap." });
    }));
  }
  for (const { edge, points } of layout.edges) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index]!;
      const end = points[index + 1]!;
      if (start.x !== end.x && start.y !== end.y) issues.push({ severity: "error", code: "diagonal-connector", target: edge.id, message: "Off-axis routed connectors must be orthogonal." });
      if (!layout.adapter.allowNodeOverlap) {
        for (const box of boxes) {
          if (box.id !== edge.source && box.id !== edge.target && intersectsBox(start, end, box) && edge.kind !== "transit") issues.push({ severity: "error", code: "connector-obstacle", target: edge.id, message: `Connector crosses ${box.id}.` });
        }
      }
    }
  }
  for (const primitive of layout.primitives) {
    if (primitive.kind === "connector") continue;
    if (primitive.x < -1 || primitive.y < -1 || primitive.x + primitive.width > layout.width + 1 || primitive.y + primitive.height > layout.height + 1) {
      issues.push({ severity: "warning", code: "primitive-bounds", target: primitive.id, message: "Primitive extends beyond the diagram viewBox." });
    }
  }
  return issues;
}

function renderRect(primitive: RectPrimitive): string {
  return `<rect data-object-id="${escapeXml(primitive.id)}" data-source-id="${escapeXml(primitive.sourceId)}" x="${primitive.x}" y="${primitive.y}" width="${primitive.width}" height="${primitive.height}" rx="${primitive.radius}" fill="${escapeXml(primitive.fill)}" stroke="${escapeXml(primitive.stroke)}"${optionalAttr("stroke-width", primitive.strokeWidth)}${optionalAttr("stroke-dasharray", primitive.dash)}${optionalAttr("opacity", primitive.opacity)}/>`;
}

function renderEllipse(primitive: EllipsePrimitive): string {
  return `<ellipse data-object-id="${escapeXml(primitive.id)}" data-source-id="${escapeXml(primitive.sourceId)}" cx="${primitive.x + primitive.width / 2}" cy="${primitive.y + primitive.height / 2}" rx="${primitive.width / 2}" ry="${primitive.height / 2}" fill="${escapeXml(primitive.fill)}" stroke="${escapeXml(primitive.stroke)}"${optionalAttr("stroke-width", primitive.strokeWidth)}${optionalAttr("stroke-dasharray", primitive.dash)}${optionalAttr("opacity", primitive.opacity)}/>`;
}

function renderText(primitive: TextPrimitive): string {
  const anchor = primitive.align === "left" ? "start" : primitive.align === "right" ? "end" : "middle";
  const x = primitive.align === "left" ? primitive.x : primitive.align === "right" ? primitive.x + primitive.width : primitive.x + primitive.width / 2;
  const y = primitive.y + Math.max(primitive.fontSize, (primitive.height + primitive.fontSize) / 2 - 2);
  return `<text data-object-id="${escapeXml(primitive.id)}" data-source-id="${escapeXml(primitive.sourceId)}" x="${x}" y="${y}" text-anchor="${anchor}" font-family="${escapeXml(primitive.fontFamily)}" font-size="${primitive.fontSize}" font-weight="${primitive.fontWeight ?? 400}" fill="${escapeXml(primitive.color)}">${escapeXml(primitive.text)}</text>`;
}

function renderConnector(primitive: ConnectorPrimitive, paper: string, markerIds: { normal: string; accent: string; link: string }, accent: string, link: string): string {
  const marker = primitive.stroke === accent ? markerIds.accent : primitive.stroke === link ? markerIds.link : markerIds.normal;
  const path = `<path data-connector="true"${primitive.sourceObjectId ? ` data-connector-source="${escapeXml(primitive.sourceObjectId)}"` : ""}${primitive.targetObjectId ? ` data-connector-target="${escapeXml(primitive.targetObjectId)}"` : ""} d="${primitiveConnectorPath(primitive)}" fill="none" stroke="${escapeXml(primitive.stroke)}" stroke-width="${primitive.strokeWidth ?? 1.5}"${primitive.dashed ? ' stroke-dasharray="5 4"' : ""}${primitive.endArrow ? ` marker-end="url(#${marker})"` : ""}/>`;
  const bridges = (primitive.bridges ?? []).map((point, index) => `<circle data-bridge="true" data-object-id="${escapeXml(primitive.id)}-bridge-${index + 1}" cx="${point.x}" cy="${point.y}" r="5" fill="${escapeXml(paper)}" stroke="${escapeXml(primitive.stroke)}" stroke-width="1.5"/>`).join("");
  let label = "";
  if (primitive.label && primitive.labelPoint) {
    const width = Math.max(46, Math.min(150, primitive.label.length * 6 + 18));
    label = `<g data-object-id="${escapeXml(primitive.id)}-label" data-source-id="${escapeXml(primitive.sourceId)}"><rect data-label-mask="true" x="${primitive.labelPoint.x - width / 2}" y="${primitive.labelPoint.y - 12}" width="${width}" height="18" rx="3" fill="${escapeXml(paper)}"/><text x="${primitive.labelPoint.x}" y="${primitive.labelPoint.y + 1}" text-anchor="middle" font-family="monospace" font-size="9" fill="${escapeXml(primitive.stroke)}">${escapeXml(primitive.label)}</text></g>`;
  }
  return `<g data-object-id="${escapeXml(primitive.id)}" data-source-id="${escapeXml(primitive.sourceId)}">${path}${bridges}${label}</g>`;
}

function renderPrimitive(primitive: DiagramPrimitive, paper: string, markerIds: { normal: string; accent: string; link: string }, accent: string, link: string): string {
  if (primitive.kind === "rect") return renderRect(primitive);
  if (primitive.kind === "ellipse") return renderEllipse(primitive);
  if (primitive.kind === "text") return renderText(primitive);
  return renderConnector(primitive, paper, markerIds, accent, link);
}

export function renderDiagramSvg(input: DiagramSpecAny | unknown): string {
  const diagram = normalizeDiagram(input);
  const issues = validateDiagram(diagram.original).filter((issue) => issue.severity === "error");
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
  const layout = layoutWithAdapter(diagram);
  const base = safeId(diagram.id);
  const markerIds = { normal: `arrow-${base}`, accent: `arrow-accent-${base}`, link: `arrow-link-${base}` };
  const definitions = `<defs><marker id="${markerIds.normal}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0 0L8 3L0 6Z" fill="${diagram.theme.muted}"/></marker><marker id="${markerIds.accent}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0 0L8 3L0 6Z" fill="${diagram.theme.accent}"/></marker><marker id="${markerIds.link}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0 0L8 3L0 6Z" fill="${diagram.theme.link}"/></marker></defs>`;
  const primitives = layout.primitives.toSorted((left, right) => left.z - right.z || left.id.localeCompare(right.id)).map((primitive) => renderPrimitive(primitive, diagram.theme.paper, markerIds, diagram.theme.accent, diagram.theme.link)).join("");
  const legend = diagram.legend ? `<g data-object-id="${escapeXml(diagram.id)}-legend"><line x1="40" y1="510" x2="960" y2="510" stroke="${diagram.theme.rule}"/><text x="40" y="532" font-family="${escapeXml(diagram.theme.monoFont)}" font-size="9" fill="${diagram.theme.muted}">${escapeXml(diagram.legend.title.toUpperCase())}</text>${diagram.legend.items.map((item, index) => `<text x="${160 + index * 160}" y="532" font-family="${escapeXml(diagram.theme.bodyFont)}" font-size="10" fill="${diagram.theme.muted}">${escapeXml(item.label)}</text>`).join("")}</g>` : "";
  return `<svg data-diagram-id="${escapeXml(diagram.id)}" data-diagram-type="${diagram.type}" data-diagram-family="${diagram.family}" data-diagram-grammar="${layout.adapter.grammar}" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(diagram.type)} diagram">${definitions}<rect width="${layout.width}" height="${layout.height}" fill="${diagram.theme.paper}"/>${primitives}${legend}</svg>`;
}
