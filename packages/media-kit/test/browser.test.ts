import { describe, expect, it } from "vitest";
import { stageBrowserMedia, type BrowserDirectoryHandle, type BrowserFileHandle, type BrowserWritableFile } from "../src/browser.js";

class MemoryFileHandle implements BrowserFileHandle {
  content: Blob = new Blob([]);
  constructor(private readonly name: string) {}
  async getFile(): Promise<File> { return new File([this.content], this.name, { type: this.content.type }); }
  async createWritable(): Promise<BrowserWritableFile> {
    return {
      write: async (data) => { this.content = data instanceof Blob ? data : typeof data === "string" ? new Blob([data], { type: "application/json" }) : new Blob([data]); },
      close: async () => undefined,
    };
  }
}

class MemoryDirectoryHandle implements BrowserDirectoryHandle {
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<MemoryDirectoryHandle> {
    const found = this.directories.get(name);
    if (found) return found;
    if (!options.create) throw new DOMException(`${name} missing`, "NotFoundError");
    const created = new MemoryDirectoryHandle(); this.directories.set(name, created); return created;
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MemoryFileHandle> {
    const found = this.files.get(name);
    if (found) return found;
    if (!options.create) throw new DOMException(`${name} missing`, "NotFoundError");
    const created = new MemoryFileHandle(name); this.files.set(name, created); return created;
  }
}

async function fileAt(root: MemoryDirectoryHandle, path: string): Promise<File> {
  const segments = path.split("/"); const name = segments.pop()!;
  let directory = root;
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
  return (await directory.getFileHandle(name)).getFile();
}

describe("browser folder staging", () => {
  it("writes relative hash-named media and a deduplicated manifest", async () => {
    const root = new MemoryDirectoryHandle();
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>'], { type: "image/svg+xml" });
    const first = await stageBrowserMedia(root, svg, "产品 主图.svg", { declaredMime: "image/svg+xml", now: () => "2026-01-01T00:00:00.000Z" });
    expect(first.path).toMatch(/^assets\/user-media\/[a-f0-9]{2}\/media-[a-f0-9]{8}\.svg$/);
    expect(first.entry.width).toBe(40);
    expect(first.entry.height).toBe(20);
    expect(await (await fileAt(root, first.path)).text()).toContain("<svg");
    const manifest = JSON.parse(await (await fileAt(root, "assets/user-media/manifest.json")).text());
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].path).toBe(first.path);

    const second = await stageBrowserMedia(root, svg, "renamed.svg", { declaredMime: "image/svg+xml" });
    expect(second.deduplicated).toBe(true);
    expect(second.path).toBe(first.path);
    expect(second.manifest.entries).toHaveLength(1);
  });
});
