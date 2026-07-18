import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { approveEditablePptx, exportEditablePptx } from "@slides-studio/export";

const root = join(tmpdir(), "frontend-slides-studio-editable-smoke"); await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true });
const plate = join(root, "plate.png"); const output = join(root, "editable.pptx"); const qualityReport = join(root, "quality-report.json");
const image = spawnSync("python3", ["-c", "from PIL import Image\nimport sys\nImage.new('RGB',(1920,1080),(246,244,237)).save(sys.argv[1])", plate], { encoding: "utf8" }); if (image.status !== 0) throw new Error(image.stderr);
const graph = { schemaVersion: 1, title: "Editable object graph smoke", slides: [{ id: "slide-01", width: 1920, height: 1080, objects: [
  { id: "clean-plate", sourceId: "clean_plate", sourceKind: "visual-scene", type: "image", x: 0, y: 0, width: 1920, height: 1080, zIndex: 0, native: false, fallbackReason: "visual-master clean plate", path: plate, fit: "stretch" },
  { id: "accent-card", sourceId: "card", sourceKind: "diagram", type: "shape", x: 120, y: 180, width: 520, height: 420, zIndex: 10, native: true, shape: "rounded-rectangle", fill: "#FDE8E1", stroke: "#F05A36" },
  { id: "cropped-media", sourceId: "hero", sourceKind: "dom", type: "image", x: 1280, y: 120, width: 480, height: 360, zIndex: 12, native: true, path: plate, fit: "cover", crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }, focal: { x: 0.7, y: 0.4 }, rotation: 3, alt: "Cropped media evidence", layoutSlot: "hero" },
  { id: "title", sourceId: "title", sourceKind: "dom", type: "text", x: 180, y: 240, width: 1000, height: 150, zIndex: 20, native: true, text: "Editable native objects", fontFace: "Liberation Sans", fontSize: 44, color: "#20231F", bold: true, align: "left" },
  { id: "flow", sourceId: "flow", sourceKind: "diagram", type: "connector", x: 0, y: 0, width: 1920, height: 1080, zIndex: 15, native: true, points: [{ x: 640, y: 390 }, { x: 900, y: 390 }, { x: 900, y: 600 }, { x: 1240, y: 600 }], stroke: "#315F9D", dashed: false, endArrow: true, label: "native route" }
] }] };
await writeFile(qualityReport, JSON.stringify({ schemaVersion: 1, id: "editable-quality", canvas: { width: 1920, height: 1080 }, mode: "canonical", strict: true, issues: [], passed: true, summary: { total: 0, info: 0, warning: 0, error: 0, critical: 0, hard: 0 } }));
const report = await exportEditablePptx(graph, output, { qualityReport });
if (report.nativeObjects !== 4 || report.fallbackObjects !== 1) throw new Error(`Unexpected inventory: ${JSON.stringify(report)}`);
if (!report.limitations.some((item) => item.includes("native PowerPoint animation"))) throw new Error("Motion-loss limitation is missing from editable report");
if (!report.manualVisualReviewRequired || report.status !== "rendered_pending_manual_review") throw new Error(`Editable evidence gate is incomplete: ${report.status}`);
if (report.qualityReport !== qualityReport || !report.artifactHashes?.qualityReport || report.objectInventory.length !== 5) throw new Error(`Editable evidence inventory is incomplete: ${JSON.stringify(report)}`);
if (report.renderEvidence) { const info = spawnSync("pdfinfo", [report.renderEvidence], { encoding: "utf8" }); if (info.status !== 0 || !/Pages:\s+1/.test(info.stdout)) throw new Error("Render-back PDF is invalid"); }
const approved = await approveEditablePptx(`${output}.report.json`, { reviewer: "Editable smoke", evidence: report.renderEvidence }); if (approved.status !== "passed" || approved.manualVisualReviewRequired) throw new Error("Explicit editable review did not pass");
const inventoryCode = "from pptx import Presentation\nimport sys\nprs=Presentation(sys.argv[1])\nprint('|'.join(s.name for s in prs.slides[0].shapes))";
const inventory = spawnSync("python3", ["-c", inventoryCode, output], { encoding: "utf8" }); if (inventory.status !== 0) throw new Error(inventory.stderr);
const objectNames = inventory.stdout.trim().split("|");
for (const name of ["clean-plate", "accent-card", "cropped-media", "title", "flow-1", "flow-label"]) if (!objectNames.includes(name)) throw new Error(`Missing named editable object: ${name}`);
console.log(JSON.stringify({ ok: true, root, report, objects: objectNames }));
