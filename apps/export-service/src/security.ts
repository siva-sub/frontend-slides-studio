import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function isLoopbackOrigin(value: string | undefined): boolean {
  if (!value) return true;
  try { const url = new URL(value); return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname); } catch { return false; }
}

export async function containedRealPath(root: string, candidate: string): Promise<string> {
  const realRoot = await realpath(resolve(root));
  const realCandidate = await realpath(resolve(candidate));
  const child = relative(realRoot, realCandidate);
  if (child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))) return realCandidate;
  throw new Error("path escapes configured job root");
}

export async function validateSource(root: string, candidate: string, maxBytes = 20 * 1024 * 1024): Promise<string> {
  const path = await containedRealPath(root, candidate);
  const info = await stat(path);
  if (!info.isFile()) throw new Error("source must be a file");
  if (info.size > maxBytes) throw new Error(`source exceeds ${maxBytes} bytes`);
  if (!/\.html?$/i.test(path)) throw new Error("source must be HTML");
  return path;
}
