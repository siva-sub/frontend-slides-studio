import {
  DIAGRAM_TYPE_FAMILY,
  diagramSpecV2Schema,
  diagramTypeSchema,
  type DiagramSpecV2,
  type DiagramType,
} from "@slides-studio/protocol";

export const DIAGRAM_TYPES = [...diagramTypeSchema.options] as DiagramType[];

function graphData(type: DiagramType): Record<string, unknown> {
  if (type === "architecture") return {
    layout: "dagre",
    zones: [{ id: "experience", label: "Experience" }, { id: "platform", label: "Platform" }, { id: "data", label: "Data" }],
    nodes: [
      { id: "studio", label: "Studio", kind: "focal", zoneId: "experience" },
      { id: "runtime", label: "Runtime", zoneId: "platform" },
      { id: "export", label: "Export service", zoneId: "platform" },
      { id: "assets", label: "Asset store", kind: "store", zoneId: "data" },
    ],
    connections: [
      { id: "a1", source: "studio", target: "runtime", label: "postMessage", kind: "link" },
      { id: "a2", source: "runtime", target: "export", label: "settle" },
      { id: "a3", source: "export", target: "assets", label: "evidence", kind: "accent" },
    ],
  };
  if (type === "it-state") return {
    zones: [{ id: "current", label: "Current" }, { id: "target", label: "Target" }],
    nodes: [
      { id: "legacy-ui", label: "Legacy UI", zoneId: "current" }, { id: "manual-export", label: "Manual export", zoneId: "current" },
      { id: "studio-ui", label: "Studio", kind: "focal", zoneId: "target" }, { id: "gated-export", label: "Gated export", zoneId: "target" },
    ],
    connections: [{ id: "i1", source: "legacy-ui", target: "studio-ui", label: "modernize", kind: "accent" }, { id: "i2", source: "manual-export", target: "gated-export", label: "automate", kind: "accent" }],
  };
  if (type === "er") return {
    nodes: [{ id: "deck", label: "Deck", kind: "focal" }, { id: "slide", label: "Slide" }, { id: "object", label: "Object" }, { id: "asset", label: "Asset", kind: "store" }],
    zones: [],
    connections: [{ id: "er1", source: "deck", target: "slide", label: "1:N" }, { id: "er2", source: "slide", target: "object", label: "1:N" }, { id: "er3", source: "object", target: "asset", label: "0:1" }],
  };
  if (type === "high-level") return {
    nodes: [{ id: "north-star", label: "Trusted story", kind: "focal" }, { id: "author", label: "Author" }, { id: "review", label: "Review" }, { id: "share", label: "Share" }, { id: "learn", label: "Learn" }],
    zones: [],
    connections: ["author", "review", "share", "learn"].map((target, index) => ({ id: `h${index + 1}`, source: "north-star", target })),
  };
  if (type === "medallion") return {
    nodes: [{ id: "bronze", label: "Bronze · raw" }, { id: "silver", label: "Silver · shaped" }, { id: "gold", label: "Gold · trusted", kind: "focal" }], zones: [], connections: [],
  };
  if (type === "data-flow") return {
    nodes: [{ id: "source", label: "Sources", kind: "input" }, { id: "ingest", label: "Ingest" }, { id: "shape", label: "Transform" }, { id: "warehouse", label: "Warehouse", kind: "store" }, { id: "insight", label: "Insight", kind: "focal" }],
    zones: [],
    connections: [{ id: "d1", source: "source", target: "ingest" }, { id: "d2", source: "ingest", target: "shape", kind: "async" }, { id: "d3", source: "shape", target: "warehouse" }, { id: "d4", source: "warehouse", target: "insight", kind: "accent" }],
  };
  return {
    nodes: [{ id: "product", label: "Product", kind: "input" }, { id: "contract", label: "Contract" }, { id: "adapter", label: "Adapter", kind: "focal" }, { id: "partner", label: "Partner", kind: "external" }], zones: [],
    connections: [{ id: "p1", source: "product", target: "contract", label: "intent" }, { id: "p2", source: "contract", target: "adapter", label: "validate" }, { id: "p3", source: "adapter", target: "partner", label: "deliver", kind: "link" }],
  };
}

function hierarchyData(type: DiagramType): Record<string, unknown> {
  if (type === "nested") return { rootId: "ecosystem", orientation: "vertical", items: [{ id: "ecosystem", label: "Ecosystem" }, { id: "platform", label: "Platform" }, { id: "product", label: "Product" }, { id: "feature", label: "Feature" }], parents: [{ id: "platform", parentId: "ecosystem" }, { id: "product", parentId: "platform" }, { id: "feature", parentId: "product" }] };
  if (type === "tree") return { rootId: "strategy", orientation: "vertical", items: [{ id: "strategy", label: "Strategy" }, { id: "growth", label: "Growth" }, { id: "trust", label: "Trust" }, { id: "acquire", label: "Acquire" }, { id: "retain", label: "Retain" }, { id: "quality", label: "Quality" }], parents: [{ id: "growth", parentId: "strategy" }, { id: "trust", parentId: "strategy" }, { id: "acquire", parentId: "growth" }, { id: "retain", parentId: "growth" }, { id: "quality", parentId: "trust" }] };
  if (type === "org-chart") return { rootId: "ceo", orientation: "vertical", items: [{ id: "ceo", label: "CEO" }, { id: "product", label: "Product" }, { id: "technology", label: "Technology" }, { id: "operations", label: "Operations" }, { id: "design", label: "Design" }, { id: "platform", label: "Platform" }], parents: [{ id: "product", parentId: "ceo" }, { id: "technology", parentId: "ceo" }, { id: "operations", parentId: "ceo" }, { id: "design", parentId: "product" }, { id: "platform", parentId: "technology" }] };
  if (type === "layers") return { orientation: "vertical", items: [{ id: "foundation", label: "Foundation" }, { id: "data", label: "Data" }, { id: "services", label: "Services" }, { id: "experience", label: "Experience" }], parents: [{ id: "data", parentId: "foundation" }, { id: "services", parentId: "data" }, { id: "experience", parentId: "services" }] };
  return { orientation: "vertical", items: [{ id: "foundation", label: "Operational foundation" }, { id: "growth", label: "Repeatable growth" }, { id: "scale", label: "Category leadership" }], parents: [{ id: "growth", parentId: "foundation" }, { id: "scale", parentId: "growth" }] };
}

function processData(type: DiagramType): Record<string, unknown> {
  if (type === "flowchart") return { startId: "start", terminalIds: ["ship"], orientation: "vertical", steps: [{ id: "start", label: "Start" }, { id: "frame", label: "Frame problem" }, { id: "decide", label: "Evidence enough?" }, { id: "refine", label: "Refine" }, { id: "ship", label: "Ship" }], transitions: [{ id: "f1", source: "start", target: "frame" }, { id: "f2", source: "frame", target: "decide" }, { id: "f3", source: "decide", target: "ship", label: "yes", kind: "accent" }, { id: "f4", source: "decide", target: "refine", label: "no" }, { id: "f5", source: "refine", target: "frame", label: "retry", kind: "return" }], lanes: [] };
  if (type === "state") return { startId: "idle", terminalIds: ["complete"], orientation: "horizontal", steps: [{ id: "idle", label: "Idle" }, { id: "editing", label: "Editing" }, { id: "review", label: "Review" }, { id: "complete", label: "Complete" }], transitions: [{ id: "s1", source: "idle", target: "editing", label: "open" }, { id: "s2", source: "editing", target: "review", label: "submit" }, { id: "s3", source: "review", target: "editing", label: "revise", kind: "return" }, { id: "s4", source: "review", target: "complete", label: "approve", kind: "accent" }], lanes: [] };
  if (type === "swimlane") return { startId: "brief", terminalIds: ["release"], orientation: "horizontal", lanes: [{ id: "product", label: "Product" }, { id: "engineering", label: "Engineering" }, { id: "quality", label: "Quality" }], steps: [{ id: "brief", label: "Brief", laneId: "product" }, { id: "build", label: "Build", laneId: "engineering" }, { id: "verify", label: "Verify", laneId: "quality" }, { id: "release", label: "Release", laneId: "product" }], transitions: [{ id: "w1", source: "brief", target: "build" }, { id: "w2", source: "build", target: "verify" }, { id: "w3", source: "verify", target: "release", kind: "accent" }] };
  return { startId: "discover", terminalIds: ["learn"], orientation: "horizontal", lanes: [], steps: [{ id: "discover", label: "Discover" }, { id: "design", label: "Design" }, { id: "deliver", label: "Deliver" }, { id: "learn", label: "Learn" }], transitions: [{ id: "pr1", source: "discover", target: "design" }, { id: "pr2", source: "design", target: "deliver" }, { id: "pr3", source: "deliver", target: "learn", kind: "accent" }] };
}

function sequenceData(type: DiagramType): Record<string, unknown> {
  if (type === "sequence") return { actors: [{ id: "author", label: "Author" }, { id: "studio", label: "Studio" }, { id: "service", label: "Export service" }, { id: "review", label: "Reviewer" }], events: [{ id: "q1", from: "author", to: "studio", label: "edit" }, { id: "q2", from: "studio", to: "service", label: "submit" }, { id: "q3", from: "service", to: "studio", label: "evidence" }, { id: "q4", from: "studio", to: "review", label: "review" }], timeAxis: "vertical" };
  return { actors: [{ id: "discover", label: "Discover" }, { id: "prototype", label: "Prototype" }, { id: "pilot", label: "Pilot" }, { id: "scale", label: "Scale" }], events: [], timeAxis: "horizontal", timeDomain: { startMs: 0, endMs: 400 } };
}

function matrixData(type: DiagramType): Record<string, unknown> {
  if (type === "quadrant") return { rows: [{ id: "low-confidence", label: "Lower confidence" }, { id: "high-confidence", label: "Higher confidence" }], columns: [{ id: "low-impact", label: "Lower impact" }, { id: "high-impact", label: "Higher impact" }], cells: [{ rowId: "low-confidence", columnId: "low-impact", label: "Monitor" }, { rowId: "low-confidence", columnId: "high-impact", label: "Experiment" }, { rowId: "high-confidence", columnId: "low-impact", label: "Maintain" }, { rowId: "high-confidence", columnId: "high-impact", label: "Prioritize" }] };
  return { rows: [{ id: "identity", label: "Identity" }, { id: "data", label: "Data" }, { id: "runtime", label: "Runtime" }], columns: [{ id: "prevent", label: "Prevent" }, { id: "detect", label: "Detect" }, { id: "respond", label: "Respond" }], cells: [
    { rowId: "identity", columnId: "prevent", value: "Required · MFA" }, { rowId: "identity", columnId: "detect", value: "Monitor sign-ins" }, { rowId: "identity", columnId: "respond", value: "Revoke" },
    { rowId: "data", columnId: "prevent", value: "Required · encrypt" }, { rowId: "data", columnId: "detect", value: "DLP" }, { rowId: "data", columnId: "respond", value: "Quarantine" },
    { rowId: "runtime", columnId: "prevent", value: "Sandbox" }, { rowId: "runtime", columnId: "detect", value: "Telemetry" }, { rowId: "runtime", columnId: "respond", value: "Isolate" },
  ] };
}

function quantitativeData(type: DiagramType): Record<string, unknown> {
  const labels = type === "radar" ? ["Clarity", "Trust", "Speed", "Editability", "Motion"] : ["Q1", "Q2", "Q3", "Q4", "Q5"];
  const values = type === "scatter" ? [22, 68, 38, 86, 57] : type === "line" ? [18, 35, 52, 70, 91] : type === "radar" ? [84, 76, 92, 68, 81] : [24, 41, 56, 72, 95];
  return { categories: labels.map((label, index) => ({ id: `c${index + 1}`, label })), series: [{ id: "primary", label: type === "bar" ? "Revenue" : "Score", values }], domain: { min: 0, max: 100 }, valueAxis: "linear" };
}

function setData(type: DiagramType): Record<string, unknown> {
  if (type === "venn") return { sets: [{ id: "desirable", label: "Desirable" }, { id: "viable", label: "Viable" }, { id: "feasible", label: "Feasible" }], segments: [{ id: "fit", setIds: ["desirable", "viable", "feasible"], label: "Product fit" }] };
  return { sets: [{ id: "observe", label: "Observe" }, { id: "orient", label: "Orient" }, { id: "decide", label: "Decide" }, { id: "act", label: "Act" }], segments: [{ id: "cycle", setIds: ["observe", "orient", "decide", "act"], label: "Learning loop" }] };
}

function scheduleData(): Record<string, unknown> {
  return { tasks: [{ id: "research", label: "Research", startMs: 0, endMs: 30 }, { id: "design", label: "Design", startMs: 20, endMs: 55 }, { id: "build", label: "Build", startMs: 45, endMs: 85 }, { id: "verify", label: "Verify", startMs: 78, endMs: 100 }], domain: { startMs: 0, endMs: 100 }, timeAxis: "horizontal" };
}

export function createDiagramFixture(type: DiagramType): DiagramSpecV2 {
  const family = DIAGRAM_TYPE_FAMILY[type];
  const data = family === "graph-topology" ? graphData(type)
    : family === "hierarchy" ? hierarchyData(type)
      : family === "process-state" ? processData(type)
        : family === "sequence-time" ? sequenceData(type)
          : family === "matrix" ? matrixData(type)
            : family === "quantitative-series" ? quantitativeData(type)
              : family === "set-radial" ? setData(type)
                : scheduleData();
  return diagramSpecV2Schema.parse({ schemaVersion: 2, family, id: `fixture-${type}`, type, variant: "editorial", direction: type === "flowchart" || type === "state" ? "ttb" : "ltr", data });
}

export function createAllDiagramFixtures(): DiagramSpecV2[] {
  return DIAGRAM_TYPES.map(createDiagramFixture);
}
