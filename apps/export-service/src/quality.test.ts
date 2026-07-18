import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

const roots: string[] = [];
const token = "quality-test-token";
const headers = { authorization: `Bearer ${token}`, origin: "http://127.0.0.1:5173", "content-type": "application/json" };
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const cleanDeck = '<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}.deck-stage{position:relative;width:1280px;height:720px}.slide{position:absolute;inset:0;width:1280px;height:720px}.title{position:absolute;left:100px;top:100px;width:600px;height:100px}</style></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="slide-01"><h1 class="title" data-object-id="title">Clean deck</h1></section></main></body></html>';
const brokenDeck = '<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}.deck-stage{position:relative;width:1280px;height:720px}.slide{display:none;position:absolute;inset:0;width:1280px;height:720px}.slide.active{display:block}.title{position:absolute;left:100px;top:100px;width:600px;height:100px}.card{position:absolute;width:420px;height:220px}.a{left:100px;top:100px}.b{left:260px;top:160px}</style></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="opening"><h1 class="title" data-object-id="title">Clean opening</h1></section><section class="slide" data-slide-id="appendix-final" aria-hidden="true"><div class="card a" data-object-id="a">A</div><div class="card b" data-object-id="b">B</div></section></main></body></html>';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "slides-studio-quality-service-")); roots.push(root);
  const jobs = join(root, "jobs"); await mkdir(jobs);
  const clean = join(root, "clean.html"); const broken = join(root, "broken.html");
  await writeFile(clean, cleanDeck); await writeFile(broken, brokenDeck);
  const app = buildServer({ token, sourceRoot: root, jobRoot: jobs, logger: false });
  return { app, clean, broken };
}

async function waitForJob(app: ReturnType<typeof buildServer>, id: string) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/jobs/${id}`, headers });
    const job = response.json();
    if (job.status === "complete" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${id} timed out`);
}

describe("rendered quality service", () => {
  it("returns a clean audit-only report with screenshot evidence", async () => {
    const { app, clean } = await fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/quality", headers, payload: { source: clean, strict: true } });
      expect(response.statusCode, response.body).toBe(200);
      const result = response.json();
      expect(result.report.passed).toBe(true);
      expect(result.report.summary.total).toBe(0);
      expect(result.screenshots).toEqual(["quality/slide-01.png"]);
      expect(JSON.parse(await readFile(result.reportPath, "utf8")).passed).toBe(true);
    } finally { await app.close(); }
  }, 30_000);

  it("audits a hidden second slide, maps arbitrary IDs to evidence, and blocks only in strict mode", async () => {
    const { app, broken } = await fixture();
    try {
      const strictResponse = await app.inject({ method: "POST", url: "/jobs", headers, payload: { source: broken, format: "pdf", qualityGate: "strict" } });
      expect(strictResponse.statusCode).toBe(202);
      const strictJob = await waitForJob(app, strictResponse.json().id);
      expect(strictJob.status).toBe("failed");
      expect(strictJob.error).toMatch(/strict quality gate failed/);
      expect(strictJob.output).toBeUndefined();
      const strictReport = JSON.parse(await readFile(strictJob.qualityReport, "utf8"));
      expect(strictReport.passed).toBe(false);
      const secondSlideOverlap = strictReport.issues.find((issue: { category: string; slideId?: string }) => issue.category === "object-overlap" && issue.slideId === "appendix-final");
      expect(secondSlideOverlap).toBeDefined();
      expect(secondSlideOverlap.evidence).toEqual(["quality/slide-02.png"]);

      const reportResponse = await app.inject({ method: "POST", url: "/jobs", headers, payload: { source: broken, format: "pdf" } });
      const reportJob = await waitForJob(app, reportResponse.json().id);
      expect(reportJob.status).toBe("complete");
      expect(reportJob.qualityPassed).toBe(true);
      expect(reportJob.output).toMatch(/\.pdf$/);
      expect(reportJob.qualityReport).toMatch(/quality-report\.json$/);
      const report = JSON.parse(await readFile(reportJob.qualityReport, "utf8"));
      expect(report.issues.find((issue: { slideId?: string }) => issue.slideId === "appendix-final")?.evidence).toEqual(["quality/slide-02.png"]);
    } finally { await app.close(); }
  }, 60_000);
});
