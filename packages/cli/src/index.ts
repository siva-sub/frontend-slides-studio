#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { renderDiagramSvg, validateDiagram } from "@slides-studio/diagram-kit";
import { approveEditablePptx, buildAuthorHtml, buildShareHtml, exportEditablePptx } from "@slides-studio/export";
import { inspectLayout as inspectLegacyLayout, normalizeLayout as normalizeLegacyLayout, queryLayouts as queryLegacyLayouts, type LayoutQuery as LegacyLayoutQuery } from "@slides-studio/layout-contracts";
import { NATIVE_PPTX_TRANSITION_KINDS, NATIVE_SHAPE_PRESETS, PPT_RS_SHAPE_COMPATIBILITY, resolveNativeShapePreset, validatePptxPackage } from "@slides-studio/pptx-compat";
import { analyzePptxHtmlReadiness } from "@slides-studio/presentation-objects";
import { deckGoalSchema, motionAnalysisSchema, motionIntentSchema, motionProgramSchema, parseDiagramSpec, type MotionProgramV1, type ProviderCapability, type ProviderQuality } from "@slides-studio/protocol";
import { inspectLayout as inspectRegistryLayout, inspectRecipe, inspectStyle, listRecipes, listStyles, normalizeLayoutProps, queryLayouts as queryRegistryLayouts, scaffoldRecipe, type LayoutQuery as RegistryLayoutQuery } from "@slides-studio/style-registry";
import { applyTransitionToDeck, createAssetPlan, motionEffectFrames, reframeMediaPlacement, submitAssetPlan, waitForAssetJob } from "./workflows.js";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const command = args.shift();
const flag = (name: string, fallback?: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const required = (name: string) => { const value = flag(name); if (!value) throw new Error(`${name} is required`); return value; };
const positionalOrId = () => args[0] && !args[0].startsWith("--") ? args.shift()! : required("--id");
const parseJsonText = (content: string, source: string): unknown => {
  try { return JSON.parse(content) as unknown; }
  catch (error) { throw new Error(`Invalid JSON in ${source}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
};
const jsonFile = async (path: string) => { const target = resolve(path); return parseJsonText(await readFile(target, "utf8"), target); };
const numberFlag = (name: string, fallback?: number) => { const raw = flag(name); if (raw === undefined) return fallback; const value = Number(raw); if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`); return value; };
const pointFlag = (xName: string, yName: string, fallback = 0.5) => { const x = numberFlag(xName); const y = numberFlag(yName); return x === undefined && y === undefined ? undefined : { x: x ?? fallback, y: y ?? fallback }; };
const writeJsonResult = async (value: unknown, output?: string) => { const content = `${JSON.stringify(value, null, 2)}\n`; if (output) { const target = resolve(output); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); console.log(target); } else console.log(content.trimEnd()); };
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function doctor(): Promise<void> {
  const tools = ["node", "pnpm", "python3", "ffmpeg", "ffprobe", "libreoffice"].map((tool) => ({ tool, available: spawnSync(tool, [tool === "ffmpeg" || tool === "ffprobe" ? "-version" : "--version"], { stdio: "ignore" }).status === 0 }));
  console.log(JSON.stringify({ node: process.version, root, tools, generatedShareRuntimeDependency: "none" }, null, 2));
}

async function newDeck(): Promise<void> {
  const output = resolve(args[0] ?? "deck.html");
  await mkdir(dirname(output), { recursive: true });
  await cp(resolve(root, "templates/starter.html"), output, { force: false });
  console.log(output);
}

async function importDeck(): Promise<void> {
  const input = resolve(required("--input")); const output = resolve(required("--output")); const source = await readFile(input, "utf8"); const { document } = parseHTML(source);
  let slides = Array.from(document.querySelectorAll<HTMLElement>("section.slide, .reveal .slides > section, body > .slide, .pptx-slide, .slide-page, body > .page, [data-slide], [data-slide-id]"));
  slides = slides.filter((slide) => !slides.some((other) => other !== slide && other.contains(slide)));
  if (!slides.length) { const sections = Array.from(document.querySelectorAll<HTMLElement>("body > section")); if (sections.length >= 2) slides = sections; }
  if (!slides.length) throw new Error("No discrete slides detected; continuous documents require Studio confirmation.");
  slides.forEach((slide, index) => { slide.classList.add("slide"); slide.dataset.slideId ||= `slide-${String(index + 1).padStart(2, "0")}`; slide.querySelectorAll<HTMLElement>("h1,h2,h3,p,li,img,video,svg,figure,table,blockquote").forEach((element, objectIndex) => { element.dataset.objectId ||= `${slide.dataset.slideId}-object-${String(objectIndex + 1).padStart(2, "0")}`; }); });
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, `<!doctype html>\n${document.documentElement.outerHTML}`); console.log(JSON.stringify({ output, slides: slides.length }, null, 2));
}

async function layoutCommand(): Promise<void> {
  const sub = args.shift();
  if (sub === "query") {
    const styleId = flag("--style");
    const role = flag("--role");
    const needsMedia = flag("--needs-media");
    const seed = flag("--seed");
    const used = flag("--used");
    if (styleId) {
      const query: RegistryLayoutQuery = { styleId };
      if (role) query.role = role as NonNullable<RegistryLayoutQuery["role"]>;
      if (needsMedia) query.needsMedia = Number(needsMedia);
      if (seed) query.seed = seed;
      if (used) query.used = used.split(",");
      const results = queryRegistryLayouts(query);
      console.log(JSON.stringify(results.map(({ id, name, styleId: resultStyleId, role: resultRole, reuse, slots, capacity, visualSignature }) => ({ id, name, styleId: resultStyleId, role: resultRole, reuse: reuse.policy, mediaCapacity: slots.length, capacity, description: visualSignature })), null, 2));
      return;
    }
    const query: LegacyLayoutQuery = {};
    const theme = flag("--theme");
    const renderMode = flag("--render-mode");
    if (theme) query.theme = theme;
    if (role) query.role = role as NonNullable<LegacyLayoutQuery["role"]>;
    if (renderMode) query.renderMode = renderMode as NonNullable<LegacyLayoutQuery["renderMode"]>;
    if (needsMedia) query.needsMedia = Number(needsMedia);
    if (seed) query.seed = seed;
    if (used) query.used = used.split(",");
    const results = queryLegacyLayouts(query);
    console.log(JSON.stringify(results.map(({ key, theme: resultTheme, role: resultRole, reuse, mediaSlots, renderModes, description }) => ({ key, theme: resultTheme, role: resultRole, reuse, mediaCapacity: mediaSlots.length, renderModes, description })), null, 2));
  }
  else if (sub === "inspect") {
    const layoutId = positionalOrId();
    await writeJsonResult(layoutId.includes("/") ? inspectRegistryLayout(layoutId) : inspectLegacyLayout(layoutId), flag("--output"));
  }
  else if (sub === "normalize") {
    const layoutId = positionalOrId();
    const propsPath = args[0] && !args[0].startsWith("--") ? args.shift()! : flag("--props") ?? flag("--input");
    if (!propsPath) throw new Error("layout props path is required as a positional argument or --props");
    const props = await jsonFile(propsPath) as Record<string, unknown>;
    const result = layoutId.includes("/") ? normalizeLayoutProps(layoutId, props) : normalizeLegacyLayout(layoutId, props, Number(flag("--needs-media", "0")));
    await writeJsonResult(result, flag("--output"));
  }
  else throw new Error("layouts requires query, inspect, or normalize");
}

async function stylesCommand(): Promise<void> {
  const sub = args.shift();
  if (sub === "list") await writeJsonResult(listStyles(), flag("--output"));
  else if (sub === "inspect") await writeJsonResult(inspectStyle(positionalOrId()), flag("--output"));
  else throw new Error("styles requires list or inspect");
}

async function recipesCommand(): Promise<void> {
  const sub = args.shift();
  if (sub === "list") await writeJsonResult(listRecipes(), flag("--output"));
  else if (sub === "inspect") await writeJsonResult(inspectRecipe(positionalOrId()), flag("--output"));
  else if (sub === "scaffold") await writeJsonResult(scaffoldRecipe(positionalOrId(), flag("--seed", "slides-studio")!), flag("--output"));
  else throw new Error("recipes requires list, inspect, or scaffold");
}

async function diagramCommand(): Promise<void> {
  const sub = args.shift(); const input = required("--input"); const spec = parseDiagramSpec(await jsonFile(input));
  if (sub === "validate") { const issues = validateDiagram(spec); console.log(JSON.stringify(issues, null, 2)); if (issues.some((issue) => issue.severity === "error")) process.exitCode = 1; }
  else if (["render", "export"].includes(sub ?? "")) { const output = resolve(required("--output")); await mkdir(dirname(output), { recursive: true }); await writeFile(output, renderDiagramSvg(spec)); console.log(output); }
  else throw new Error("diagram requires render, validate, or export");
}

async function motionCommand(): Promise<void> {
  const sub = args.shift();
  if (sub === "analyze") { const video = args[0] && !args[0].startsWith("--") ? args[0] : required("--input"); const output = resolve(flag("--output", "motion-analysis.json")!); const result = spawnSync("python3", [resolve(root, "motion/analyze.py"), video, "--output", output], { stdio: "inherit", cwd: root }); if (result.status) process.exitCode = result.status; }
  else if (sub === "apply") { const analysis = motionAnalysisSchema.parse(await jsonFile(required("--analysis"))); const intent = motionIntentSchema.parse(await jsonFile(required("--intent"))); const replay = flag("--replay", "always") as MotionProgramV1["replay"]; if (!["always", "once", "never"].includes(replay)) throw new Error("--replay must be always, once, or never"); const program = motionProgramSchema.parse({ schemaVersion: 1, replay, tracks: intent.mappings.map((mapping) => ({ objectId: mapping.objectId, keyframes: motionEffectFrames(mapping.effect), options: { duration: mapping.durationMs, delay: mapping.startMs, easing: mapping.easing, iterations: mapping.effect === "loop" ? 99_999 : 1, fill: "both" }, reducedMotion: { opacity: 1 } })) }); const output = resolve(required("--output")); await writeFile(output, JSON.stringify({ ...program, provenance: { analysis: analysis.source, measuredDurationMs: analysis.durationMs, caveats: analysis.caveats } }, null, 2)); console.log(output); }
  else throw new Error("motion requires analyze or apply");
}

async function visualCommand(): Promise<void> { const sub = args.shift(); const pythonArgs = [resolve(root, "visual/cli.py"), sub ?? "", ...args]; const result = spawnSync("python3", pythonArgs, { stdio: "inherit", cwd: resolve(root, "visual"), env: { ...process.env, PYTHONPATH: resolve(root, "visual") } }); if (result.status) process.exitCode = result.status; }

async function assetCommand(): Promise<void> {
  const sub = args.shift();
  if (sub === "plan") {
    const promptFile = flag("--prompt-file");
    const prompt = promptFile ? await readFile(resolve(promptFile), "utf8") : required("--prompt");
    const capabilities = (flag("--capabilities", "ordinary-generation") ?? "ordinary-generation").split(",").filter(Boolean) as ProviderCapability[];
    const quality = flag("--quality") as ProviderQuality | undefined;
    const slideId = flag("--slide"); const styleId = flag("--style"); const layoutId = flag("--layout"); const providerId = flag("--provider"); const model = flag("--model");
    const plan = createAssetPlan({
      id: flag("--id", `asset-plan-${Date.now()}`)!, prompt,
      ...(slideId ? { slideId } : {}), ...(styleId ? { styleId } : {}), ...(layoutId ? { layoutId } : {}),
      ...(providerId ? { providerId } : {}), ...(model ? { model } : {}), ...(quality ? { quality } : {}), capabilities,
    });
    await writeJsonResult(plan, flag("--output"));
  } else if (sub === "generate") {
    const plan = await jsonFile(required("--plan"));
    const service = flag("--service", "http://127.0.0.1:4317")!;
    const token = process.env.SLIDES_STUDIO_EXPORT_TOKEN || flag("--token");
    if (!token) throw new Error("SLIDES_STUDIO_EXPORT_TOKEN or --token is required");
    const accepted = await submitAssetPlan(plan, { service, token });
    const pollMs = numberFlag("--poll-ms", 250); const timeoutMs = numberFlag("--timeout-ms", 120_000);
    const result = args.includes("--no-wait") ? accepted : await waitForAssetJob(accepted, { service, token, ...(pollMs !== undefined ? { pollMs } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    await writeJsonResult(result, flag("--output"));
  } else throw new Error("asset requires plan or generate");
}

async function mediaCommand(): Promise<void> {
  const sub = args.shift();
  if (sub !== "reframe") throw new Error("media requires reframe");
  const placement = await jsonFile(required("--input"));
  const source = { width: numberFlag("--source-width") ?? 0, height: numberFlag("--source-height") ?? 0 };
  const slotValues = required("--slot").split(",").map(Number);
  if (source.width <= 0 || source.height <= 0) throw new Error("--source-width and --source-height must be positive");
  if (slotValues.length !== 4 || slotValues.some((value) => !Number.isFinite(value))) throw new Error("--slot must be x,y,width,height");
  const [x, y, width, height] = slotValues as [number, number, number, number];
  if (width <= 0 || height <= 0) throw new Error("slot width and height must be positive");
  const focal = pointFlag("--focal-x", "--focal-y");
  const pan = pointFlag("--pan-x", "--pan-y", 0);
  const fit = flag("--fit") as "contain" | "cover" | undefined;
  const zoom = numberFlag("--zoom"); const rotation = numberFlag("--rotation");
  const result = reframeMediaPlacement(placement, {
    source, slot: { x, y, width, height },
    ...(fit ? { fit } : {}), ...(focal ? { focal } : {}), ...(pan ? { pan } : {}),
    ...(zoom !== undefined ? { zoom } : {}), ...(rotation !== undefined ? { rotation } : {}),
  });
  await writeJsonResult(result, flag("--output"));
}

async function transitionCommand(): Promise<void> {
  const sub = args.shift();
  if (sub !== "apply") throw new Error("transition requires apply");
  const deck = await jsonFile(required("--input"));
  const spec = await jsonFile(required("--spec"));
  const slideId = flag("--slide");
  const result = applyTransitionToDeck(deck, spec, { ...(args.includes("--default") ? { default: true } : {}), ...(slideId ? { slideId } : {}) });
  await writeJsonResult(result, required("--output"));
}

async function qualityCommand(): Promise<void> {
  const source = resolve(required("--input")); const service = flag("--service", "http://127.0.0.1:4317")!; const token = process.env.SLIDES_STUDIO_EXPORT_TOKEN || flag("--token");
  if (!token) throw new Error("SLIDES_STUDIO_EXPORT_TOKEN or --token is required");
  const mode = flag("--mode", "canonical"); if (!["canonical", "imported"].includes(mode!)) throw new Error("--mode must be canonical or imported");
  const response = await fetch(`${service}/quality`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: "http://127.0.0.1" }, body: JSON.stringify({ source, mode, strict: args.includes("--strict") }) });
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json() as { report: { passed: boolean }; reportPath: string; screenshots: string[] };
  await writeJsonResult(result.report, flag("--output"));
  console.error(JSON.stringify({ reportPath: result.reportPath, screenshots: result.screenshots }));
  if (args.includes("--strict") && !result.report.passed) process.exitCode = 1;
}

async function validateCommand(): Promise<void> {
  const path = resolve(args[0] ?? required("--input")); const content = await readFile(path, "utf8");
  if (/\.json$/i.test(path)) { const deck = deckGoalSchema.parse(parseJsonText(content, path)); const ids = new Set<string>(); const duplicates = deck.slides.filter((slide) => ids.size === (ids.add(slide.id), ids.size)); if (duplicates.length) throw new Error(`duplicate slide IDs: ${duplicates.map((slide) => slide.id).join(",")}`); console.log(`DeckGoal valid: ${deck.slides.length} slides.`); }
  else { const missing = !/class=["'][^"']*\bslide\b/.test(content); const unsafe = /<script[^>]+src=["']https?:|\bon\w+\s*=|javascript:/i.test(content); if (missing || unsafe) throw new Error([missing && "no .slide elements", unsafe && "unsafe external script/event/url"].filter(Boolean).join("; ")); console.log("HTML deck valid."); }
}

async function buildCommand(): Promise<void> { const input = resolve(required("--input")); const mode = flag("--mode", "share"); const output = resolve(required("--output")); const runtimePath = resolve(root, "packages/runtime/dist/slides-studio-runtime.iife.js"); if (!existsSync(runtimePath)) throw new Error("runtime bundle missing; run pnpm build"); const source = await readFile(input, "utf8"); const runtime = await readFile(runtimePath, "utf8"); const html = mode === "author" ? buildAuthorHtml(source, runtime) : buildShareHtml(source, runtime); await mkdir(dirname(output), { recursive: true }); await writeFile(output, html); console.log(output); }

async function pptxCommand(): Promise<void> {
  const sub = args.shift();
  if (sub === "editable") { const graph = await jsonFile(required("--graph")) as Parameters<typeof exportEditablePptx>[0]; const qualityReport = flag("--quality-report"); if (!qualityReport && !args.includes("--unverified")) throw new Error("--quality-report is required for editable export; use --unverified only for an explicitly non-approvable compatibility build"); const report = await exportEditablePptx(graph, resolve(required("--output")), { ...(qualityReport ? { qualityReport: resolve(qualityReport) } : {}) }); console.log(JSON.stringify(report, null, 2)); }
  else if (sub === "review") { const report = await approveEditablePptx(resolve(required("--report")), { reviewer: required("--reviewer"), evidence: required("--evidence") }); console.log(JSON.stringify(report, null, 2)); }
  else if (sub === "validate") { const report = await validatePptxPackage(resolve(required("--input"))); console.log(JSON.stringify(report, null, 2)); if (!report.valid) process.exitCode = 1; }
  else if (sub === "html-check") {
    const input = resolve(required("--input")); const source = await readFile(input, "utf8"); const { document } = parseHTML(source);
    const report = analyzePptxHtmlReadiness(document); await writeJsonResult(report, flag("--output"));
    if (!report.ready || (args.includes("--strict") && !report.strictReady)) process.exitCode = 1;
  }
  else if (sub === "shapes") {
    const action = args.shift() ?? "list";
    if (action === "list") console.log(JSON.stringify({ count: NATIVE_SHAPE_PRESETS.length, presets: NATIVE_SHAPE_PRESETS, pptRsCompatibility: PPT_RS_SHAPE_COMPATIBILITY }, null, 2));
    else if (action === "resolve") { const name = required("--name"); const resolvedShape = resolveNativeShapePreset(name); if (!resolvedShape) throw new Error(`${name} has no schema-valid native preset or compatibility mapping`); console.log(JSON.stringify({ input: name, ...resolvedShape }, null, 2)); }
    else throw new Error("pptx shapes requires list or resolve");
  }
  else if (sub === "transitions") console.log(JSON.stringify({ count: NATIVE_PPTX_TRANSITION_KINDS.length, transitions: NATIVE_PPTX_TRANSITION_KINDS }, null, 2));
  else throw new Error("pptx requires editable, review, validate, html-check, shapes, or transitions");
}

interface ExportJob { id: string; status: string; error?: string; qualityReport?: string; qualityPassed?: boolean; output?: string; exportReport?: string; editableStatus?: string; }

async function waitForExportJob(service: string, token: string, job: ExportJob, deadline: number, pollMs: number): Promise<ExportJob> {
  if (["complete", "failed"].includes(job.status)) return job;
  if (Date.now() >= deadline) throw new Error(`export job ${job.id} timed out`);
  await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
  const response = await fetch(`${service}/jobs/${encodeURIComponent(job.id)}`, { headers: { authorization: `Bearer ${token}`, origin: "http://127.0.0.1" } });
  if (!response.ok) throw new Error(await response.text());
  return waitForExportJob(service, token, await response.json() as ExportJob, deadline, pollMs);
}

async function exportCommand(): Promise<void> {
  const source = resolve(required("--input")); const format = required("--format"); const service = flag("--service", "http://127.0.0.1:4317")!; const token = process.env.SLIDES_STUDIO_EXPORT_TOKEN || flag("--token");
  if (!token) throw new Error("SLIDES_STUDIO_EXPORT_TOKEN or --token is required");
  if (!["pdf", "pptx", "editable-pptx"].includes(format)) throw new Error("--format must be pdf, pptx, or editable-pptx");
  const requestedQualityGate = flag("--quality-gate", format === "editable-pptx" ? "strict" : "report")!;
  if (format === "editable-pptx" && requestedQualityGate !== "strict") throw new Error("editable-pptx requires --quality-gate strict");
  const qualityGate = requestedQualityGate; if (!["off", "report", "strict"].includes(qualityGate)) throw new Error("--quality-gate must be off, report, or strict");
  const qualityMode = flag("--quality-mode", "canonical")!; if (!["canonical", "imported"].includes(qualityMode)) throw new Error("--quality-mode must be canonical or imported");
  const response = await fetch(`${service}/jobs`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: "http://127.0.0.1" }, body: JSON.stringify({ source, format, qualityGate, qualityMode }) });
  if (!response.ok) throw new Error(await response.text());
  let job = await response.json() as ExportJob;
  if (qualityGate === "strict" || args.includes("--wait")) {
    const deadline = Date.now() + Number(flag("--timeout-ms", "120000"));
    job = await waitForExportJob(service, token, job, deadline, Number(flag("--poll-ms", "250")));
  }
  console.log(JSON.stringify(job, null, 2));
  if (job.status === "failed") throw new Error(job.error ?? `export job ${job.id} failed`);
}

try {
  if (command === "doctor") await doctor();
  else if (command === "new") await newDeck();
  else if (command === "import") await importDeck();
  else if (command === "layouts") await layoutCommand();
  else if (command === "styles") await stylesCommand();
  else if (command === "recipes") await recipesCommand();
  else if (command === "diagram") await diagramCommand();
  else if (command === "motion") await motionCommand();
  else if (command === "transition") await transitionCommand();
  else if (command === "visual") await visualCommand();
  else if (command === "asset") await assetCommand();
  else if (command === "media") await mediaCommand();
  else if (command === "quality") await qualityCommand();
  else if (command === "validate") await validateCommand();
  else if (command === "build") await buildCommand();
  else if (command === "export") await exportCommand();
  else if (command === "pptx") await pptxCommand();
  else { console.log("slides-studio doctor | new [deck.html] | import --input deck.html --output normalized.html | styles list|inspect | recipes list|inspect|scaffold | layouts query|inspect|normalize | diagram render|validate|export | visual generate|edit|reconstruct | asset plan|generate | media reframe | motion analyze|apply | transition apply | quality | validate | build | export --format pdf|pptx|editable-pptx | pptx editable|review|validate|html-check|shapes|transitions"); if (command) process.exitCode = 1; }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
