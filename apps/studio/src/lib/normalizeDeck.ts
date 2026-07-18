export type ImportStrategy = "section.slide" | "reveal" | "slide" | "pptx" | "page" | "data-slide" | "sections" | "siblings" | "document";
export type Confidence = "high" | "medium" | "low";
export interface NormalizedDeck { html: string; strategy: ImportStrategy; confidence: Confidence; slideCount: number; warnings: string[]; }

interface Candidate { strategy: ImportStrategy; selector: string; confidence: Confidence; predicate?: (nodes: Element[]) => boolean; }
const candidates: Candidate[] = [
  { strategy: "section.slide", selector: "section.slide", confidence: "high" },
  { strategy: "reveal", selector: ".reveal .slides > section", confidence: "high" },
  { strategy: "slide", selector: "body > .slide", confidence: "high" },
  { strategy: "pptx", selector: ".pptx-slide, .slide-page", confidence: "high" },
  { strategy: "page", selector: "body > .page", confidence: "medium", predicate: (nodes) => nodes.every(isPageLike) },
  { strategy: "data-slide", selector: "[data-slide], [data-slide-id]", confidence: "high" },
  { strategy: "sections", selector: "body > section", confidence: "medium", predicate: (nodes) => nodes.length >= 2 },
];

const isPageLike = (element: Element): boolean => {
  const style = element.getAttribute("style") ?? "";
  const className = element.className;
  return /aspect-ratio\s*:\s*16\s*\/\s*9|1920px|1080px/i.test(style) || /page|slide/i.test(String(className));
};

const isNestedSlide = (node: Element, all: Set<Element>): boolean => { let parent = node.parentElement; while (parent) { if (all.has(parent)) return true; parent = parent.parentElement; } return false; };
const significantBodyChildren = (doc: Document) => Array.from(doc.body.children).filter((element) => !["SCRIPT", "STYLE", "LINK", "NOSCRIPT"].includes(element.tagName));

function chooseSiblingBlocks(doc: Document): Element[] {
  const children = significantBodyChildren(doc);
  if (children.length < 2 || children.length > 80) return [];
  const signatures = children.map((element) => `${element.tagName}.${Array.from(element.classList).toSorted().join(".")}`);
  const dominant = signatures.toSorted((left, right) => signatures.filter((value) => value === right).length - signatures.filter((value) => value === left).length)[0];
  const matching = children.filter((_element, index) => signatures[index] === dominant);
  return matching.length / children.length >= 0.8 ? matching : [];
}

function ensureDeckStyles(doc: Document): void {
  if (doc.querySelector("style[data-slides-studio-import]")) return;
  const style = doc.createElement("style");
  style.dataset.slidesStudioImport = "true";
  style.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden}.deck-stage{position:absolute;transform-origin:0 0}.deck-stage[data-studio-default-stage]{width:1920px;height:1080px}.slide{position:absolute;inset:0;visibility:hidden;opacity:0;pointer-events:none}.slide.active,.slide.visible{visibility:visible;opacity:1;pointer-events:auto}`;
  doc.head.append(style);
}

export function normalizeDeck(source: string): NormalizedDeck {
  const doc = new DOMParser().parseFromString(source, "text/html");
  const warnings: string[] = [];
  let strategy: ImportStrategy = "document";
  let confidence: Confidence = "low";
  let slides: Element[] = [];

  for (const candidate of candidates) {
    const raw = Array.from(doc.querySelectorAll(candidate.selector));
    const set = new Set(raw);
    const topLevel = raw.filter((node) => !isNestedSlide(node, set));
    if (topLevel.length > 0 && (!candidate.predicate || candidate.predicate(topLevel))) { strategy = candidate.strategy; confidence = candidate.confidence; slides = topLevel; break; }
  }
  if (slides.length === 0) {
    const siblings = chooseSiblingBlocks(doc);
    if (siblings.length >= 2) { strategy = "siblings"; confidence = "low"; slides = siblings; warnings.push("Equal sibling blocks were detected conservatively; confirm before freeform conversion."); }
  }
  const bodyText = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  if (slides.length <= 1 && bodyText.length > 1200) { strategy = "document"; confidence = "low"; slides = []; warnings.push("Continuous prose was kept as a scrollable document instead of being guessed into slides."); }
  if (slides.length === 0) {
    doc.body.dataset.documentMode = "true";
    return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, strategy, confidence, slideCount: 1, warnings };
  }
  ensureDeckStyles(doc);
  const parents = new Set(slides.map((slide) => slide.parentElement));
  if (parents.size === 1 && slides[0]?.parentElement && slides[0].parentElement !== doc.body) slides[0].parentElement.classList.add("deck-stage");
  else {
    const stage = doc.createElement("main"); stage.className = "deck-stage"; stage.dataset.studioDefaultStage = "true";
    slides[0]?.before(stage); slides.forEach((slide) => stage.append(slide));
  }
  slides.forEach((slide, index) => {
    slide.classList.add("slide");
    slide.setAttribute("data-slide-id", slide.getAttribute("data-slide-id") || `slide-${String(index + 1).padStart(2, "0")}`);
    slide.classList.toggle("active", index === 0);
    slide.classList.toggle("visible", index === 0);
    slide.querySelectorAll<HTMLElement>("h1,h2,h3,p,li,img,video,svg,figure,table,blockquote").forEach((object, objectIndex) => { object.dataset.objectId ||= `${slide.getAttribute("data-slide-id")}-object-${String(objectIndex + 1).padStart(2, "0")}`; });
  });
  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, strategy, confidence, slideCount: slides.length, warnings };
}
