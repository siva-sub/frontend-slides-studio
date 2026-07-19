import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildServer } from "../dist/server.js";
import { exportEditablePptx } from "../../../packages/export/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const outputRoot = resolve(process.env.PPTX_EXTERNAL_REPORT_ROOT || join(repoRoot, ".slides-studio", "pptx-external-compat"));
const sourcesRoot = join(outputRoot, "sources");
const jobsRoot = join(outputRoot, "jobs");
const rendersRoot = join(outputRoot, "renders");
const reportPath = join(outputRoot, "report.json");
const pptRsRoot = resolve(process.env.PPT_RS_ROOT || "/home/siva/Projects/ppt-rs");
const officeCliRoot = resolve(process.env.OFFICECLI_ROOT || "/home/siva/Projects/OfficeCLI");
const expected = {
  officeCli: { version: "1.0.138", commit: "274f7e3ebf54631e8696df36d2f51bbba1db41d8" },
  pptRs: { version: "0.2.22", commit: "2e5a3f812711bfeeb729c5f7e5938c1367c3f480" },
};
const token = "external-pptx-compat-token";
const failures = [];
const artifacts = [];
const commands = [];
let upstreamSuite = {};
let app;

const command = (program, args, options = {}) => {
  const result = spawnSync(program, args, { encoding: "utf8", timeout: options.timeout ?? 180_000, cwd: options.cwd, env: { ...process.env, ...options.env } });
  const evidence = { program, args, cwd: options.cwd, status: result.status, signal: result.signal, stdout: result.stdout || "", stderr: result.stderr || "" };
  commands.push(evidence);
  return evidence;
};
const parseJson = (text, label) => {
  try { const start = text.indexOf("{"); return JSON.parse(start >= 0 ? text.slice(start) : text); }
  catch (error) { failures.push(`${label} did not emit valid JSON: ${error.message}`); return undefined; }
};
const check = (condition, message) => { if (!condition) failures.push(message); return Boolean(condition); };
const hashFile = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const near = (actual, expectedColor, tolerance = 12) => Array.isArray(actual) && actual.every((value, index) => Math.abs(value - expectedColor[index]) <= tolerance);
const cargoTestTotals = (output) => {
  const rows = [...output.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/g)].map((match) => match.slice(1).map(Number));
  return { resultGroups: rows.length, passed: rows.reduce((sum, row) => sum + row[0], 0), failed: rows.reduce((sum, row) => sum + row[1], 0), ignored: rows.reduce((sum, row) => sum + row[2], 0), measured: rows.reduce((sum, row) => sum + row[3], 0), filteredOut: rows.reduce((sum, row) => sum + row[4], 0) };
};

function htmlDeck({ width, height, slides, background = "#fffaf0" }) {
  const body = slides.map((slide, index) => `<section class="slide${index === 0 ? " active visible" : ""}" data-slide-id="${slide.id}">${slide.content}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171827}.deck-stage{position:absolute;left:0;top:0;width:${width}px;height:${height}px;background:${background}}.slide{position:absolute;inset:0;width:${width}px;height:${height}px;background:${background};overflow:hidden}.title{position:absolute;left:12%;top:34%;width:76%;height:22%;margin:0;font:700 ${Math.round(height * .1)}px Arial;color:#172033}.box{position:absolute;left:12%;top:67%;width:30%;height:12%;background:#0f766e;border:3px solid #134e4a}.decor{position:absolute;left:20%;top:20%;width:8%;height:10%;background:#9333ea;border-radius:50%}.marker{position:absolute;width:6%;height:9%}.tl{left:0;top:0;background:#e11d48}.tr{right:0;top:0;background:#16a34a}.bl{left:0;bottom:0;background:#2563eb}.br{right:0;bottom:0;background:#f05a36}</style></head><body><main class="deck-stage">${body}</main></body></html>`;
}
const stableSlide = (prefix, label, decoration = false) => ({ id: `${prefix}-slide`, content: `${decoration ? '<div class="decor"></div>' : ""}<h1 class="title" data-object-id="${prefix}-title">${label}</h1><div class="box" data-object-id="${prefix}-box"></div><div class="marker tl" data-object-id="${prefix}-tl"></div><div class="marker tr" data-object-id="${prefix}-tr"></div><div class="marker bl" data-object-id="${prefix}-bl"></div><div class="marker br" data-object-id="${prefix}-br"></div>` });
const noIdSlide = { id: "no-id-slide", content: '<div class="decor"></div><h1 class="title">No stable object IDs</h1><div class="marker tl"></div><div class="marker tr"></div><div class="marker bl"></div><div class="marker br"></div>' };

async function runJob(base, source, format) {
  const headers = { Authorization: `Bearer ${token}`, Origin: "http://127.0.0.1", "Content-Type": "application/json" };
  const response = await fetch(`${base}/jobs`, { method: "POST", headers, body: JSON.stringify({ source, format }) });
  if (response.status !== 202) throw new Error(`export submission failed (${response.status}): ${await response.text()}`);
  const job = await response.json();
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const stateResponse = await fetch(`${base}/jobs/${job.id}`, { headers });
    const state = await stateResponse.json();
    if (state.status === "complete") return state;
    if (state.status === "failed") throw new Error(state.error || `${format} export failed`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${format} export`);
}

async function buildHarness() {
  const root = join(outputRoot, "ppt-rs-harness");
  await mkdir(join(root, "src"), { recursive: true });
  const cargoPath = pptRsRoot.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  await writeFile(join(root, "Cargo.toml"), `[package]\nname = "slides-studio-pptx-validator"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nppt-rs = { path = "${cargoPath}" }\nserde_json = "1"\n`);
  await writeFile(join(root, "src", "main.rs"), `use ppt_rs::core::validate_package_bytes;\nuse ppt_rs::oxml::PptxRepair;\nuse serde_json::json;\nuse std::{env, fs};\nfn main() {\n let path = env::args().nth(1).expect("pptx path");\n let bytes = fs::read(&path).expect("read pptx");\n let report = validate_package_bytes(&bytes);\n let mut repair = PptxRepair::open(&path).expect("open repair validator");\n let repair_issues = repair.validate();\n let issues: Vec<_> = report.issues.iter().map(|i| json!({"severity":format!("{:?}",i.severity).to_lowercase(),"category":format!("{:?}",i.category),"path":i.path,"message":i.message})).collect();\n let repairs: Vec<_> = repair_issues.iter().map(|i| json!({"severity":i.severity(),"repairable":i.is_repairable(),"description":i.description()})).collect();\n println!("{}", serde_json::to_string_pretty(&json!({"valid":report.is_valid(),"errorCount":report.error_count(),"warningCount":report.warning_count(),"issues":issues,"repairIssueCount":repairs.len(),"repairIssues":repairs})).unwrap());\n}\n`);
  const built = command("cargo", ["build", "--quiet", "--manifest-path", join(root, "Cargo.toml")], { timeout: 600_000 });
  check(built.status === 0, `ppt-rs direct harness did not compile: ${built.stderr}`);
  return join(root, "target", "debug", "slides-studio-pptx-validator");
}

function pythonInspect(path) {
  const script = `import json,sys,zipfile\nfrom pptx import Presentation\np=sys.argv[1]\nprs=Presentation(p)\nslides=[]\nfor slide in prs.slides:\n names=[]; texts=[]; rotations=[]\n for shape in slide.shapes:\n  names.append(shape.name)\n  if hasattr(shape,'text') and shape.text: texts.append(shape.text)\n  rotations.append(getattr(shape,'rotation',None))\n slides.append({'names':names,'texts':texts,'rotations':rotations})\nwith zipfile.ZipFile(p) as z:\n xml=''.join(z.read(n).decode('utf-8','replace') for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml'))\n print(json.dumps({'slideCount':len(prs.slides),'width':prs.slide_width,'height':prs.slide_height,'ratio':prs.slide_width/prs.slide_height,'slides':slides,'xmlSignals':{'srcRectCount':xml.count('<a:srcRect'),'rotationCount':xml.count(' rot="'),'connectorNameCount':xml.count('flow-connector')}}))`;
  const result = command("python3", ["-c", script, path]);
  return { result, data: result.status === 0 ? parseJson(result.stdout, `python-pptx ${path}`) : undefined };
}

function pixelStats(path, x, y) {
  const script = `from PIL import Image,ImageStat\nimport json,sys\nim=Image.open(sys.argv[1]).convert('RGB')\nsmall=im.resize((64,36))\nstat=ImageStat.Stat(small)\nout={'width':im.width,'height':im.height,'stddev':sum(stat.stddev)/3,'uniqueColors':len(set(small.getdata()))}\nif len(sys.argv)>3:\n x=max(0,min(im.width-1,round(im.width*float(sys.argv[2])))); y=max(0,min(im.height-1,round(im.height*float(sys.argv[3])))); out['pixel']=im.getpixel((x,y))\nprint(json.dumps(out))`;
  const args = ["-c", script, path]; if (x !== undefined && y !== undefined) args.push(String(x), String(y));
  const result = command("python3", args);
  return result.status === 0 ? parseJson(result.stdout, `pixel inspection ${path}`) : undefined;
}

async function renderWithLibreOffice(artifact, expectedPages) {
  const root = join(rendersRoot, artifact.name, "libreoffice");
  const profile = join(root, "profile");
  await mkdir(profile, { recursive: true });
  const converted = command("libreoffice", [`-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--convert-to", "pdf", "--outdir", root, artifact.output], { timeout: 180_000 });
  const pdf = join(root, `${basename(artifact.output, extname(artifact.output))}.pdf`);
  check(converted.status === 0, `${artifact.name}: LibreOffice render failed: ${converted.stderr || converted.stdout}`);
  check(await stat(pdf).then((entry) => entry.size > 0).catch(() => false), `${artifact.name}: LibreOffice did not produce a PDF`);
  const info = command("pdfinfo", [pdf]);
  const pageMatch = /Pages:\s+(\d+)/.exec(info.stdout);
  const pages = Number(pageMatch?.[1]);
  check(info.status === 0 && pages === expectedPages, `${artifact.name}: LibreOffice page count ${pages} did not equal ${expectedPages}`);
  const prefix = join(root, "page");
  const raster = command("pdftoppm", ["-png", "-r", "72", pdf, prefix], { timeout: 180_000 });
  check(raster.status === 0, `${artifact.name}: LibreOffice PDF rasterization failed: ${raster.stderr}`);
  const pagePngs = (await readdir(root)).filter((name) => /^page-\d+\.png$/.test(name)).toSorted().map((name) => join(root, name));
  check(pagePngs.length === expectedPages, `${artifact.name}: expected ${expectedPages} rendered PNGs, found ${pagePngs.length}`);
  const stats = pagePngs.map((page) => ({ page, ...pixelStats(page) }));
  stats.forEach((item, index) => check(item.uniqueColors > 1 && item.stddev > 1, `${artifact.name}: LibreOffice page ${index + 1} appears blank`));
  return { pdf, pages, pagePngs, stats, stdout: converted.stdout, stderr: converted.stderr };
}

async function validateArtifact(artifact, harnessPath, pptcliPath) {
  const officeValidateCommand = command("officecli", ["validate", artifact.output, "--json"]);
  const officeValidate = parseJson(officeValidateCommand.stdout, `${artifact.name} OfficeCLI validate`);
  check(officeValidateCommand.status === 0 && officeValidate?.success === true, `${artifact.name}: OfficeCLI OpenXmlValidator reported errors`);

  const officeIssuesCommand = command("officecli", ["view", artifact.output, "issues", "--json"]);
  const officeIssues = parseJson(officeIssuesCommand.stdout, `${artifact.name} OfficeCLI issues`);
  check(officeIssuesCommand.status === 0 && officeIssues?.success === true && officeIssues?.data?.count === 0, `${artifact.name}: OfficeCLI document issues were reported`);
  const officeOutlineCommand = command("officecli", ["view", artifact.output, "outline"]);
  check(officeOutlineCommand.status === 0, `${artifact.name}: OfficeCLI could not read the outline`);
  const officeScreenshotCommand = command("officecli", ["view", artifact.output, "screenshot", "--grid", "auto"], { timeout: 180_000 });
  const screenshotSource = officeScreenshotCommand.stdout.split(/\r?\n/).find((line) => line.trim().endsWith(".png"))?.trim();
  const officeScreenshot = join(rendersRoot, artifact.name, "officecli.png");
  await mkdir(dirname(officeScreenshot), { recursive: true });
  if (check(officeScreenshotCommand.status === 0 && Boolean(screenshotSource), `${artifact.name}: OfficeCLI screenshot render failed`)) await copyFile(screenshotSource, officeScreenshot);
  const officeScreenshotStats = screenshotSource ? pixelStats(officeScreenshot) : undefined;
  check(Boolean(officeScreenshotStats && officeScreenshotStats.uniqueColors > 1 && officeScreenshotStats.stddev > 1), `${artifact.name}: OfficeCLI render appears blank`);

  const pptcliCommand = command(pptcliPath, ["validate", artifact.output, "--json"]);
  const pptcli = parseJson(pptcliCommand.stdout, `${artifact.name} ppt-rs CLI`);
  check(pptcliCommand.status === 0 && pptcli?.valid === true && pptcli?.error_count === 0, `${artifact.name}: ppt-rs CLI reported Error-severity findings`);

  const harnessCommand = command(harnessPath, [artifact.output]);
  const direct = parseJson(harnessCommand.stdout, `${artifact.name} ppt-rs direct harness`);
  check(harnessCommand.status === 0 && direct?.valid === true && direct?.errorCount === 0, `${artifact.name}: direct ppt-rs validation reported Error-severity findings`);
  check(direct?.repairIssueCount === 0, `${artifact.name}: ppt-rs repair validator found ${direct?.repairIssueCount ?? "unknown"} issue(s)`);

  const python = pythonInspect(artifact.output);
  check(python.result.status === 0 && Boolean(python.data), `${artifact.name}: python-pptx could not open the presentation`);
  check(python.data?.slideCount === artifact.expectedPages, `${artifact.name}: python-pptx page count ${python.data?.slideCount} did not equal ${artifact.expectedPages}`);
  check(Math.abs((python.data?.ratio ?? 0) - 16 / 9) < 0.00001, `${artifact.name}: python-pptx dimensions are not 16:9`);
  const names = python.data?.slides?.flatMap((slide) => slide.names) ?? [];
  const texts = python.data?.slides?.flatMap((slide) => slide.texts) ?? [];
  for (const name of artifact.expectedNames ?? []) check(names.includes(name), `${artifact.name}: expected native object name ${name} is missing`);
  for (const text of artifact.expectedText ?? []) check(texts.some((value) => value.includes(text)), `${artifact.name}: expected text ${text} is missing after parsing`);
  if (artifact.expectCrop) {
    check((python.data?.xmlSignals?.srcRectCount ?? 0) >= 1, `${artifact.name}: image crop XML is missing`);
    check((python.data?.xmlSignals?.rotationCount ?? 0) >= 1, `${artifact.name}: image rotation XML is missing`);
    check((python.data?.xmlSignals?.connectorNameCount ?? 0) >= 3, `${artifact.name}: connector object names are missing`);
  }

  const libreOffice = await renderWithLibreOffice(artifact, artifact.expectedPages);
  let cleanPlate;
  if (artifact.cleanPlatePath) {
    cleanPlate = pixelStats(artifact.cleanPlatePath, artifact.cleanPlateSample?.x, artifact.cleanPlateSample?.y);
    check(Boolean(cleanPlate && cleanPlate.uniqueColors > 1 && cleanPlate.stddev > 1), `${artifact.name}: clean plate appears blank`);
    if (artifact.cleanPlateSample) check(near(cleanPlate?.pixel, artifact.cleanPlateSample.color), `${artifact.name}: clean-plate evidence color was not preserved (${cleanPlate?.pixel})`);
  }

  return {
    name: artifact.name,
    kind: artifact.kind,
    output: artifact.output,
    sha256: await hashFile(artifact.output),
    bytes: (await stat(artifact.output)).size,
    expectedPages: artifact.expectedPages,
    exportReport: artifact.reportPath ? JSON.parse(await readFile(artifact.reportPath, "utf8")) : undefined,
    officeCli: { validate: officeValidate, issues: officeIssues, outline: officeOutlineCommand.stdout, screenshot: officeScreenshot, screenshotStats: officeScreenshotStats },
    pptRs: { cli: pptcli, direct },
    pythonPptx: python.data,
    libreOffice,
    ...(cleanPlate ? { cleanPlate: { path: artifact.cleanPlatePath, stats: cleanPlate } } : {}),
  };
}

async function main() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(sourcesRoot, { recursive: true });
  await mkdir(jobsRoot, { recursive: true });
  await mkdir(rendersRoot, { recursive: true });

  const officeVersionCommand = command("officecli", ["--version"]);
  const officeVersion = officeVersionCommand.stdout.trim().split(/\s+/).at(-1);
  const officeCommit = command("git", ["-C", officeCliRoot, "rev-parse", "HEAD"]).stdout.trim();
  const officeDirty = command("git", ["-C", officeCliRoot, "status", "--porcelain"]).stdout.trim();
  const pptCommit = command("git", ["-C", pptRsRoot, "rev-parse", "HEAD"]).stdout.trim();
  const pptDirty = command("git", ["-C", pptRsRoot, "status", "--porcelain"]).stdout.trim();
  const metadataCommand = command("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", join(pptRsRoot, "Cargo.toml")]);
  const metadata = parseJson(metadataCommand.stdout, "ppt-rs cargo metadata");
  const pptVersion = metadata?.packages?.find((item) => item.name === "ppt-rs")?.version;
  check(officeVersion === expected.officeCli.version, `OfficeCLI version ${officeVersion} did not equal ${expected.officeCli.version}`);
  check(officeCommit === expected.officeCli.commit && !officeDirty, `OfficeCLI source checkout is not clean at ${expected.officeCli.commit}`);
  check(pptVersion === expected.pptRs.version, `ppt-rs version ${pptVersion} did not equal ${expected.pptRs.version}`);
  check(pptCommit === expected.pptRs.commit && !pptDirty, `ppt-rs source checkout is not clean at ${expected.pptRs.commit}`);

  const nonMcpSuite = command("cargo", ["test", "--workspace", "--all-targets", "--features", "cli,web2ppt"], { cwd: pptRsRoot, timeout: 1_800_000 });
  const nonMcpTotals = cargoTestTotals(`${nonMcpSuite.stdout}\n${nonMcpSuite.stderr}`);
  check(nonMcpSuite.status === 0 && nonMcpTotals.failed === 0, `ppt-rs non-MCP suite failed (${nonMcpTotals.passed} passed, ${nonMcpTotals.failed} failed)`);
  const allFeaturesProbe = command("cargo", ["test", "--workspace", "--all-targets", "--all-features", "--no-run"], { cwd: pptRsRoot, timeout: 600_000 });
  const allFeaturesOutput = `${allFeaturesProbe.stdout}\n${allFeaturesProbe.stderr}`;
  const knownMcpDefect = allFeaturesProbe.status !== 0 && /unresolved import `rmcp::model::Content`|no `Content` in `model`/.test(allFeaturesOutput);
  check(allFeaturesProbe.status === 0 || knownMcpDefect, "ppt-rs all-features probe failed for a reason other than the documented rmcp Content API defect");
  upstreamSuite = {
    nonMcp: { command: "cargo test --workspace --all-targets --features cli,web2ppt", status: nonMcpSuite.status, ...nonMcpTotals },
    allFeatures: { requestedCommand: "cargo test --workspace --all-targets --all-features", executedProbeCommand: "cargo test --workspace --all-targets --all-features --no-run", compileProbeStatus: allFeaturesProbe.status, passed: allFeaturesProbe.status === 0, knownUpstreamDefect: knownMcpDefect, diagnostic: knownMcpDefect ? "Pinned source imports rmcp::model::Content, but locked rmcp 2.2.0 exposes ContentBlock." : undefined },
  };

  const pptcliBuild = command("cargo", ["build", "--quiet", "--manifest-path", join(pptRsRoot, "Cargo.toml"), "--features", "cli", "--bin", "pptcli"], { timeout: 600_000 });
  check(pptcliBuild.status === 0, `ppt-rs CLI did not compile: ${pptcliBuild.stderr}`);
  const pptcliPath = join(pptRsRoot, "target", "debug", "pptcli");
  const harnessPath = await buildHarness();

  const sourceFiles = {
    raster1280: join(sourcesRoot, "raster-1280.html"),
    raster1920: join(sourcesRoot, "raster-1920.html"),
    native: join(sourcesRoot, "editable-native.html"),
    css: join(sourcesRoot, "editable-css-decoration.html"),
    noIds: join(sourcesRoot, "editable-no-ids.html"),
    multi: join(sourcesRoot, "editable-multi-slide.html"),
  };
  await writeFile(sourceFiles.raster1280, htmlDeck({ width: 1280, height: 720, slides: [stableSlide("raster-1280", "Raster 1280 × 720")] }));
  await writeFile(sourceFiles.raster1920, htmlDeck({ width: 1920, height: 1080, slides: [stableSlide("raster-1920", "Raster 1920 × 1080")] }));
  await writeFile(sourceFiles.native, htmlDeck({ width: 1280, height: 720, slides: [stableSlide("native", "Native ✓ &amp; &lt;escaped&gt;")] }));
  await writeFile(sourceFiles.css, htmlDeck({ width: 1280, height: 720, slides: [stableSlide("css", "CSS clean plate", true)] }));
  await writeFile(sourceFiles.noIds, htmlDeck({ width: 1280, height: 720, slides: [noIdSlide] }));
  await writeFile(sourceFiles.multi, htmlDeck({ width: 1280, height: 720, slides: [stableSlide("multi-1", "Multi slide one", true), stableSlide("multi-2", "Multi slide two", true)] }));

  app = buildServer({ token, sourceRoot: outputRoot, jobRoot: jobsRoot, logger: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address !== "object") throw new Error("export service did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  const raster1280 = await runJob(base, sourceFiles.raster1280, "pptx");
  const raster1920 = await runJob(base, sourceFiles.raster1920, "pptx");
  const native = await runJob(base, sourceFiles.native, "editable-pptx");
  const css = await runJob(base, sourceFiles.css, "editable-pptx");
  const noIds = await runJob(base, sourceFiles.noIds, "editable-pptx");
  const multi = await runJob(base, sourceFiles.multi, "editable-pptx");

  const cssCleanPlate = join(dirname(css.output), "editable-clean-plates", (await readdir(join(dirname(css.output), "editable-clean-plates")))[0]);
  const noIdsCleanPlate = join(dirname(noIds.output), "editable-clean-plates", (await readdir(join(dirname(noIds.output), "editable-clean-plates")))[0]);
  const multiCleanPlates = (await readdir(join(dirname(multi.output), "editable-clean-plates"))).toSorted().map((name) => join(dirname(multi.output), "editable-clean-plates", name));

  const mediaPath = join(sourcesRoot, "media.png");
  const imageCreated = command("python3", ["-c", "from PIL import Image,ImageDraw;import sys\nim=Image.new('RGB',(400,200),'#fef3c7');d=ImageDraw.Draw(im);d.rectangle((0,0,199,199),fill='#dc2626');d.rectangle((200,0,399,199),fill='#2563eb');im.save(sys.argv[1])", mediaPath]);
  check(imageCreated.status === 0, `media fixture creation failed: ${imageCreated.stderr}`);
  const qualityPath = join(sourcesRoot, "passing-quality.json");
  await writeFile(qualityPath, JSON.stringify({ schemaVersion: 1, id: "external-compat-quality", canvas: { width: 1000, height: 563 }, mode: "canonical", strict: true, issues: [], passed: true, summary: { total: 0, info: 0, warning: 0, error: 0, critical: 0, hard: 0 } }));
  const mediaOutput = join(outputRoot, "editable-media-connectors.pptx");
  await exportEditablePptx({ schemaVersion: 1, title: "Media and connectors", slides: [{ id: "media-slide", width: 1000, height: 562.5, objects: [
    { id: "media-title", sourceId: "media-title", sourceKind: "dom", type: "text", x: 70, y: 45, width: 500, height: 70, zIndex: 1, native: true, text: "Cropped media & connectors", fontFace: "Arial", fontSize: 28, color: "#172033", bold: true },
    { id: "hero-media", sourceId: "hero-media", sourceKind: "dom", type: "image", x: 90, y: 160, width: 360, height: 250, zIndex: 2, native: true, path: mediaPath, fit: "cover", crop: { x: 0.1, y: 0.05, width: 0.75, height: 0.9 }, focal: { x: 0.72, y: 0.5 }, rotation: 7, alt: "Red and blue crop", layoutSlot: "hero", sourceDimensions: { width: 400, height: 200 } },
    { id: "target-box", sourceId: "target-box", sourceKind: "diagram", type: "shape", x: 670, y: 210, width: 190, height: 105, zIndex: 3, native: true, shape: "rounded-rectangle", fill: "#dbeafe", stroke: "#1d4ed8" },
    { id: "flow-connector", sourceId: "flow-connector", sourceKind: "diagram", type: "connector", x: 450, y: 230, width: 220, height: 100, zIndex: 4, native: true, points: [{ x: 450, y: 285 }, { x: 560, y: 285 }, { x: 560, y: 262 }, { x: 670, y: 262 }], stroke: "#1d4ed8", endArrow: true, label: "flow" },
  ] }] }, mediaOutput, { qualityReport: qualityPath });

  const matrix = [
    { name: "raster-1280", kind: "raster", output: raster1280.output, reportPath: `${raster1280.output}.report.json`, expectedPages: 1 },
    { name: "raster-1920", kind: "raster", output: raster1920.output, reportPath: `${raster1920.output}.report.json`, expectedPages: 1 },
    { name: "editable-native", kind: "editable", output: native.output, reportPath: native.exportReport, expectedPages: 1, expectedNames: ["native-title", "native-box"], expectedText: ["Native ✓ & <escaped>"] },
    { name: "editable-css-decoration", kind: "editable", output: css.output, reportPath: css.exportReport, expectedPages: 1, expectedNames: ["css-title", "css-box"], cleanPlatePath: cssCleanPlate, cleanPlateSample: { x: .24, y: .25, color: [147, 51, 234] } },
    { name: "editable-no-ids", kind: "editable", output: noIds.output, reportPath: noIds.exportReport, expectedPages: 1, expectedNames: ["no-id-slide-clean-plate"], cleanPlatePath: noIdsCleanPlate },
    { name: "editable-multi-slide", kind: "editable", output: multi.output, reportPath: multi.exportReport, expectedPages: 2, expectedNames: ["multi-1-title", "multi-2-title"], expectedText: ["Multi slide one", "Multi slide two"], cleanPlatePath: multiCleanPlates[0] },
    { name: "editable-media-connectors", kind: "editable", output: mediaOutput, reportPath: `${mediaOutput}.report.json`, expectedPages: 1, expectedNames: ["media-title", "hero-media", "target-box", "flow-connector-1", "flow-connector-2", "flow-connector-3", "flow-connector-label"], expectedText: ["Cropped media & connectors", "flow"], expectCrop: true },
  ];

  for (const artifact of matrix) artifacts.push(await validateArtifact(artifact, harnessPath, pptcliPath));

  for (const artifact of artifacts.filter((item) => item.kind === "editable")) {
    check(artifact.exportReport?.standard?.standard === "ISO/IEC 29500" && artifact.exportReport?.standard?.conformance === "transitional" && artifact.exportReport?.standard?.packageValidated === true, `${artifact.name}: internal compatibility evidence is missing`);
  }
  const noIdReport = artifacts.find((item) => item.name === "editable-no-ids")?.exportReport;
  check(noIdReport?.nativeObjects === 0 && noIdReport?.fallbackObjects === 1, "editable-no-ids: expected one full-slide fallback and no native objects");
  const mediaReport = artifacts.find((item) => item.name === "editable-media-connectors")?.exportReport;
  const mediaInventory = mediaReport?.objectInventory?.find((item) => item.objectId === "hero-media")?.media;
  check(mediaInventory?.rotation === 7 && mediaInventory?.crop?.width === .75 && mediaInventory?.layoutSlot === "hero", "editable-media-connectors: crop, rotation, or layout-slot metadata was lost");
}

const startedAt = new Date().toISOString();
try {
  await main();
} catch (error) {
  failures.push(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  if (app) await app.close().catch(() => undefined);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    statement: "ISO/IEC 29500 Transitional package compatibility validation; not formal certification.",
    validators: {
      officeCli: { ...expected.officeCli, source: officeCliRoot },
      pptRs: { ...expected.pptRs, source: pptRsRoot, directApi: "ppt_rs::validate_package_bytes", repairApi: "ppt_rs::oxml::PptxRepair::validate" },
      pythonPptx: command("python3", ["-c", "import pptx; print(pptx.__version__)"]).stdout.trim(),
      libreOffice: command("libreoffice", ["--version"]).stdout.trim(),
    },
    upstreamSuite,
    artifactCount: artifacts.length,
    artifacts,
    passed: failures.length === 0,
    failures,
    commandCount: commands.length,
    commands,
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, reportPath, artifactCount: artifacts.length, failures }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
