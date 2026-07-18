import { access, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseHTML } from "linkedom";
import type { QualityIssue, QualityReport } from "@slides-studio/protocol";
import { buildQualityReport } from "./report.js";

export interface StaticAuditOptions {
  id: string;
  deckId?: string;
  canvas?: { width: number; height: number };
  mode?: "canonical" | "imported";
  strict?: boolean;
  assetRoot?: string;
}

function duplicateIssues(elements: Element[], value: (element: Element) => string | undefined): QualityIssue[] {
  const counts = new Map<string, number>();
  for (const element of elements) { const id = value(element); if (id) counts.set(id, (counts.get(id) ?? 0) + 1); }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ category: "duplicate-id", severity: "error", hard: true, objectId: id, reason: `Identifier ${id} appears ${count} times.`, evidence: [] }));
}

function contained(root: string, candidate: string): string | null {
  const target = resolve(root, candidate);
  const child = relative(resolve(root), target);
  return child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child) ? null : target;
}

function referencedAssets(document: Document): Array<{ element: Element; value: string }> {
  const references: Array<{ element: Element; value: string }> = [];
  document.querySelectorAll("img[src],video[src],video[poster],audio[src],source[src],script[src],link[href],image[href],use[href]").forEach((element) => {
    for (const attribute of ["src", "poster", "href"]) { const value = element.getAttribute(attribute); if (value) references.push({ element, value }); }
  });
  document.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    for (const match of element.getAttribute("style")?.matchAll(/url\(["']?([^"')]+)["']?\)/g) ?? []) if (match[1]) references.push({ element, value: match[1] });
  });
  document.querySelectorAll("style").forEach((element) => {
    for (const match of element.textContent?.matchAll(/url\(["']?([^"')]+)["']?\)/g) ?? []) if (match[1]) references.push({ element, value: match[1] });
  });
  return references;
}

export async function auditStaticHtml(html: string, options: StaticAuditOptions): Promise<QualityReport> {
  const { document } = parseHTML(html);
  const mode = options.mode ?? "canonical";
  const strict = options.strict ?? false;
  const issues: QualityIssue[] = [
    ...duplicateIssues(Array.from(document.querySelectorAll("[id]")), (element) => element.id || undefined),
    ...duplicateIssues(Array.from(document.querySelectorAll("[data-object-id]")), (element) => (element as HTMLElement).dataset.objectId),
  ];
  const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
  const stage = document.querySelector<HTMLElement>(".deck-stage");
  if (!stage || slides.length === 0) issues.push({ category: "stage-bounds", severity: "critical", hard: true, reason: "HTML must contain a .deck-stage and at least one .slide.", evidence: [] });
  for (const clone of Array.from(document.querySelectorAll<HTMLElement>("[data-transition-clone]"))) {
    if (clone.querySelector("script,[data-object-id],[autofocus],[contenteditable=true],[tabindex]:not([tabindex='-1'])") || clone.matches("[data-object-id],[autofocus],[contenteditable=true],[tabindex]:not([tabindex='-1'])")) issues.push({ category: "unsafe-clone-content", severity: "critical", hard: true, objectId: clone.id || undefined, reason: "Authored transition clone contains executable, focusable, or duplicate content.", evidence: [] });
  }
  for (const reference of referencedAssets(document)) {
    const value = reference.value.trim();
    if (!value || value.startsWith("#") || value.startsWith("data:") || value.startsWith("blob:")) continue;
    const objectId = (reference.element as HTMLElement).dataset.objectId;
    if (/^(?:https?:)?\/\//i.test(value)) {
      issues.push({ category: "missing-asset", severity: mode === "imported" && !strict ? "warning" : "error", hard: mode === "canonical" || strict, ...(objectId ? { objectId } : {}), reason: `Remote asset is not offline-safe: ${value}.`, evidence: [] });
      continue;
    }
    if (!options.assetRoot) continue;
    const clean = value.replace(/[?#].*$/, "");
    const target = contained(options.assetRoot, clean);
    if (!target) {
      issues.push({ category: "missing-asset", severity: "error", hard: true, ...(objectId ? { objectId } : {}), reason: `Asset path escapes the configured root: ${value}.`, evidence: [] });
      continue;
    }
    try {
      await access(target);
      const info = await stat(target);
      if (!info.isFile()) throw new Error("not a file");
    } catch {
      issues.push({ category: "missing-asset", severity: mode === "imported" && !strict ? "warning" : "error", hard: mode === "canonical" || strict, ...(objectId ? { objectId } : {}), reason: `Local asset is missing: ${value}.`, evidence: [] });
    }
  }
  const width = options.canvas?.width ?? (Number.parseInt(stage?.style.width || "", 10) || 1920);
  const height = options.canvas?.height ?? (Number.parseInt(stage?.style.height || "", 10) || 1080);
  return buildQualityReport({ id: options.id, ...(options.deckId ? { deckId: options.deckId } : {}), canvas: { width, height }, mode, strict, issues });
}
