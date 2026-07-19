import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { NATIVE_SHAPE_PRESETS } from "./shapes.js";

export const REQUIRED_PPTX_PARTS = [
  "[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels",
  "ppt/presProps.xml", "ppt/viewProps.xml", "ppt/tableStyles.xml", "ppt/theme/theme1.xml",
  "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "docProps/core.xml", "docProps/app.xml",
] as const;

export type PptxValidationSeverity = "warning" | "error";
export type PptxValidationCategory = "MissingPart" | "Relationship" | "ContentType" | "Presentation" | "SlideMaster" | "Slide" | "Chart" | "Xml" | "Theme" | "Transition";
export interface PptxValidationIssue { category: PptxValidationCategory; severity: PptxValidationSeverity; message: string; path?: string; }
export interface PptxValidationReport {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  checkedParts: number;
  checkedRelationships: number;
  slideCount: number;
  issues: PptxValidationIssue[];
}
interface XmlElement { name: string; attributes: Record<string, string>; }
interface Relationship { id: string; type: string; target: string; targetMode: string; resolved: string; }

const NATIVE_PRESET_SET = new Set<string>(NATIVE_SHAPE_PRESETS);
const SLIDE_PATH = /^ppt\/slides\/slide\d+\.xml$/;
const TRANSITIONAL_PRESENTATION_NAMESPACE = "http://schemas.openxmlformats.org/presentationml/2006/main";
const BASE_TRANSITION_CHILDREN = new Set(["blinds", "checker", "circle", "comb", "cover", "cut", "diamond", "dissolve", "fade", "newsflash", "plus", "pull", "push", "random", "randomBar", "split", "strips", "wedge", "wheel", "wipe", "zoom"]);
const issue = (category: PptxValidationCategory, message: string, path?: string): PptxValidationIssue => ({ category, severity: "error", message, ...(path ? { path } : {}) });
const warning = (category: PptxValidationCategory, message: string, path?: string): PptxValidationIssue => ({ category, severity: "warning", message, ...(path ? { path } : {}) });
const partText = async (archive: JSZip, path: string): Promise<string | undefined> => archive.file(path)?.async("string");

function scanXml(xml: string): XmlElement[] {
  const elements: XmlElement[] = [];
  let parseError: Error | undefined;
  const parser = new SaxesParser({ xmlns: false, fragment: false });
  parser.on("opentag", (tag) => {
    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(tag.attributes)) attributes[name] = String(value);
    elements.push({ name: tag.name, attributes });
  });
  parser.on("error", (error) => { parseError = error; });
  parser.write(xml).close();
  if (parseError) throw parseError;
  return elements;
}

function relationshipOwner(path: string): string {
  if (path === "_rels/.rels") return "";
  const marker = "/_rels/";
  const index = path.indexOf(marker);
  if (index < 0 || !path.endsWith(".rels")) return "";
  return posix.join(path.slice(0, index), posix.basename(path, ".rels"));
}

function resolveRelationship(path: string, target: string): string {
  if (target.startsWith("/")) return posix.normalize(target.slice(1));
  const owner = relationshipOwner(path);
  return posix.normalize(posix.join(owner ? posix.dirname(owner) : "", decodeURIComponent(target)));
}

function elementsNamed(elements: XmlElement[], name: string): XmlElement[] {
  return elements.filter((element) => element.name === name || element.name.endsWith(`:${name}`));
}

export async function validatePptxPackageBytes(bytes: Uint8Array): Promise<PptxValidationReport> {
  const issues: PptxValidationIssue[] = [];
  let archive: JSZip;
  try { archive = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch (error) {
    issues.push(issue("Xml", `Invalid ZIP archive: ${error instanceof Error ? error.message : String(error)}`));
    return { valid: false, errorCount: 1, warningCount: 0, checkedParts: 0, checkedRelationships: 0, slideCount: 0, issues };
  }

  const parts = new Set(Object.entries(archive.files).filter(([, entry]) => !entry.dir).map(([name]) => name));
  const xml = new Map<string, { text: string; elements: XmlElement[] }>();
  for (const required of REQUIRED_PPTX_PARTS) if (!parts.has(required)) issues.push(issue("MissingPart", `Missing required part: ${required}`, required));

  for (const path of [...parts].filter((name) => name.endsWith(".xml") || name.endsWith(".rels"))) {
    const text = await partText(archive, path);
    if (text === undefined) continue;
    try {
      if (/<!DOCTYPE\b/i.test(text)) throw new Error("DOCTYPE is not allowed in Open XML package parts");
      xml.set(path, { text, elements: scanXml(text) });
    }
    catch (error) { issues.push(issue("Xml", `Malformed XML: ${error instanceof Error ? error.message : String(error)}`, path)); }
  }

  const relationships = new Map<string, Relationship[]>();
  let checkedRelationships = 0;
  for (const [path, parsed] of xml) {
    if (!path.endsWith(".rels")) continue;
    const seen = new Set<string>();
    const rels = elementsNamed(parsed.elements, "Relationship").map((element): Relationship => {
      const id = element.attributes.Id ?? "";
      const target = element.attributes.Target ?? "";
      const targetMode = element.attributes.TargetMode ?? "";
      if (!id || seen.has(id)) issues.push(issue("Relationship", !id ? "Relationship is missing Id" : `Duplicate relationship Id ${id}`, path));
      seen.add(id);
      const resolved = target ? resolveRelationship(path, target) : "";
      if (!target) issues.push(issue("Relationship", `Relationship ${id || "(missing Id)"} is missing Target`, path));
      if (targetMode !== "External" && target && (resolved.startsWith("../") || !parts.has(resolved))) issues.push(issue("Relationship", `${path} ${id} Target=\"${target}\" resolves to missing part \"${resolved}\"`, path));
      checkedRelationships += 1;
      return { id, type: element.attributes.Type ?? "", target, targetMode, resolved };
    });
    relationships.set(path, rels);
  }

  const contentTypes = xml.get("[Content_Types].xml")?.elements ?? [];
  const defaultValues = elementsNamed(contentTypes, "Default").map((element) => element.attributes.Extension).filter(Boolean);
  const overrideValues = elementsNamed(contentTypes, "Override").map((element) => element.attributes.PartName?.replace(/^\//, "")).filter(Boolean);
  const defaults = new Set(defaultValues); const overrides = new Set(overrideValues);
  if (defaults.size !== defaultValues.length) issues.push(issue("ContentType", "[Content_Types].xml contains duplicate Default extensions", "[Content_Types].xml"));
  if (overrides.size !== overrideValues.length) issues.push(issue("ContentType", "[Content_Types].xml contains duplicate Override part names", "[Content_Types].xml"));
  for (const path of parts) {
    if (path === "[Content_Types].xml" || path.endsWith(".rels")) continue;
    const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : "";
    if (!overrides.has(path) && (!extension || !defaults.has(extension))) issues.push(issue("ContentType", `Part ${path} has no Override or Default in [Content_Types].xml`, path));
  }

  const rootRels = relationships.get("_rels/.rels") ?? [];
  if (!rootRels.some((rel) => rel.type.endsWith("/officeDocument") && rel.resolved === "ppt/presentation.xml")) issues.push(issue("Relationship", "Package root relationships do not resolve to ppt/presentation.xml", "_rels/.rels"));

  const presentation = xml.get("ppt/presentation.xml");
  const presentationRels = relationships.get("ppt/_rels/presentation.xml.rels") ?? [];
  const presentationRelById = new Map(presentationRels.map((rel) => [rel.id, rel]));
  const slideParts = [...parts].filter((path) => SLIDE_PATH.test(path)).toSorted();
  if (presentation) {
    const presentationRoot = elementsNamed(presentation.elements, "presentation")[0];
    if (!presentationRoot || presentationRoot.attributes["xmlns:p"] !== TRANSITIONAL_PRESENTATION_NAMESPACE) issues.push(issue("Presentation", "Presentation root is not ISO/IEC 29500 Transitional PresentationML", "ppt/presentation.xml"));
    const slideIds = elementsNamed(presentation.elements, "sldId");
    if (slideIds.length !== slideParts.length) issues.push(issue("Presentation", `Slide count mismatch: ${slideParts.length} slide parts vs ${slideIds.length} p:sldId entries`, "ppt/presentation.xml"));
    const numericIds = new Set<number>();
    slideIds.forEach((element, index) => {
      const id = Number(element.attributes.id);
      const rid = element.attributes["r:id"] ?? "";
      if (!Number.isInteger(id) || id < 256 || numericIds.has(id)) issues.push(issue("Presentation", `Invalid or duplicate slide id ${element.attributes.id ?? "(missing)"}`, "ppt/presentation.xml"));
      numericIds.add(id);
      const rel = presentationRelById.get(rid);
      if (!rel || !SLIDE_PATH.test(rel.resolved)) issues.push(issue("Presentation", `Slide r:id=\"${rid}\" does not resolve to a slide part`, "ppt/presentation.xml"));
      if (index === 0 && id !== 256) issues.push(warning("Presentation", "Studio-generated packages conventionally use 256 for the first slide id", "ppt/presentation.xml"));
    });
    const masterIds = elementsNamed(presentation.elements, "sldMasterId");
    for (const element of masterIds) {
      const rid = element.attributes["r:id"] ?? "";
      if (!presentationRelById.get(rid)?.resolved.includes("slideMasters/slideMaster")) issues.push(issue("Presentation", `Slide master r:id=\"${rid}\" does not resolve to a slide master`, "ppt/presentation.xml"));
    }
    const slideSize = elementsNamed(presentation.elements, "sldSz")[0];
    if (!slideSize || Number(slideSize.attributes.cx) <= 0 || Number(slideSize.attributes.cy) <= 0) issues.push(issue("Presentation", "Presentation is missing a positive p:sldSz", "ppt/presentation.xml"));
  }

  if (!presentationRels[0] || presentationRels[0].id !== "rId1" || !presentationRels[0].type.endsWith("/slideMaster")) issues.push(warning("Relationship", "Studio-generated presentation.xml.rels conventionally starts with rId1 slideMaster", "ppt/_rels/presentation.xml.rels"));
  const firstSlideIndex = presentationRels.findIndex((rel) => rel.type.endsWith("/slide"));
  const propsIndex = presentationRels.findIndex((rel) => rel.type.endsWith("/presProps"));
  if (firstSlideIndex >= 0 && propsIndex >= 0 && firstSlideIndex > propsIndex) issues.push(warning("Relationship", "Studio-generated packages conventionally list slide relationships before presProps", "ppt/_rels/presentation.xml.rels"));
  const themeIndex = presentationRels.findIndex((rel) => rel.resolved.endsWith("theme/theme1.xml"));
  const tableIndex = presentationRels.findIndex((rel) => rel.type.endsWith("/tableStyles"));
  if (themeIndex >= 0 && tableIndex >= 0 && themeIndex > tableIndex) issues.push(warning("Relationship", "Studio-generated packages conventionally list theme before tableStyles", "ppt/_rels/presentation.xml.rels"));

  const master = xml.get("ppt/slideMasters/slideMaster1.xml");
  const masterRels = relationships.get("ppt/slideMasters/_rels/slideMaster1.xml.rels") ?? [];
  const masterRelById = new Map(masterRels.map((rel) => [rel.id, rel]));
  if (master) {
    if (elementsNamed(master.elements, "txStyles").length === 0) issues.push(issue("SlideMaster", "Slide master missing p:txStyles", "ppt/slideMasters/slideMaster1.xml"));
    const layoutIds = new Set<string>();
    for (const element of elementsNamed(master.elements, "sldLayoutId")) {
      const id = element.attributes.id ?? "";
      if (!id || layoutIds.has(id)) issues.push(issue("SlideMaster", `Invalid or duplicate slide layout id ${id || "(missing)"}`, "ppt/slideMasters/slideMaster1.xml"));
      layoutIds.add(id);
      const rid = element.attributes["r:id"] ?? "";
      if (!masterRelById.get(rid)?.resolved.includes("slideLayouts/slideLayout")) issues.push(issue("SlideMaster", `Layout r:id=\"${rid}\" does not resolve to a slideLayout part`, "ppt/slideMasters/slideMaster1.xml"));
    }
  }

  const theme = await archive.file("ppt/theme/theme1.xml")?.async("uint8array");
  const themeParsed = xml.get("ppt/theme/theme1.xml");
  if (theme && theme.byteLength < 7000) issues.push(issue("Theme", `Theme part too small (${theme.byteLength} bytes); expected a full Office theme`, "ppt/theme/theme1.xml"));
  if (themeParsed) for (const required of ["themeElements", "clrScheme", "fontScheme", "fmtScheme"]) if (elementsNamed(themeParsed.elements, required).length === 0) issues.push(issue("Theme", `Theme missing a:${required}`, "ppt/theme/theme1.xml"));

  for (const slidePath of slideParts) {
    const parsed = xml.get(slidePath);
    if (!parsed) continue;
    const relsPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const rels = relationships.get(relsPath) ?? [];
    const relById = new Map(rels.map((rel) => [rel.id, rel]));
    if (!rels.some((rel) => rel.type.endsWith("/slideLayout") && rel.resolved.startsWith("ppt/slideLayouts/"))) issues.push(issue("Slide", `${slidePath} has no valid slideLayout relationship`, relsPath));
    const referenceIds = new Set<string>();
    for (const element of parsed.elements) for (const name of ["r:embed", "r:id", "r:link"]) if (element.attributes[name]?.startsWith("rId")) referenceIds.add(element.attributes[name]);
    for (const rid of referenceIds) if (!relById.has(rid)) issues.push(issue("Slide", `${slidePath} references ${rid} but ${relsPath} has no such relationship`, slidePath));
    const shapeIds = new Set<string>();
    const shapeNames = new Set<string>();
    for (const element of elementsNamed(parsed.elements, "cNvPr")) {
      const id = element.attributes.id ?? "";
      const name = element.attributes.name ?? "";
      if (!id || shapeIds.has(id)) issues.push(issue("Slide", `${slidePath} has invalid or duplicate shape id \"${id}\"`, slidePath));
      shapeIds.add(id);
      if (name && shapeNames.has(name)) issues.push(issue("Slide", `${slidePath} has duplicate object name \"${name}\"`, slidePath));
      if (name) shapeNames.add(name);
    }
    for (const element of elementsNamed(parsed.elements, "ext")) for (const attr of ["cx", "cy"]) if (element.attributes[attr] !== undefined && (!Number.isFinite(Number(element.attributes[attr])) || Number(element.attributes[attr]) < 0)) issues.push(issue("Slide", `${slidePath} has negative or invalid a:ext ${attr}=\"${element.attributes[attr]}\"`, slidePath));
    for (const element of elementsNamed(parsed.elements, "prstGeom")) {
      const preset = element.attributes.prst;
      if (preset && !NATIVE_PRESET_SET.has(preset)) issues.push(issue("Slide", `${slidePath} uses invalid native shape preset \"${preset}\"`, slidePath));
    }
    for (const rel of rels.filter((entry) => entry.type.endsWith("/image"))) if (!rel.resolved.startsWith("ppt/media/")) issues.push(issue("Slide", `${slidePath} image relationship ${rel.id} does not target ppt/media`, relsPath));
    const transitions = elementsNamed(parsed.elements, "transition");
    if (transitions.length > 1) issues.push(issue("Transition", `${slidePath} contains more than one p:transition`, slidePath));
    const transitionMatch = /<p:transition\b([^>]*)>([\s\S]*?)<\/p:transition>/.exec(parsed.text);
    if (transitionMatch) {
      const transitionAttributes = transitionMatch[1] ?? ""; const transitionBody = transitionMatch[2] ?? "";
      const child = /<([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)\b/.exec(transitionBody);
      if (!child || (child[1] === "p" && !BASE_TRANSITION_CHILDREN.has(child[2]!)) || (child[1] === "p14" && child[2] !== "reveal") || !["p", "p14"].includes(child[1]!)) issues.push(issue("Transition", `${slidePath} contains unsupported transition child ${child ? `${child[1]}:${child[2]}` : "(missing)"}`, slidePath));
      const usesP14 = child?.[1] === "p14" || /\bp14:dur=/.test(transitionAttributes);
      if (usesP14 && !`${transitionAttributes}${transitionBody}`.includes('xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"')) issues.push(issue("Transition", `${slidePath} p14 transition is missing the Office 2010 namespace`, slidePath));
      const duration = /\bp14:dur="([^"]*)"/.exec(transitionAttributes)?.[1];
      if (duration !== undefined && (!/^\d+$/.test(duration) || Number(duration) > 4_294_967_295)) issues.push(issue("Transition", `${slidePath} p14:dur must be an unsigned 32-bit millisecond value`, slidePath));
    }
  }

  const chartParts = [...parts].filter((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path));
  for (const chartPath of chartParts) {
    const relsPath = chartPath.replace("ppt/charts/", "ppt/charts/_rels/") + ".rels";
    const rels = relationships.get(relsPath) ?? [];
    if (!parts.has(relsPath)) issues.push(issue("Chart", `Chart missing relationships part ${relsPath}`, chartPath));
    const workbookRelationships = rels.filter((rel) => rel.type.endsWith("/package") && rel.resolved.startsWith("ppt/embeddings/") && rel.resolved.endsWith(".xlsx"));
    if (workbookRelationships.length === 0) issues.push(issue("Chart", `${relsPath} missing package relationship to embedded workbook`, relsPath));
    for (const rel of workbookRelationships) if (!parts.has(rel.resolved)) issues.push(issue("Chart", `${chartPath} missing embedded workbook ${rel.resolved}`, chartPath));
    if (!xml.get(chartPath)?.elements.some((element) => element.name.endsWith(":externalData") || element.name === "externalData")) issues.push(issue("Chart", `${chartPath} missing c:externalData`, chartPath));
  }

  if (parts.has("ppt/notesMasters/notesMaster1.xml")) {
    const relsPath = "ppt/notesMasters/_rels/notesMaster1.xml.rels";
    if (!(relationships.get(relsPath) ?? []).some((rel) => rel.resolved === "ppt/theme/theme2.xml")) issues.push(issue("Relationship", "Notes master should reference theme/theme2.xml", relsPath));
    if (!elementsNamed(xml.get("ppt/notesMasters/notesMaster1.xml")?.elements ?? [], "bg").length) issues.push(issue("SlideMaster", "Notes master missing p:bg", "ppt/notesMasters/notesMaster1.xml"));
  }

  if (parts.has("ppt/handoutMasters/handoutMaster1.xml")) {
    const relsPath = "ppt/handoutMasters/_rels/handoutMaster1.xml.rels";
    if (!(relationships.get(relsPath) ?? []).some((rel) => rel.resolved === "ppt/theme/theme3.xml")) issues.push(issue("Relationship", "Handout master should reference theme/theme3.xml", relsPath));
    if (!elementsNamed(xml.get("ppt/handoutMasters/handoutMaster1.xml")?.elements ?? [], "bg").length) issues.push(issue("SlideMaster", "Handout master missing p:bg", "ppt/handoutMasters/handoutMaster1.xml"));
    if (elementsNamed(xml.get("ppt/presProps.xml")?.elements ?? [], "prnPr").length) issues.push(issue("Presentation", "presProps.xml must not contain p:prnPr when a handout master is packaged", "ppt/presProps.xml"));
  }

  const errorCount = issues.filter((entry) => entry.severity === "error").length;
  const warningCount = issues.filter((entry) => entry.severity === "warning").length;
  return { valid: errorCount === 0, errorCount, warningCount, checkedParts: parts.size, checkedRelationships, slideCount: slideParts.length, issues };
}

export async function validatePptxPackage(path: string): Promise<PptxValidationReport> {
  return validatePptxPackageBytes(new Uint8Array(await readFile(path)));
}

export function repairFindings(report: PptxValidationReport): PptxValidationIssue[] {
  return report.issues.filter((entry) => entry.severity === "error");
}
