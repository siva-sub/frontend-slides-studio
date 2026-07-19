import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];
const run = (args: string[]) => spawnSync("pnpm", ["exec", "tsx", "src/index.ts", ...args], { cwd: packageRoot, encoding: "utf8" });
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture(content: string): { input: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "slides-studio-pptx-html-check-")); roots.push(root);
  const input = join(root, "deck.html"); writeFileSync(input, content); return { input, root };
}

describe("CLI PPTX HTML readiness", () => {
  it("writes a native-oriented readiness report", () => {
    const { input, root } = fixture('<main class="deck-stage"><section class="slide" data-slide-id="s1" data-pptx-intent="native-oriented"><h1 data-object-id="title">Title</h1><div data-object-id="shape" data-pptx-shape="chevron"></div></section></main>');
    const output = join(root, "report.json"); const result = run(["pptx", "html-check", "--input", input, "--strict", "--output", output]);
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({ status: "native-oriented", ready: true, strictReady: true, nativeCandidates: 1, runtimeDependent: 1 });
  }, 30_000);

  it("allows intentional hybrid warnings by default and rejects them in strict mode", () => {
    const { input } = fixture('<main class="deck-stage"><section class="slide" data-slide-id="s1" data-pptx-intent="hybrid">Untracked text<video data-object-id="clip"></video></section></main>');
    const normal = run(["pptx", "html-check", "--input", input]); expect(normal.status, normal.stderr).toBe(0); expect(JSON.parse(normal.stdout).status).toBe("hybrid");
    const strict = run(["pptx", "html-check", "--input", input, "--strict"]); expect(strict.status).toBe(1); expect(JSON.parse(strict.stdout).strictReady).toBe(false);
  }, 30_000);

  it("rejects blocking identity errors without strict mode", () => {
    const { input } = fixture('<section class="slide"><div data-pptx-shape="chevron"></div></section>');
    const result = run(["pptx", "html-check", "--input", input]); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).status).toBe("blocked");
  }, 30_000);
});
