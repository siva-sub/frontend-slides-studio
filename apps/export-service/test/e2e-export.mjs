import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildServer } from "../dist/server.js";

const root = join(tmpdir(), "frontend-slides-studio-export-smoke");
const jobsRoot = join(root, "jobs"); await rm(root, { recursive: true, force: true }); await mkdir(jobsRoot, { recursive: true });
const token = "export-smoke-token";
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const deck = (width, height, label) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#222}.deck-stage{position:absolute;left:0;top:0;width:${width}px;height:${height}px;background:#fffcf4}.slide{position:absolute;inset:0;width:${width}px;height:${height}px;background:#fffcf4}.slide h1{position:absolute;left:50%;top:50%;translate:-50% -50%;margin:0;font:700 72px sans-serif}.marker{position:absolute;width:96px;height:96px}.tl{left:0;top:0;background:#e11d48}.tr{right:0;top:0;background:#16a34a}.bl{left:0;bottom:0;background:#2563eb}.br{right:0;bottom:0;background:#f05a36}</style></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="one"><h1 data-object-id="title">${label}</h1><div class="marker tl" data-object-id="marker-tl"></div><div class="marker tr" data-object-id="marker-tr"></div><div class="marker bl" data-object-id="marker-bl"></div><div class="marker br" data-object-id="marker-br"></div></section></main></body></html>`;
const sources = [{ name: "stage-1280.html", width: 1280, height: 720 }, { name: "stage-1920.html", width: 1920, height: 1080 }];
for (const source of sources) await writeFile(join(root, source.name), deck(source.width, source.height, `${source.width} intrinsic canvas`));

const app = buildServer({ token, sourceRoot: root, jobRoot: jobsRoot, logger: false });
await app.listen({ host: "127.0.0.1", port: 0 });
const address = app.server.address(); assert(address && typeof address === "object", "Export service did not bind");
const base = `http://127.0.0.1:${address.port}`;
const headers = { Authorization: `Bearer ${token}`, Origin: "http://127.0.0.1", "Content-Type": "application/json" };
const run = async (source, format) => {
  const submitted = await fetch(`${base}/jobs`, { method: "POST", headers, body: JSON.stringify({ source, format }) }); assert(submitted.status === 202, `Export submission failed: ${submitted.status}`); const job = await submitted.json();
  for (let attempt = 0; attempt < 120; attempt++) { const response = await fetch(`${base}/jobs/${job.id}`, { headers }); const state = await response.json(); if (state.status === "complete") return state; if (state.status === "failed") throw new Error(state.error); await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out waiting for ${format}`);
};
const inspectMarkers = (pngPath) => { const code = "from PIL import Image\nimport json,sys\nim=Image.open(sys.argv[1]).convert('RGB')\npts=[(5,5),(im.width-6,5),(5,im.height-6),(im.width-6,im.height-6),(im.width//2,im.height//2)]\nprint(json.dumps([im.getpixel(p) for p in pts]))"; const result = spawnSync("python3", ["-c", code, pngPath], { encoding: "utf8" }); assert(result.status === 0, result.stderr); return JSON.parse(result.stdout); };
const near = (actual, expected, tolerance = 8) => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
const assertFullEdgeCoverage = (pixels, label) => {
  [[225, 29, 72], [22, 163, 74], [37, 99, 235], [240, 90, 54]].forEach((expected, index) => assert(near(pixels[index], expected), `${label} marker ${index + 1} missed the page edge: ${pixels[index].join(",")}`));
};
const evidence = [];
try {
  for (const source of sources) {
    const sourcePath = join(root, source.name);
    const pdfJob = await run(sourcePath, "pdf"); const pdfQuality = JSON.parse(await readFile(pdfJob.qualityReport, "utf8")); assert(pdfQuality.passed === true, `PDF quality report failed: ${JSON.stringify(pdfQuality.issues)}`); assert(pdfQuality.canvas.width === source.width && pdfQuality.canvas.height === source.height, `PDF quality canvas is ${pdfQuality.canvas.width}x${pdfQuality.canvas.height}`); assert((await readFile(join(dirname(pdfJob.qualityReport), "quality", "slide-01.png"))).length > 0, "PDF quality screenshot missing");
    const pdfInfo = spawnSync("pdfinfo", [pdfJob.output], { encoding: "utf8" }); assert(pdfInfo.status === 0, pdfInfo.stderr); assert(/Pages:\s+1/.test(pdfInfo.stdout), "PDF page count is not one"); assert(/Page size:\s+960 x 540 pts/.test(pdfInfo.stdout), "PDF page size is not widescreen");
    const pdfPng = join(dirname(pdfJob.output), "pdf-page"); const raster = spawnSync("pdftoppm", ["-png", "-f", "1", "-singlefile", "-r", "72", pdfJob.output, pdfPng], { encoding: "utf8" }); assert(raster.status === 0, raster.stderr); const pdfPixels = inspectMarkers(`${pdfPng}.png`); assertFullEdgeCoverage(pdfPixels, `PDF ${source.name}`);
    const pptxJob = await run(sourcePath, "pptx"); const pptxQuality = JSON.parse(await readFile(pptxJob.qualityReport, "utf8")); assert(pptxQuality.passed === true, `PPTX quality report failed: ${JSON.stringify(pptxQuality.issues)}`); const pptxReport = JSON.parse(await readFile(`${pptxJob.output}.report.json`, "utf8")); assert(pptxReport.qualityReport === pptxJob.qualityReport, "Raster PPTX report did not retain quality evidence"); assert(pptxReport.standard?.standard === "ISO/IEC 29500" && pptxReport.standard?.conformance === "transitional" && pptxReport.standard?.packageValidated === true, "Raster PPTX lacks ISO/IEC 29500 conformance evidence"); assert(pptxReport.limitations.some((item) => item.includes("native PowerPoint animation")), "Raster PPTX report omitted motion loss"); const rasterPng = join(dirname(pptxJob.output), "slide-01.png"); const bytes = await readFile(rasterPng); const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20); assert(width === 1920 && height === 1080, `Raster PPTX frame is ${width}x${height}`); const rasterPixels = inspectMarkers(rasterPng); assertFullEdgeCoverage(rasterPixels, `Raster PPTX ${source.name}`);
    const editableJob = await run(sourcePath, "editable-pptx"); const editableReport = JSON.parse(await readFile(editableJob.exportReport, "utf8")); assert(editableReport.mode === "editable", "Editable service export returned the wrong report mode"); assert(editableReport.standard?.standard === "ISO/IEC 29500" && editableReport.standard?.conformance === "transitional" && editableReport.standard?.packageValidated === true, "Editable PPTX lacks ISO/IEC 29500 conformance evidence"); assert(editableReport.nativeObjects >= 5, `Editable service export produced only ${editableReport.nativeObjects} native objects`); assert(editableReport.manualVisualReviewRequired === true, "Editable export skipped manual review"); assert(["rendered_pending_manual_review", "unverified"].includes(editableReport.status), `Unexpected editable status ${editableReport.status}`);
    evidence.push({ source: source.name, pdf: pdfJob.output, pptx: pptxJob.output, editablePptx: editableJob.output, editableReport: editableJob.exportReport, quality: { pdf: pdfJob.qualityReport, pptx: pptxJob.qualityReport, editable: editableJob.qualityReport }, raster: { width, height }, pdfPixels, rasterPixels });
  }
  console.log(JSON.stringify({ ok: true, root, evidence }));
} finally { await app.close(); }
