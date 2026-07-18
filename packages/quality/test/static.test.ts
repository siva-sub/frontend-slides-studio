import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditStaticHtml } from "../src/static.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("static HTML quality audit", () => {
  it("reports structural, duplicate, clone, remote, missing, and escaping assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "slides-quality-static-")); roots.push(root);
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "ok.png"), "ok");
    const html = '<!doctype html><html><body><div id="dup"></div><div id="dup"></div><main class="deck-stage" style="width:1280px;height:720px"><section class="slide"><img data-object-id="hero" src="assets/ok.png"><img data-object-id="hero" src="assets/missing.png"><img src="https://example.com/remote.png"><img src="../escape.png"><div data-transition-clone><button data-object-id="clone">Unsafe</button><script>bad()</script></div></section></main></body></html>';
    const report = await auditStaticHtml(html, { id: "static", canvas: { width: 1280, height: 720 }, assetRoot: root, strict: true });
    const categories = report.issues.map((issue) => issue.category);
    expect(categories).toContain("duplicate-id");
    expect(categories).toContain("unsafe-clone-content");
    expect(report.issues.filter((issue) => issue.category === "missing-asset")).toHaveLength(3);
    expect(report.passed).toBe(false);
  });

  it("keeps a complete offline deck clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "slides-quality-clean-")); roots.push(root);
    await writeFile(join(root, "hero.png"), "ok");
    const html = '<!doctype html><html><body><main class="deck-stage" style="width:1920px;height:1080px"><section class="slide" data-slide-id="s1"><img data-object-id="hero" src="hero.png"></section></main></body></html>';
    const report = await auditStaticHtml(html, { id: "clean", assetRoot: root, canvas: { width: 1920, height: 1080 } });
    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
  });
});
