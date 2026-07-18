import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { isLoopbackOrigin, validateSource } from "./security.js";

describe("export security", () => {
  it("accepts loopback origins and rejects foreign origins", () => { expect(isLoopbackOrigin("http://127.0.0.1:4173")).toBe(true); expect(isLoopbackOrigin("https://evil.example")).toBe(false); });
  it("rejects traversal and symlink escape", async () => {
    const root = join(tmpdir(), `slides-studio-${Date.now()}`); const outside = `${root}-outside.html`; await mkdir(root); await writeFile(join(root, "deck.html"), "<html></html>"); await writeFile(outside, "<html></html>"); await symlink(outside, join(root, "escape.html"));
    await expect(validateSource(root, join(root, "deck.html"))).resolves.toContain("deck.html");
    await expect(validateSource(root, join(root, "escape.html"))).rejects.toThrow(/escapes/);
  });
});
