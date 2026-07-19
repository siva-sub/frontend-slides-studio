import { describe, expect, it } from "vitest";
import {
  deckGoalSchema,
  diagramSpecSchema,
  diagramSpecV2Schema,
  diagramTypeSchema,
  diagramFamilyForType,
  DIAGRAM_TYPE_FAMILY,
  exportJobSchema,
  migrateDiagramV1ToV2,
  motionIntentSchema,
  motionProgramSchema,
  parseDiagramSpec,
  parsePresentationSessionMessage,
  parseStudioMessage,
  presentationSessionMessageSchema,
  presentationStateSchema,
  assetManifestSchema,
  assetPlanSchema,
  assetJobSchema,
  assetProviderSchema,
  assetEvidenceSchema,
  assetReviewSchema,
  mediaAssetSchema,
  mediaPlacementSchema,
  intentionalOverlapSchema,
  normalizedRectSchema,
  qualityReportSchema,
  qualityIssueCategorySchema,
  styleProfileSchema,
  layoutProfileSchema,
  recipeSchema,
  layoutSlotSchema,
  transitionSpecSchema,
  transitionKindSchema,
  transitionEasingSchema,
  safeRelativePathSchema,
  contentHashSchema,
  providerCapabilitySchema,
  fidelityDecisionSchema,
  graphTopologyTypeSchema,
  processStateTypeSchema,
  setRadialTypeSchema,
} from "../src/index.js";

const SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const diagramV1 = {
  schemaVersion: 1 as const,
  id: "d",
  type: "architecture" as const,
  nodes: [{ id: "n1", label: "Node 1" }, { id: "n2", label: "Node 2" }],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

describe("protocol contracts", () => {
  it("accepts an HTML deck with stable IDs", () => {
    const deck = deckGoalSchema.parse({ schemaVersion: 1, id: "demo", title: "Demo", slides: [{ id: "s1", role: "cover", renderMode: "html" }] });
    expect(deck.slides[0]?.id).toBe("s1");
  });

  it("requires visual metadata for visual-master slides", () => {
    expect(() => deckGoalSchema.parse({ schemaVersion: 1, id: "demo", title: "Demo", slides: [{ id: "s1", role: "cover", renderMode: "visual-master" }] })).toThrow(/visualMaster/);
  });

  it("rejects duplicate-grid coordinates and unknown iframe messages through schemas", () => {
    expect(() => diagramSpecSchema.parse({ schemaVersion: 1, id: "d", type: "architecture", theme: {}, nodes: [{ id: "n", label: "Node", x: 3 }], edges: [] })).toThrow();
    expect(() => parseStudioMessage({ type: "unknown", protocolVersion: 1 })).toThrow();
  });

  it("preserves legacy DeckGoalV1 parsing (no transition fields required)", () => {
    const deck = deckGoalSchema.parse({ schemaVersion: 1, id: "demo", title: "Demo", slides: [{ id: "s1", role: "cover" }] });
    expect(deck.defaultTransition).toBeUndefined();
    expect(deck.slides[0]?.transition).toBeUndefined();
  });

  it("preserves legacy DiagramSpecV1 parsing unchanged", () => {
    const parsed = diagramSpecSchema.parse(diagramV1);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.type).toBe("architecture");
    expect(parsed.nodes).toHaveLength(2);
    // migration must not be required to read V1.
    expect(parsed.edges[0]?.source).toBe("n1");
  });

  it("keeps StudioMessage and ExportJob parsing intact", () => {
    expect(parseStudioMessage({ type: "studio:ready", protocolVersion: 1 }).type).toBe("studio:ready");
    expect(parseStudioMessage({ type: "studio:quality-request", protocolVersion: 1, requestId: "q1", slideIndex: 0 }).type).toBe("studio:quality-request");
    expect(parseStudioMessage({ type: "studio:quality-report", protocolVersion: 1, requestId: "q1", report: { schemaVersion: 1, id: "q1", canvas: { width: 1280, height: 720 }, passed: true } }).type).toBe("studio:quality-report");
    const job = exportJobSchema.parse({ id: "j", format: "pdf", status: "queued", progress: 0 });
    expect(job.format).toBe("pdf");
  });

  it("accepts a V1 diagram inside a slide goal additively", () => {
    const deck = deckGoalSchema.parse({
      schemaVersion: 1, id: "demo", title: "Demo",
      slides: [{ id: "s1", role: "diagram", diagram: diagramV1 }],
    });
    expect(deck.slides[0]?.diagram?.schemaVersion).toBe(1);
  });

  it("accepts a V2 diagram inside a slide goal additively", () => {
    const v2 = migrateDiagramV1ToV2(diagramSpecSchema.parse(diagramV1));
    const deck = deckGoalSchema.parse({
      schemaVersion: 1, id: "demo", title: "Demo",
      slides: [{ id: "s1", role: "diagram", diagram: v2 }],
    });
    expect(deck.slides[0]?.diagram?.schemaVersion).toBe(2);
  });
});

describe("presentation sessions", () => {
  const envelope = { namespace: "slides-studio-presentation" as const, protocolVersion: 1 as const, sessionId: "session-1", deckId: "deck-1", revision: SHA256, seq: 3, senderRole: "presenter" as const, senderId: "presenter-1", sentAt: 1000 };
  const state = { slideIndex: 1, slideId: "slide-02", slideCount: 3, status: "running" as const, timer: { running: true, elapsedMs: 2000, anchorEpochMs: 1000 } };

  it("accepts typed notes-free state, navigation, timer, and lifecycle messages", () => {
    expect(parsePresentationSessionMessage({ ...envelope, type: "presentation:state", state, reason: "navigation" }).type).toBe("presentation:state");
    expect(presentationSessionMessageSchema.parse({ ...envelope, type: "presentation:navigation", slideIndex: 2, slideId: "slide-03", slideCount: 3 }).type).toBe("presentation:navigation");
    expect(presentationSessionMessageSchema.parse({ ...envelope, type: "presentation:timer", status: "paused", timer: { running: false, elapsedMs: 3000, anchorEpochMs: null }, action: "pause" }).type).toBe("presentation:timer");
    expect(presentationSessionMessageSchema.parse({ ...envelope, type: "presentation:heartbeat", currentSlideIndex: 1 }).type).toBe("presentation:heartbeat");
    expect(presentationSessionMessageSchema.parse({ ...envelope, type: "presentation:goodbye", reason: "closed" }).type).toBe("presentation:goodbye");
  });

  it("rejects invalid identities, slide bounds, and inconsistent timer anchors", () => {
    expect(() => parsePresentationSessionMessage({ ...envelope, revision: "not-a-hash", type: "presentation:hello", wantsState: true })).toThrow();
    expect(() => parsePresentationSessionMessage({ ...envelope, type: "presentation:navigation", slideIndex: 3, slideId: "slide-04", slideCount: 3 })).toThrow(/slideIndex/);
    expect(() => presentationStateSchema.parse({ ...state, timer: { running: true, elapsedMs: 0, anchorEpochMs: null } })).toThrow(/anchor/);
    expect(() => presentationStateSchema.parse({ ...state, timer: { running: false, elapsedMs: 0, anchorEpochMs: 1000 } })).toThrow(/paused/);
  });

  it("does not define a notes field on shared messages", () => {
    const parsed = parsePresentationSessionMessage({ ...envelope, type: "presentation:state", state, reason: "initial", notes: "private" });
    expect("notes" in parsed).toBe(false);
  });
});

describe("transitions", () => {
  it("accepts optional deck-level defaultTransition and slide-level transition", () => {
    const deck = deckGoalSchema.parse({
      schemaVersion: 1,
      id: "d",
      title: "T",
      defaultTransition: { kind: "crossfade" },
      slides: [{ id: "s1", role: "cover", transition: { kind: "pixel-grid", durationMs: 800 } }],
    });
    expect(deck.defaultTransition?.kind).toBe("crossfade");
    expect(deck.defaultTransition?.durationMs).toBe(400); // default applied
    expect(deck.defaultTransition?.schemaVersion).toBe(1); // explicitly versioned
    expect(deck.slides[0]?.transition?.kind).toBe("pixel-grid");
    expect(deck.slides[0]?.transition?.durationMs).toBe(800);
    expect(deck.slides[0]?.transition?.schemaVersion).toBe(1);
  });

  it("exposes all ten transition kinds", () => {
    expect(transitionKindSchema.options).toEqual([
      "none", "crossfade", "slide", "zoom", "circle-reveal",
      "clip-wipe", "pixel-grid", "pixel-bars", "slice-vertical", "slice-horizontal",
    ]);
  });

  it("rejects out-of-bounds duration, fraction, and arbitrary easing", () => {
    expect(() => transitionSpecSchema.parse({ kind: "crossfade", durationMs: 99999 })).toThrow();
    expect(() => transitionSpecSchema.parse({ kind: "crossfade", targetEntranceStartFraction: 2 })).toThrow();
    expect(() => transitionSpecSchema.parse({ kind: "crossfade", easing: "bogus" })).toThrow();
    expect(() => transitionSpecSchema.parse({ kind: "nope" })).toThrow();
  });

  it("accepts bounded cubic-bezier easing, direction, and reduced-motion behavior", () => {
    const t = transitionSpecSchema.parse({
      kind: "circle-reveal",
      easing: "cubic-bezier(0.42, 0, 0.58, 1)",
      direction: "clockwise",
      targetEntranceStartFraction: 0.5,
      reducedMotion: "skip",
    });
    expect(t.reducedMotion).toBe("skip");
    expect(t.direction).toBe("clockwise");
  });

  it("rejects malformed cubic-bezier controls", () => {
    // wrong control count
    expect(() => transitionEasingSchema.parse("cubic-bezier(0.42, 0, 0.58)")).toThrow();
    expect(() => transitionEasingSchema.parse("cubic-bezier(0.42, 0, 0.58, 1, 2)")).toThrow();
    // non-numeric controls
    expect(() => transitionEasingSchema.parse("cubic-bezier(foo, 0, 0.5, 1)")).toThrow();
    // x1 / x2 out of [0,1]
    expect(() => transitionEasingSchema.parse("cubic-bezier(1.2, 0, 0.5, 1)")).toThrow();
    expect(() => transitionEasingSchema.parse("cubic-bezier(0.5, 0, -0.1, 1)")).toThrow();
    // y values outside [0,1] are intentionally allowed (CSS permits overshoot)
    expect(() => transitionEasingSchema.parse("cubic-bezier(0.5, -0.5, 0.5, 1.5)")).not.toThrow();
  });

  it("rejects non-CSS-number cubic-bezier tokens (empty, hex, Infinity, NaN)", () => {
    // empty control slots (Number("") would coerce to 0 without the token guard)
    expect(() => transitionEasingSchema.parse("cubic-bezier(, 0, 0.5, 1)")).toThrow();
    expect(() => transitionEasingSchema.parse("cubic-bezier(0.5,  , 0.5, 1)")).toThrow();
    // hex (Number("0x10") === 16 without the token guard)
    expect(() => transitionEasingSchema.parse("cubic-bezier(0x10, 0, 0.5, 1)")).toThrow();
    // bare identifiers Infinity / NaN
    expect(() => transitionEasingSchema.parse("cubic-bezier(Infinity, 0, 0.5, 1)")).toThrow();
    expect(() => transitionEasingSchema.parse("cubic-bezier(0.5, NaN, 0.5, 1)")).toThrow();
    // whitespace-only token
    expect(() => transitionEasingSchema.parse("cubic-bezier(0.5, 0, 0.5,   )")).toThrow();
    // exponent overflow to Infinity is rejected even though it is a valid token
    expect(() => transitionEasingSchema.parse("cubic-bezier(1e400, 0, 0.5, 1)")).toThrow();
    // a valid decimal + exponent token is accepted
    expect(() => transitionEasingSchema.parse("cubic-bezier(0.5e0, 0, 5e-1, 1)")).not.toThrow();
  });
});

describe("motion presets and replay", () => {
  it("accepts the new blur/wipe/rotate/pulse/stagger presets and rejects unknown effects", () => {
    for (const effect of ["blur", "wipe", "rotate", "pulse", "stagger"] as const) {
      const mi = motionIntentSchema.parse({ schemaVersion: 1, mappings: [{ objectId: "o", effect, startMs: 0, durationMs: 200 }] });
      expect(mi.mappings[0]?.effect).toBe(effect);
    }
    expect(() => motionIntentSchema.parse({ schemaVersion: 1, mappings: [{ objectId: "o", effect: "teleport", startMs: 0, durationMs: 1 }] })).toThrow();
  });

  it("formalizes replay always|once|never while retaining arbitrary keyframes", () => {
    const mp = motionProgramSchema.parse({
      schemaVersion: 1,
      replay: "once",
      tracks: [{ objectId: "o", keyframes: [{ opacity: 0, transform: "scale(0.5)" }, { opacity: 1, transform: "scale(1)" }], options: { duration: 400 } }],
    });
    expect(mp.replay).toBe("once");
    expect(mp.tracks[0]?.keyframes).toHaveLength(2);
    expect(() => motionProgramSchema.parse({ schemaVersion: 1, replay: "sometimes", tracks: [] })).toThrow();
  });
});

describe("DiagramSpecV2 migration and families", () => {
  it("migrates V1 to V2 deterministically, losslessly into legacyGraph", () => {
    const v1 = diagramSpecSchema.parse(diagramV1);
    const a = migrateDiagramV1ToV2(v1);
    const b = migrateDiagramV1ToV2(v1);
    expect(a.schemaVersion).toBe(2);
    expect(a.family).toBe("graph-topology");
    expect(a.type).toBe("architecture");
    expect(a.legacyGraph.nodes).toHaveLength(2);
    expect(a.legacyGraph.edges[0]?.source).toBe("n1");
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("preserves all 27 diagram type names and maps each to a family", () => {
    const types = diagramTypeSchema.options as readonly string[];
    expect(types).toHaveLength(27);
    for (const type of types) {
      const family = diagramFamilyForType(type as never);
      expect(family, `family for ${type}`).toBeTruthy();
      const migrated = migrateDiagramV1ToV2(diagramSpecSchema.parse({ schemaVersion: 1, id: "d", type, nodes: [], edges: [] }));
      expect(migrated.type).toBe(type);
      expect(migrated.schemaVersion).toBe(2);
    }
    // The family map is exhaustive over the type union (compile-time Record guard).
    expect(Object.keys(DIAGRAM_TYPE_FAMILY)).toHaveLength(27);
  });

  it("uses the corrected family/type mapping for the three previously-misassigned types", () => {
    expect(diagramFamilyForType("it-state")).toBe("graph-topology");
    expect(diagramFamilyForType("flowchart")).toBe("process-state");
    expect(diagramFamilyForType("loop")).toBe("set-radial");
    // sanity: graph-topology branch accepts it-state; process-state accepts flowchart.
    expect(graphTopologyTypeSchema.options).toContain("it-state");
    expect(processStateTypeSchema.options).toContain("flowchart");
    expect(setRadialTypeSchema.options).toContain("loop");
  });

  it("parseDiagramSpec accepts both V1 and V2", () => {
    expect(parseDiagramSpec(diagramV1).schemaVersion).toBe(1);
    const v2 = migrateDiagramV1ToV2(diagramSpecSchema.parse(diagramV1));
    expect(parseDiagramSpec(v2).schemaVersion).toBe(2);
  });

  it("parses a representative family-data payload for every V2 family", () => {
    const base = (family: string, type: string, data: Record<string, unknown>) => ({
      schemaVersion: 2, family, id: "d", type, data,
    });
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["graph-topology", "architecture", { nodes: [{ id: "n1" }], zones: [{ id: "z1" }], connections: [{ id: "c1", source: "n1", target: "n1" }] }],
      ["hierarchy", "org-chart", { rootId: "ceo", items: [{ id: "ceo" }], parents: [{ id: "ceo", parentId: "board" }] }],
      ["process-state", "flowchart", { startId: "s", steps: [{ id: "s" }], transitions: [{ id: "t", source: "s", target: "e" }], lanes: [{ id: "l1" }] }],
      ["sequence-time", "sequence", { actors: [{ id: "a" }, { id: "b" }], events: [{ id: "e", from: "a", to: "b" }] }],
      ["matrix", "quadrant", { rows: [{ id: "r" }], columns: [{ id: "c" }], cells: [{ rowId: "r", columnId: "c" }] }],
      ["quantitative-series", "bar", { categories: [{ id: "c1" }], series: [{ id: "s1", values: [1, 2, 3] }] }],
      ["set-radial", "venn", { sets: [{ id: "set-a", label: "A" }], segments: [{ id: "seg", setIds: ["set-a"] }] }],
      ["schedule", "gantt", { tasks: [{ id: "t1", startMs: 0, endMs: 100 }], domain: { startMs: 0, endMs: 100 } }],
    ];
    for (const [family, type, data] of cases) {
      const parsed = diagramSpecV2Schema.parse(base(family, type, data));
      expect(parsed.family).toBe(family);
      expect(parsed.type).toBe(type);
      expect(parsed.data).toBeDefined();
    }
  });

  it("rejects an unknown V2 family discriminator", () => {
    expect(() => diagramSpecV2Schema.parse({ schemaVersion: 2, family: "nope", id: "d", type: "bar", data: {} })).toThrow();
  });

  it("rejects a V2 spec with neither family data nor legacyGraph", () => {
    expect(() => diagramSpecV2Schema.parse({ schemaVersion: 2, family: "schedule", id: "d", type: "gantt" })).toThrow(/data or legacyGraph/);
  });

  it("enforces a true XOR: rejects a V2 spec that carries BOTH data and legacyGraph", () => {
    const v1 = diagramSpecSchema.parse(diagramV1);
    const legacy = migrateDiagramV1ToV2(v1).legacyGraph;
    expect(() => diagramSpecV2Schema.parse({
      schemaVersion: 2, family: "graph-topology", id: "d", type: "architecture",
      data: { nodes: [{ id: "n1" }] }, legacyGraph: legacy,
    })).toThrow(/data or legacyGraph/);
  });

  it("rejects a family/type mismatch at runtime", () => {
    // flowchart now belongs to process-state, not graph-topology.
    expect(() => diagramSpecV2Schema.parse({ schemaVersion: 2, family: "graph-topology", id: "d", type: "flowchart", data: {} })).toThrow();
    // loop now belongs to set-radial, not process-state.
    expect(() => diagramSpecV2Schema.parse({ schemaVersion: 2, family: "process-state", id: "d", type: "loop", data: {} })).toThrow();
  });

  it("validates schedule task intervals (endMs must exceed startMs)", () => {
    expect(() => diagramSpecV2Schema.parse({
      schemaVersion: 2, family: "schedule", id: "d", type: "gantt",
      data: { tasks: [{ id: "t1", startMs: 100, endMs: 50 }] },
    })).toThrow(/endMs/);
    const ok = diagramSpecV2Schema.parse({
      schemaVersion: 2, family: "schedule", id: "d", type: "gantt",
      data: { tasks: [{ id: "t1", startMs: 0, endMs: 100 }] },
    });
    expect(ok.data?.tasks).toHaveLength(1);
  });
});

describe("safe relative paths and content hashes", () => {
  it("rejects unsafe relative paths", () => {
    for (const bad of ["/abs", "../up", "ok/../../x", "~/home", "C:\\win", "", "a/./b", "a//b", "a/b/", "win\\path", "a\u0000b", "C:drive"]) {
      expect(() => safeRelativePathSchema.parse(bad), `path: ${JSON.stringify(bad)}`).toThrow();
    }
  });

  it("accepts canonical POSIX relative paths", () => {
    for (const good of ["assets/foo.png", "deck/media/x.jpg", "a/b/c/d.svg"]) {
      expect(safeRelativePathSchema.parse(good)).toBe(good);
    }
  });

  it("restricts content hashes to sha256 with exactly 64 hex chars", () => {
    expect(contentHashSchema.parse({ algorithm: "sha256", value: SHA256 }).algorithm).toBe("sha256");
    expect(() => contentHashSchema.parse({ algorithm: "sha1", value: "x" })).toThrow();
    expect(() => contentHashSchema.parse({ algorithm: "sha256", value: "abc" })).toThrow();
    expect(() => contentHashSchema.parse({ algorithm: "sha256", value: "g".repeat(64) })).toThrow();
  });
});

describe("normalized rects and crops", () => {
  it("requires positive width/height", () => {
    expect(() => normalizedRectSchema.parse({ x: 0, y: 0, width: 0, height: 1 })).toThrow();
    expect(() => normalizedRectSchema.parse({ x: 0, y: 0, width: 1, height: 0 })).toThrow();
  });

  it("rejects rects that overflow the unit box", () => {
    expect(() => normalizedRectSchema.parse({ x: 0.5, y: 0.5, width: 0.6, height: 0.1 })).toThrow();
    expect(() => normalizedRectSchema.parse({ x: 0.5, y: 0.5, width: 0.1, height: 0.6 })).toThrow();
  });

  it("accepts a rect that fits exactly within the unit box", () => {
    expect(normalizedRectSchema.parse({ x: 0, y: 0, width: 1, height: 1 }).width).toBe(1);
  });
});

describe("provider, capability, evidence, and review contracts", () => {
  it("models non-secret provider id/model/quality/capabilities with no ref or url", () => {
    const provider = assetProviderSchema.parse({ id: "openai", model: "gpt-image-1", quality: "high", capabilities: ["ordinary-generation", "masked-edit"] });
    expect(provider.capabilities).toContain("masked-edit");
    // arbitrary ref / token / url fields are not part of the schema.
    expect(() => assetProviderSchema.parse({ name: "x", ref: "secret" })).toThrow();
  });

  it("exposes the four approved capabilities", () => {
    expect(providerCapabilitySchema.options).toEqual(["ordinary-generation", "ordered-references", "masked-edit", "visual-review"]);
  });

  it("treats evidence references as safe artifact paths (no url field)", () => {
    expect(assetEvidenceSchema.parse({ kind: "prompt", path: "proof/prompt.txt" }).path).toBe("proof/prompt.txt");
    // `url` is not a modelled field; an unknown `url` key is stripped and never stored.
    const stripped = assetEvidenceSchema.parse({ kind: "prompt", url: "https://evil/x" });
    expect(stripped).not.toHaveProperty("url");
    // an unsafe path value (credential-bearing URL / non-POSIX) is rejected.
    expect(() => assetEvidenceSchema.parse({ kind: "prompt", path: "https://evil/x" })).toThrow();
  });

  it("requires reviewer and evidence for approved reviews", () => {
    expect(() => assetReviewSchema.parse({ status: "approved" })).toThrow(/reviewer and evidence/);
    expect(assetReviewSchema.parse({ status: "approved", reviewer: "r", evidence: ["proof/log.txt"] }).reviewer).toBe("r");
  });

  it("rejects whitespace-only reviewer/evidence for approved reviews", () => {
    expect(() => assetReviewSchema.parse({ status: "approved", reviewer: "   ", evidence: ["proof/log.txt"] })).toThrow(/reviewer and evidence/);
    expect(() => assetReviewSchema.parse({ status: "approved", reviewer: "\t", evidence: ["proof/log.txt"] })).toThrow(/reviewer and evidence/);
  });

  it("models fidelity decisions with reasons", () => {
    expect(fidelityDecisionSchema.parse({ id: "d1", kind: "A1", reason: "logo fidelity critical" }).kind).toBe("A1");
    expect(() => fidelityDecisionSchema.parse({ id: "d1", kind: "A1" })).toThrow();
  });
});

describe("media contracts: assets, placements, overlaps", () => {
  it("accepts a fully-specified media asset with provider/evidence/review", () => {
    const asset = mediaAssetSchema.parse({
      schemaVersion: 1, id: "a", path: "assets/foo.png", hash: { algorithm: "sha256", value: SHA256 }, mimeType: "image/png",
      provider: { id: "openai", capabilities: ["ordinary-generation"] },
      evidence: [{ kind: "prompt", note: "n" }],
      review: { status: "approved", reviewer: "r", evidence: ["proof/log.txt"] },
    });
    expect(asset.path).toBe("assets/foo.png");
    expect(asset.hash.value).toHaveLength(64);
  });

  it("supports crop/focal/pan/zoom/negative-rotation/alt and overlap declarations", () => {
    const placement = mediaPlacementSchema.parse({
      schemaVersion: 1, id: "p1", sourcePath: "assets/foo.png", sourceHash: { algorithm: "sha256", value: SHA256 },
      assetId: "a", slideId: "s1", layoutSlot: "hero", fit: "cover",
      crop: { x: 0, y: 0, width: 1, height: 1 }, focal: { x: 0.5, y: 0.5 }, pan: { x: 10, y: -5 },
      zoom: 1.5, rotation: -45, z: 2, alt: "hero image",
      overlaps: [{ group: "bg-stack", with: ["p2", "p3"], reason: "layered background" }],
    });
    expect(placement.layoutSlot).toBe("hero");
    expect(placement.fit).toBe("cover");
    expect(placement.rotation).toBe(-45);
    expect(placement.overlaps[0]?.with).toEqual(["p2", "p3"]);
  });

  it("requires source path, hash, and layout slot on placements", () => {
    expect(() => mediaPlacementSchema.parse({ schemaVersion: 1, id: "p1", assetId: "a" })).toThrow();
  });

  it("requires nonempty group/with/reason on overlap declarations", () => {
    expect(() => intentionalOverlapSchema.parse({ group: "", with: ["p2"], reason: "r" })).toThrow();
    expect(() => intentionalOverlapSchema.parse({ group: "g", with: [], reason: "r" })).toThrow();
    expect(() => intentionalOverlapSchema.parse({ group: "g", with: ["p2"], reason: "" })).toThrow();
  });
});

describe("asset plan / job / manifest lifecycle", () => {
  const placement = {
    schemaVersion: 1, id: "p1", sourcePath: "assets/x.png", sourceHash: { algorithm: "sha256", value: SHA256 },
    assetId: "a", layoutSlot: "hero", overlaps: [],
  };

  it("parses a reproducible asset plan with stages/capabilities/protected regions/hashes", () => {
    const plan = assetPlanSchema.parse({
      schemaVersion: 1, id: "plan1", slideId: "s1", styleId: "sp", layoutId: "lp",
      operation: "generate", stages: ["draft", "refine"], capabilities: ["masked-edit"],
      prompt: "hero", promptHash: { algorithm: "sha256", value: SHA256 },
      referenceHashes: [{ algorithm: "sha256", value: SHA256 }],
      protectedRegions: [{ x: 0, y: 0, width: 0.2, height: 0.2 }],
      alternativeRegions: [{ x: 0.8, y: 0.8, width: 0.2, height: 0.2 }],
      placements: [placement],
      provider: { id: "openai", capabilities: ["ordinary-generation"] },
    });
    expect(plan.stages).toEqual(["draft", "refine"]);
    expect(plan.protectedRegions[0]?.width).toBe(0.2);
  });

  it("parses a job across the full lifecycle with stage/output/model", () => {
    const job = assetJobSchema.parse({
      schemaVersion: 1, id: "job1", planId: "plan1", status: "complete", stage: "refine", progress: 1,
      output: { assetId: "a", artifacts: ["assets/x.png"] }, model: "gpt-image-1", quality: "high",
      capabilities: ["ordinary-generation"],
    });
    expect(job.output?.artifacts).toEqual(["assets/x.png"]);
  });

  it("requires output and progress=1 for complete jobs", () => {
    expect(() => assetJobSchema.parse({ schemaVersion: 1, id: "job1", planId: "plan1", status: "complete" })).toThrow();
    expect(() => assetJobSchema.parse({ schemaVersion: 1, id: "job1", planId: "plan1", status: "complete", output: { artifacts: ["a.png"] }, progress: 0.5 })).toThrow();
  });

  it("requires an error for failed jobs", () => {
    expect(() => assetJobSchema.parse({ schemaVersion: 1, id: "job1", planId: "plan1", status: "failed" })).toThrow();
    expect(assetJobSchema.parse({ schemaVersion: 1, id: "job1", planId: "plan1", status: "failed", error: "boom" }).error).toBe("boom");
  });

  it("rejects whitespace-only error for failed jobs", () => {
    expect(() => assetJobSchema.parse({ schemaVersion: 1, id: "job1", planId: "plan1", status: "failed", error: "   " })).toThrow(/non-empty error/);
    expect(() => assetJobSchema.parse({ schemaVersion: 1, id: "job1", planId: "plan1", status: "failed", error: "\n\t" })).toThrow(/non-empty error/);
  });

  it("parses a full manifest with reproducibility metadata and decisions", () => {
    const manifest = assetManifestSchema.parse({
      schemaVersion: 1,
      assets: [{ schemaVersion: 1, id: "a", path: "assets/x.png", hash: { algorithm: "sha256", value: SHA256 }, mimeType: "image/png" }],
      placements: [placement],
      plans: [{ schemaVersion: 1, id: "plan1", operation: "generate", capabilities: ["masked-edit"] }],
      jobs: [{ schemaVersion: 1, id: "job1", planId: "plan1", status: "complete", progress: 1, output: { artifacts: ["assets/x.png"] } }],
      promptHash: { algorithm: "sha256", value: SHA256 },
      referenceHashes: [{ algorithm: "sha256", value: SHA256 }],
      provider: { id: "openai", capabilities: ["ordinary-generation"] },
      model: "gpt-image-1", quality: "high", capabilities: ["ordinary-generation"],
      outputDimensions: { width: 1920, height: 1080 },
      generatedFiles: ["assets/x.png"],
      realAssetOverlays: [placement],
      decisions: [{ id: "d1", kind: "A1", reason: "logo critical" }],
      maskEvidence: ["proof/mask.png"],
      edgeChecks: { white: false, black: true },
      renderBackEvidence: ["proof/render.png"],
      review: { status: "pending" },
    });
    expect(manifest.decisions[0]?.kind).toBe("A1");
    expect(manifest.outputDimensions?.width).toBe(1920);
  });

  it("rejects duplicate asset/placement/plan/job ids", () => {
    const asset = { schemaVersion: 1, id: "a", path: "assets/x.png", hash: { algorithm: "sha256", value: SHA256 }, mimeType: "image/png" };
    expect(() => assetManifestSchema.parse({ schemaVersion: 1, assets: [asset, asset] })).toThrow(/duplicate asset id/);
    expect(() => assetManifestSchema.parse({
      schemaVersion: 1, assets: [asset],
      placements: [placement, { ...placement, assetId: undefined }],
    })).toThrow(/duplicate placement id/);
    expect(() => assetManifestSchema.parse({
      schemaVersion: 1, assets: [asset],
      plans: [{ schemaVersion: 1, id: "plan1" }, { schemaVersion: 1, id: "plan1" }],
    })).toThrow(/duplicate plan id/);
  });

  it("rejects dangling placement-asset and job-plan references", () => {
    const asset = { schemaVersion: 1, id: "a", path: "assets/x.png", hash: { algorithm: "sha256", value: SHA256 }, mimeType: "image/png" };
    expect(() => assetManifestSchema.parse({
      schemaVersion: 1, assets: [asset],
      placements: [{ schemaVersion: 1, id: "p1", sourcePath: "assets/x.png", sourceHash: { algorithm: "sha256", value: SHA256 }, assetId: "ghost", layoutSlot: "hero" }],
    })).toThrow(/unknown asset ghost/);
    expect(() => assetManifestSchema.parse({
      schemaVersion: 1, assets: [asset],
      jobs: [{ schemaVersion: 1, id: "job1", planId: "ghost", status: "running" }],
    })).toThrow(/unknown plan ghost/);
  });

  it("rejects dangling assetId references in plan placements, overlays, and job outputs", () => {
    const asset = { schemaVersion: 1, id: "a", path: "assets/x.png", hash: { algorithm: "sha256", value: SHA256 }, mimeType: "image/png" };
    const ghostPlacement = { schemaVersion: 1, id: "pp", sourcePath: "assets/x.png", sourceHash: { algorithm: "sha256", value: SHA256 }, assetId: "ghost", layoutSlot: "hero" };
    // plan.placements[].assetId
    expect(() => assetManifestSchema.parse({
      schemaVersion: 1, assets: [asset],
      plans: [{ schemaVersion: 1, id: "plan1", placements: [ghostPlacement] }],
    })).toThrow(/references unknown asset ghost/);
    // realAssetOverlays[].assetId
    expect(() => assetManifestSchema.parse({
      schemaVersion: 1, assets: [asset], realAssetOverlays: [ghostPlacement],
    })).toThrow(/references unknown asset ghost/);
    // jobs[].output.assetId
    expect(() => assetManifestSchema.parse({
      schemaVersion: 1, assets: [asset],
      plans: [{ schemaVersion: 1, id: "plan1" }],
      jobs: [{ schemaVersion: 1, id: "job1", planId: "plan1", status: "complete", progress: 1, output: { assetId: "ghost", artifacts: ["assets/x.png"] } }],
    })).toThrow(/references unknown asset ghost/);
    // a known assetId in all three positions is accepted
    const goodPlacement = { ...ghostPlacement, assetId: "a" };
    expect(() => assetManifestSchema.parse({
      schemaVersion: 1, assets: [asset], realAssetOverlays: [goodPlacement],
      plans: [{ schemaVersion: 1, id: "plan1", placements: [goodPlacement] }],
      jobs: [{ schemaVersion: 1, id: "job1", planId: "plan1", status: "complete", progress: 1, output: { assetId: "a", artifacts: ["assets/x.png"] } }],
    })).not.toThrow();
  });
});

describe("quality reports", () => {
  it("exposes the approved browser-gate categories plus an extra catch-all", () => {
    const options = qualityIssueCategorySchema.options as readonly string[];
    for (const required of ["stage-bounds", "text-overflow", "media-bounds", "object-overlap", "connector-collision", "missing-asset", "unsafe-clone-content", "export-settlement", "duplicate-id", "clipped-content", "scroll-overflow"]) {
      expect(options, `missing ${required}`).toContain(required);
    }
    // legacy categories are gone.
    for (const legacy of ["contrast", "overlap-collision", "image-broken", "font-missing"]) {
      expect(options).not.toContain(legacy);
    }
  });

  it("parses a quality report recording mode/strict/hard distinction and summary counts", () => {
    const report = qualityReportSchema.parse({
      schemaVersion: 1, id: "q", deckId: "d", canvas: { width: 1280, height: 720 },
      mode: "canonical", strict: true,
      issues: [
        { slideId: "s1", category: "text-overflow", severity: "error", hard: true, reason: "title clipped", bounds: [0, 0, 10, 10] },
        { category: "object-overlap", severity: "warning", reason: "z collision", pair: ["a", "b"], group: "g1", evidence: ["proof/shot.png"] },
      ],
      passed: false,
      summary: { total: 2, info: 0, warning: 1, error: 1, critical: 0, hard: 1 },
    });
    expect(report.mode).toBe("canonical");
    expect(report.strict).toBe(true);
    expect(report.issues[0]?.hard).toBe(true);
    expect(report.summary.hard).toBe(1);
  });

  it("rejects passed:true when hard/error/critical issues remain", () => {
    expect(() => qualityReportSchema.parse({
      schemaVersion: 1, id: "q", canvas: { width: 1280, height: 720 }, passed: true,
      issues: [{ category: "media-bounds", severity: "error", hard: false, reason: "image out of bounds" }],
      summary: { total: 1, info: 0, warning: 0, error: 1, critical: 0, hard: 0 },
    })).toThrow(/passed must be false/);
    expect(() => qualityReportSchema.parse({
      schemaVersion: 1, id: "q", canvas: { width: 1280, height: 720 }, passed: true,
      issues: [{ category: "clipped-content", severity: "info", hard: true, reason: "clipped" }],
      summary: { total: 1, info: 1, warning: 0, error: 0, critical: 0, hard: 1 },
    })).toThrow(/passed must be false/);
  });

  it("rejects passed:true when an export-settlement issue is unsettled", () => {
    expect(() => qualityReportSchema.parse({
      schemaVersion: 1, id: "q", canvas: { width: 1280, height: 720 }, passed: true,
      issues: [{ category: "export-settlement", severity: "warning", reason: "not settled", settled: false }],
      summary: { total: 1, info: 0, warning: 1, error: 0, critical: 0, hard: 0 },
    })).toThrow(/passed must be false/);
  });

  it("allows passed:true once an export-settlement issue is settled", () => {
    expect(() => qualityReportSchema.parse({
      schemaVersion: 1, id: "q", canvas: { width: 1280, height: 720 }, passed: true,
      issues: [{ category: "export-settlement", severity: "warning", reason: "settled", settled: true }],
      summary: { total: 1, info: 0, warning: 1, error: 0, critical: 0, hard: 0 },
    })).not.toThrow();
  });

  it("rejects a quality report whose summary contradicts the issue-derived counts", () => {
    expect(() => qualityReportSchema.parse({
      schemaVersion: 1, id: "q", canvas: { width: 1280, height: 720 }, passed: false,
      issues: [
        { category: "text-overflow", severity: "error", hard: true, reason: "clipped" },
        { category: "object-overlap", severity: "warning", reason: "overlap" },
      ],
      summary: { total: 5, info: 0, warning: 1, error: 1, critical: 0, hard: 1 },
    })).toThrow(/summary counts must exactly match/);
    // omitting the summary while issues are present is also contradictory.
    expect(() => qualityReportSchema.parse({
      schemaVersion: 1, id: "q", canvas: { width: 1280, height: 720 }, passed: false,
      issues: [{ category: "text-overflow", severity: "error", hard: true, reason: "clipped" }],
    })).toThrow(/summary counts must exactly match/);
  });

  it("preserves 1280x720 and 1920x1080 canvas behavior", () => {
    for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
      const report = qualityReportSchema.parse({ schemaVersion: 1, id: "q", canvas: { width: w, height: h }, passed: true });
      expect(report.canvas.width).toBe(w);
      expect(report.canvas.height).toBe(h);
    }
  });
});

describe("style, layout, and recipe profiles", () => {
  it("parses a full style profile with guidance, tags/tokens, and provenance", () => {
    const style = styleProfileSchema.parse({
      schemaVersion: 1, id: "sp", name: "Editorial",
      globalGuidance: "calm, editorial", promptGuidance: "use accent sparingly",
      tags: ["editorial", "serif"], tokens: { radius: 8 },
      provenance: { source: "preset-pack", sourceId: "ed-1" },
    });
    expect(style.tags).toContain("editorial");
    expect(style.provenance.source).toBe("preset-pack");
  });

  it("parses a plan-conformant layout profile with slots, regions, and overlap groups", () => {
    const layout = layoutProfileSchema.parse({
      schemaVersion: 1, id: "lp", name: "Hero+Body", styleId: "sp", role: "content",
      canvas: { width: 1920, height: 1080 }, visualSignature: "hero-left", capacity: 4,
      suitability: { best: ["content", "comparison"], avoid: ["cover"] },
      reuse: { policy: "shared", reason: "reusable body" },
      promptGuidance: "hero on the left",
      slots: [{
        id: "hero", region: { x: 0, y: 0, width: 0.5, height: 1 }, acceptedKinds: ["image"],
        maxCount: 1, fit: "cover", emptyBehavior: "placeholder",
      }],
      protectedTextRegions: [{ x: 0.5, y: 0, width: 0.5, height: 0.2 }],
      allowedOverlapGroups: ["bg-stack"],
      schema: { type: "object", properties: {} },
    });
    expect(layout.styleId).toBe("sp");
    expect(layout.role).toBe("content");
    expect(layout.slots[0]?.fit).toBe("cover");
    expect(layout.schema).toEqual({ type: "object", properties: {} });
  });

  it("models layout slots with fit policy and empty behavior", () => {
    const slot = layoutSlotSchema.parse({ id: "s", region: { x: 0, y: 0, width: 1, height: 1 } });
    expect(slot.fit).toBe("contain");
    expect(slot.emptyBehavior).toBe("collapse");
    expect(slot.maxCount).toBe(1);
  });

  it("parses a recipe modeling recommended style, roles, plan path, warnings, provenance", () => {
    const recipe = recipeSchema.parse({
      schemaVersion: 1, id: "r", name: "Quarterly review",
      recommendedStyleId: "sp", description: "quarterly business review",
      slideRoles: ["cover", "agenda", "content"], planPath: "plans/quarterly.json",
      warnings: ["avoid dense tables"], provenance: { source: "template" },
    });
    expect(recipe.recommendedStyleId).toBe("sp");
    expect(recipe.slideRoles).toContain("agenda");
  });
});
