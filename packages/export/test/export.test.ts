import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveEditablePptx, buildAuthorHtml, buildShareHtml, exportEditablePptx } from "../src/index.js";

const digest = (value: string | Buffer) => ({ algorithm: "sha256" as const, value: createHash("sha256").update(value).digest("hex") });
const passingQuality = { schemaVersion: 1, id: "quality", canvas: { width: 1920, height: 1080 }, mode: "canonical", strict: true, issues: [], passed: true, summary: { total: 0, info: 0, warning: 0, error: 0, critical: 0, hard: 0 } };

describe("HTML builds", () => {
  const source = '<html><head></head><body><section class="slide"><button onclick="bad()" data-authoring-ui>Editor</button><a href="javascript:bad()">Bad</a></section><script data-private-metadata>{}</script></body></html>';
  it("embeds runtime and metadata in author output", () => { const html = buildAuthorHtml(source, "window.x=1", { schemaVersion: 1 }); expect(html).toContain("data-deck-goal"); expect(html).toContain("window.x=1"); });
  it("strips authoring chrome, private metadata and dangerous attributes from share output", () => { const html = buildShareHtml(source, "window.x=1"); expect(html).not.toContain("data-authoring-ui"); expect(html).not.toContain("onclick"); expect(html).not.toContain("javascript:bad"); expect(html).toContain('data-slides-studio-build="share"'); });

  it("normalizes legacy limitations but rejects stale or incomplete approval evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "slides-studio-legacy-review-"));
    try {
      const output = join(root, "deck.pptx"); const renderEvidence = join(root, "render.pdf"); const qualityReport = join(root, "quality-report.json"); const reportPath = join(root, "legacy.report.json");
      const pptxBytes = Buffer.from("PK\u0003\u0004fresh-pptx"); const pdfBytes = Buffer.from("%PDF-1.4\nfresh-render"); const qualityJson = JSON.stringify(passingQuality);
      await writeFile(output, pptxBytes); await writeFile(renderEvidence, pdfBytes); await writeFile(qualityReport, qualityJson);
      const report = { status: "rendered_pending_manual_review", mode: "editable", output, slideCount: 1, nativeObjects: 2, fallbackObjects: 0, fallbackReasons: {}, qualityReport, renderEvidence, artifactHashes: { output: digest(pptxBytes), renderEvidence: digest(pdfBytes), qualityReport: digest(qualityJson) }, manualVisualReviewRequired: true };
      await writeFile(reportPath, JSON.stringify(report));
      const approved = await approveEditablePptx(reportPath, { reviewer: "Reviewer", evidence: "Viewed render.pdf" });
      expect(approved.status).toBe("passed"); expect(approved.limitations.join(" ")).toMatch(/native PowerPoint animation/); expect(approved.qualityReport).toBe(qualityReport);

      const stalePath = join(root, "stale.report.json"); await writeFile(stalePath, JSON.stringify(report)); await writeFile(output, Buffer.from("PK\u0003\u0004tampered"));
      await expect(approveEditablePptx(stalePath, { reviewer: "Reviewer", evidence: "Viewed" })).rejects.toThrow(/changed after render-back/);
      const incompletePath = join(root, "incomplete.report.json"); await writeFile(incompletePath, JSON.stringify({ ...report, artifactHashes: undefined }));
      await expect(approveEditablePptx(incompletePath, { reviewer: "Reviewer", evidence: "Viewed" })).rejects.toThrow(/evidence hashes/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("writes normalized media crop metadata and honest motion limitations", async () => {
    const root = await mkdtemp(join(tmpdir(), "slides-studio-export-crop-"));
    try {
      const image = join(root, "pixel.png");
      const output = join(root, "cropped.pptx"); const qualityReport = join(root, "quality-report.json");
      await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")); await writeFile(qualityReport, JSON.stringify(passingQuality));
      const report = await exportEditablePptx({ schemaVersion: 1, title: "Crop", slides: [{ id: "s1", width: 1000, height: 500, objects: [{ id: "hero", sourceId: "hero", sourceKind: "dom", type: "image", x: 100, y: 50, width: 600, height: 300, zIndex: 1, native: true, path: image, fit: "cover", crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 }, rotation: -5, alt: "Hero crop", layoutSlot: "hero" }] }] }, output, { qualityReport });
      expect(report.limitations.join(" ")).toMatch(/not exported|static frames/i); expect(report.qualityReport).toBe(qualityReport); expect(report.objectInventory[0]?.media?.layoutSlot).toBe("hero"); expect(report.artifactHashes?.qualityReport).toBeDefined();
      const unzip = spawnSync("python3", ["-c", "import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read('ppt/slides/slide1.xml').decode())", output], { encoding: "utf8" });
      expect(unzip.status, unzip.stderr).toBe(0);
      expect(unzip.stdout).toContain('<a:srcRect l="25000" r="25000" t="10000" b="10000"/>');
      expect(unzip.stdout).toContain('descr="Hero crop"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
