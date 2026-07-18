import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", "packages/cli/src/index.ts", ...args], { cwd: projectRoot, env });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject); child.once("close", (code) => resolveRun({ code: code ?? -1, stdout, stderr }));
  });
}

describe("quality CLI integration", () => {
  it("writes audit evidence and returns nonzero for strict quality/export failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "slides-quality-cli-")); roots.push(root);
    const jobs = join(root, "jobs"); await mkdir(jobs);
    const broken = join(root, "broken.html"); const reportOutput = join(root, "cli-quality.json");
    await writeFile(broken, '<!doctype html><html><head><style>.deck-stage,.slide{position:relative;width:1280px;height:720px}.a,.b{position:absolute;width:400px;height:250px}.a{left:100px;top:100px}.b{left:250px;top:180px}</style></head><body><main class="deck-stage"><section class="slide active visible"><div id="dup" class="a" data-object-id="a">A</div><div id="dup" class="b" data-object-id="b">B</div></section></main></body></html>');
    const token = "cli-quality-token";
    const app = buildServer({ token, sourceRoot: root, jobRoot: jobs, logger: false });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const address = app.server.address(); if (!address || typeof address === "string") throw new Error("server did not bind");
      const service = `http://127.0.0.1:${address.port}`;
      const env = { ...process.env, SLIDES_STUDIO_EXPORT_TOKEN: token };
      const quality = await runCli(["quality", "--input", broken, "--service", service, "--strict", "--output", reportOutput], env);
      expect(quality.code, quality.stderr).toBe(1);
      const report = JSON.parse(await readFile(reportOutput, "utf8"));
      expect(report.passed).toBe(false);
      expect(report.issues.map((issue: { category: string }) => issue.category)).toContain("duplicate-id");
      expect(quality.stderr).toContain("reportPath");

      const exported = await runCli(["export", "--input", broken, "--format", "pdf", "--service", service, "--quality-gate", "strict", "--poll-ms", "20"], env);
      expect(exported.code).toBe(1);
      expect(exported.stdout).toContain('"qualityReport"');
      expect(exported.stderr).toContain("strict quality gate failed");
    } finally { await app.close(); }
  }, 60_000);
});
