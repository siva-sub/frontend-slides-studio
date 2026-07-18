import type { LayoutProfile, StyleProfile } from "@slides-studio/protocol";

export type StyleApplyScope = "page" | "deck";

export interface AuthoringContext {
  recipeId?: string;
  layoutId?: string;
}

const THEME_STYLE_ID = "slides-studio-applied-theme";
const THEME_RULES = `.slide[data-slides-studio-style-id]{background:var(--slides-studio-paper)!important;color:var(--slides-studio-ink)!important;font-family:var(--slides-studio-body-font)!important}.slide[data-slides-studio-style-id] :where(h1,h2,h3,h4,h5,h6){color:var(--slides-studio-ink)!important;font-family:var(--slides-studio-title-font)!important}.slide[data-slides-studio-style-id] :where(p,li,td,th,blockquote,figcaption,label){color:inherit}.slide[data-slides-studio-style-id] :where(a){color:var(--slides-studio-link)!important}.slide[data-slides-studio-style-id] :where([data-accent],.accent,.kicker){color:var(--slides-studio-accent)!important}.slide[data-slides-studio-style-id] :where(hr){border-color:var(--slides-studio-rule)!important}`;

function serialize(doc: Document): string {
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function ensureRules(doc: Document): void {
  let rules = doc.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!rules) {
    rules = doc.createElement("style");
    rules.id = THEME_STYLE_ID;
    rules.dataset.slidesStudioTheme = "true";
    doc.head.append(rules);
  }
  rules.textContent = THEME_RULES;
}

function setVariable(slide: HTMLElement, name: string, value: string | undefined, fallback: string): void {
  slide.style.setProperty(name, value || fallback);
}

function applyToSlide(slide: HTMLElement, style: StyleProfile, context: AuthoringContext): void {
  const { palette, fonts } = style;
  slide.dataset.slidesStudioStyleId = style.id;
  if (context.recipeId) slide.dataset.slidesStudioRecipeId = context.recipeId;
  if (context.layoutId) slide.dataset.slidesStudioLayoutId = context.layoutId;
  setVariable(slide, "--slides-studio-paper", palette.paper, "#F7F5EF");
  setVariable(slide, "--slides-studio-paper-2", palette.paper2, "#FFFFFF");
  setVariable(slide, "--slides-studio-ink", palette.ink, "#171914");
  setVariable(slide, "--slides-studio-muted", palette.muted, "#6B7067");
  setVariable(slide, "--slides-studio-rule", palette.rule, "#D7D9D3");
  setVariable(slide, "--slides-studio-accent", palette.accent, "#F05A36");
  setVariable(slide, "--slides-studio-accent-tint", palette.accentTint, "#FDE8E1");
  setVariable(slide, "--slides-studio-link", palette.link, palette.accent || "#315F9D");
  setVariable(slide, "--slides-studio-title-font", fonts.title, "Inter, Arial, sans-serif");
  setVariable(slide, "--slides-studio-body-font", fonts.body, "Inter, Arial, sans-serif");
  setVariable(slide, "--slides-studio-mono-font", fonts.mono, "IBM Plex Mono, ui-monospace, monospace");
}

export function applyStyleToHtml(html: string, style: StyleProfile, scope: StyleApplyScope, slideIndex: number, context: AuthoringContext = {}): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slides = Array.from(doc.querySelectorAll<HTMLElement>(".slide"));
  const targets = scope === "deck" ? slides : [slides[slideIndex]].filter((slide): slide is HTMLElement => Boolean(slide));
  if (targets.length === 0) throw new Error(`Slide ${slideIndex + 1} is unavailable.`);
  ensureRules(doc);
  targets.forEach((slide) => applyToSlide(slide, style, context));
  doc.documentElement.dataset.slidesStudioStyleId = style.id;
  if (context.recipeId) doc.documentElement.dataset.slidesStudioRecipeId = context.recipeId;
  return serialize(doc);
}

export function attachLayoutToPage(html: string, slideIndex: number, styleId: string, layoutId: string, recipeId?: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slide = doc.querySelectorAll<HTMLElement>(".slide")[slideIndex];
  if (!slide) throw new Error(`Slide ${slideIndex + 1} is unavailable.`);
  slide.dataset.slidesStudioStyleId = styleId;
  slide.dataset.slidesStudioLayoutId = layoutId;
  if (recipeId) slide.dataset.slidesStudioRecipeId = recipeId;
  return serialize(doc);
}

function numericCss(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function intrinsicStageSize(doc: Document, fallback: { width: number; height: number }): { width: number; height: number } {
  const stage = doc.querySelector<HTMLElement>(".deck-stage");
  const inlineWidth = stage ? numericCss(stage.style.width) : undefined;
  const inlineHeight = stage ? numericCss(stage.style.height) : undefined;
  if (inlineWidth && inlineHeight) return { width: inlineWidth, height: inlineHeight };
  const css = Array.from(doc.querySelectorAll("style")).map((style) => style.textContent || "").join("\n");
  const block = /\.deck-stage\s*\{([^}]*)\}/i.exec(css)?.[1] ?? "";
  const width = /(?:^|;)\s*width\s*:\s*([\d.]+)px/i.exec(block)?.[1];
  const height = /(?:^|;)\s*height\s*:\s*([\d.]+)px/i.exec(block)?.[1];
  return { width: numericCss(width || "") ?? fallback.width, height: numericCss(height || "") ?? fallback.height };
}

export function applyLayoutSlotToObject(html: string, objectId: string, layout: LayoutProfile, slotId: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const object = doc.querySelector<HTMLElement>(`[data-object-id="${CSS.escape(objectId)}"]`);
  if (!object) throw new Error(`Object ${objectId} is unavailable.`);
  const slot = layout.slots.find((candidate) => candidate.id === slotId);
  if (!slot) throw new Error(`Layout ${layout.id} has no slot ${slotId}.`);
  const canvas = intrinsicStageSize(doc, layout.canvas);
  object.style.position = "absolute";
  object.style.left = `${slot.region.x * canvas.width}px`;
  object.style.top = `${slot.region.y * canvas.height}px`;
  object.style.width = `${slot.region.width * canvas.width}px`;
  object.style.height = `${slot.region.height * canvas.height}px`;
  object.style.objectFit = slot.fit;
  object.dataset.layoutSlot = slot.id;
  object.dataset.mediaFit = slot.fit;
  const slide = object.closest<HTMLElement>(".slide");
  if (slide) {
    slide.dataset.slidesStudioStyleId = layout.styleId;
    slide.dataset.slidesStudioLayoutId = layout.id;
  }
  return serialize(doc);
}
