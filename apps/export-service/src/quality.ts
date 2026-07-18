import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { QualityIssue, QualityReport } from "@slides-studio/protocol";
import { buildQualityReport, mergeQualityReports } from "@slides-studio/quality";
import { collectRenderedAudit } from "@slides-studio/quality/browser";
import { auditStaticHtml } from "@slides-studio/quality/static";

export interface QualityAuditOptions {
  id: string;
  source: string;
  outputDir: string;
  mode?: "canonical" | "imported";
  strict?: boolean;
  requireSettled?: boolean;
}

export interface QualityScreenshotEvidence { slideId: string; path: string; }

interface PresentationState {
  htmlStyle: string | null;
  bodyStyle: string | null;
  exportState: string | null;
  slideAttributes: Array<{ className: string | null; style: string | null; ariaHidden: string | null }>;
  stageStyles: Array<string | null>;
}

export interface QualityAuditResult {
  report: QualityReport;
  reportPath: string;
  screenshots: QualityScreenshotEvidence[];
}

export async function settlePageForExport(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const runtime = (window as typeof window & { SlidesStudio?: { freezeForExport(options?: unknown): Promise<void> } }).SlidesStudio;
    if (runtime?.freezeForExport) await runtime.freezeForExport({ posterProgress: 0.5, mediaPosterTime: 0 });
    else {
      document.documentElement.dataset.exportState = "settling";
      document.querySelectorAll("[data-transition-clone]").forEach((clone) => clone.remove());
      document.getAnimations().forEach((animation) => { try { animation.finish(); } catch { animation.pause(); } });
      document.querySelectorAll<HTMLMediaElement>("video,audio").forEach((media) => { media.pause(); const time = Number(media.dataset.posterTime ?? 0); if (media.readyState >= 1) media.currentTime = Math.min(time, media.duration || time); });
      await document.fonts?.ready;
      document.documentElement.dataset.exportState = "settled";
    }
  });
  await page.addStyleTag({ content: "[data-authoring-ui],.presenter-tools,.slides-studio-chrome{display:none!important}*{animation-play-state:paused!important;transition-duration:0s!important}" });
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), undefined, { timeout: 10_000 }).catch(() => undefined);
}

async function snapshotPresentationState(page: Page): Promise<PresentationState> {
  return page.evaluate(() => ({
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    exportState: document.documentElement.getAttribute("data-export-state"),
    slideAttributes: Array.from(document.querySelectorAll<HTMLElement>(".slide"), (slide) => ({
      className: slide.getAttribute("class"),
      style: slide.getAttribute("style"),
      ariaHidden: slide.getAttribute("aria-hidden"),
    })),
    stageStyles: Array.from(document.querySelectorAll<HTMLElement>(".deck-stage"), (stage) => stage.getAttribute("style")),
  }));
}

async function restorePresentationState(page: Page, state: PresentationState): Promise<void> {
  await page.evaluate((snapshot) => {
    const restore = (element: Element, name: string, value: string | null) => {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    };
    restore(document.documentElement, "style", snapshot.htmlStyle);
    restore(document.body, "style", snapshot.bodyStyle);
    restore(document.documentElement, "data-export-state", snapshot.exportState);
    Array.from(document.querySelectorAll<HTMLElement>(".slide")).forEach((slide, index) => {
      const attributes = snapshot.slideAttributes[index];
      if (!attributes) return;
      restore(slide, "class", attributes.className);
      restore(slide, "style", attributes.style);
      restore(slide, "aria-hidden", attributes.ariaHidden);
    });
    Array.from(document.querySelectorAll<HTMLElement>(".deck-stage")).forEach((stage, index) => {
      restore(stage, "style", snapshot.stageStyles[index] ?? null);
    });
  }, state);
}

async function activateQualitySlide(page: Page, active: number): Promise<string> {
  return page.evaluate((slideIndex) => {
    const slides = Array.from(document.querySelectorAll<HTMLElement>(".slide"));
    slides.forEach((slide, index) => {
      const selected = index === slideIndex;
      slide.classList.toggle("active", selected);
      slide.classList.toggle("visible", selected);
      slide.style.visibility = selected ? "visible" : "hidden";
      slide.style.opacity = selected ? "1" : "0";
      slide.setAttribute("aria-hidden", selected ? "false" : "true");
    });
    return slides[slideIndex]?.dataset.slideId ?? `slide-${slideIndex + 1}`;
  }, active);
}

async function captureQualityScreenshots(page: Page, outputDir: string): Promise<QualityScreenshotEvidence[]> {
  const count = await page.locator(".slide").count();
  const qualityDir = join(outputDir, "quality");
  await mkdir(qualityDir, { recursive: true });
  const screenshots: QualityScreenshotEvidence[] = [];
  for (let index = 0; index < count; index += 1) {
    const slideId = await activateQualitySlide(page, index);
    await page.evaluate((active) => {
      const target = document.querySelectorAll<HTMLElement>(".slide")[active];
      const stage = target?.closest<HTMLElement>(".deck-stage") ?? target;
      if (!target || !stage) return;
      const stageWidth = stage.offsetWidth || target.offsetWidth || 1920;
      const stageHeight = stage.offsetHeight || target.offsetHeight || 1080;
      const scale = Math.min(1920 / stageWidth, 1080 / stageHeight);
      Object.assign(document.documentElement.style, { width: "1920px", height: "1080px", overflow: "hidden" });
      Object.assign(document.body.style, { width: "1920px", height: "1080px", margin: "0", overflow: "hidden" });
      Object.assign(stage.style, { position: "absolute", width: `${stageWidth}px`, height: `${stageHeight}px`, left: `${(1920 - stageWidth * scale) / 2}px`, top: `${(1080 - stageHeight * scale) / 2}px`, transform: `scale(${scale})`, transformOrigin: "0 0" });
    }, index);
    const relativePath = `quality/slide-${String(index + 1).padStart(2, "0")}.png`;
    await page.screenshot({ path: join(outputDir, relativePath), clip: { x: 0, y: 0, width: 1920, height: 1080 }, animations: "disabled" });
    screenshots.push({ slideId, path: relativePath });
  }
  return screenshots;
}

function attachEvidence(report: QualityReport, screenshots: QualityScreenshotEvidence[]): QualityReport {
  const bySlide = new Map(screenshots.map((item) => [item.slideId, item.path]));
  const issues: QualityIssue[] = report.issues.map((issue) => {
    const matched = issue.slideId ? bySlide.get(issue.slideId) : undefined;
    const evidence = matched ? [matched] : screenshots[0] ? [screenshots[0].path] : [];
    return { ...issue, evidence };
  });
  return buildQualityReport({ id: report.id, ...(report.deckId ? { deckId: report.deckId } : {}), canvas: report.canvas, mode: report.mode, strict: report.strict, issues });
}

export async function runPageQualityAudit(page: Page, options: QualityAuditOptions): Promise<QualityAuditResult> {
  await mkdir(options.outputDir, { recursive: true });
  const html = await readFile(options.source, "utf8");
  const mode = options.mode ?? "canonical";
  const strict = options.strict ?? false;
  const staticReport = await auditStaticHtml(html, {
    id: `${options.id}-static`,
    assetRoot: dirname(options.source),
    mode,
    strict,
  });
  const presentationState = await snapshotPresentationState(page);
  let browserReports: QualityReport[] = [];
  let screenshots: QualityScreenshotEvidence[] = [];
  try {
    const count = await page.locator(".slide").count();
    if (count === 0) {
      browserReports = [await page.evaluate(collectRenderedAudit, {
        id: `${options.id}-rendered`,
        mode,
        strict,
        requireSettled: options.requireSettled ?? true,
      })];
    } else {
      for (let index = 0; index < count; index += 1) {
        await activateQualitySlide(page, index);
        browserReports.push(await page.evaluate(collectRenderedAudit, {
          id: `${options.id}-rendered-${index + 1}`,
          mode,
          strict,
          requireSettled: options.requireSettled ?? true,
          slideIndex: index,
        }));
      }
    }
    screenshots = await captureQualityScreenshots(page, options.outputDir);
  } finally {
    await restorePresentationState(page, presentationState);
  }
  const browserReport = mergeQualityReports(`${options.id}-rendered`, browserReports, { canvas: browserReports[0]!.canvas, mode, strict });
  const merged = mergeQualityReports(options.id, [staticReport, browserReport], { canvas: browserReport.canvas, mode, strict });
  const report = attachEvidence(merged, screenshots);
  const reportPath = join(options.outputDir, "quality-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, screenshots };
}

export async function auditSource(source: string, outputDir: string, options: { id?: string; mode?: "canonical" | "imported"; strict?: boolean } = {}): Promise<QualityAuditResult> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(new URL(`file://${source}`).href, { waitUntil: "networkidle", timeout: 30_000 });
    await settlePageForExport(page);
    return await runPageQualityAudit(page, {
      id: options.id ?? `quality-${randomUUID()}`,
      source,
      outputDir,
      mode: options.mode ?? "canonical",
      strict: options.strict ?? false,
      requireSettled: true,
    });
  } finally { await browser?.close(); }
}

export function qualityReportName(source: string): string { return `${basename(source).replace(/\.html?$/i, "")}.quality.json`; }
