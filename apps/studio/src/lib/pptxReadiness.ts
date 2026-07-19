import type { PptxSlideIntent } from "@slides-studio/presentation-objects";

export function readSlidePptxIntent(html: string, slideIndex: number): PptxSlideIntent | "" {
  const document = new DOMParser().parseFromString(html, "text/html");
  const value = document.querySelectorAll<HTMLElement>(".slide")[slideIndex]?.dataset.pptxIntent;
  return value === "native-oriented" || value === "hybrid" || value === "raster" ? value : "";
}

export function applySlidePptxIntent(html: string, slideIndex: number, intent: PptxSlideIntent | ""): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const slide = document.querySelectorAll<HTMLElement>(".slide")[slideIndex];
  if (!slide) throw new RangeError(`Slide ${slideIndex + 1} does not exist.`);
  if (intent) slide.dataset.pptxIntent = intent; else delete slide.dataset.pptxIntent;
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
