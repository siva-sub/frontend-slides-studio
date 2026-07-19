import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { nativeTransitionXml, type NativePptxTransition } from "./transitions.js";

export interface NativeShapeGradientTransform { slideNumber: number; objectName: string; angle: number; stops: Array<{ color: string; position: number; transparency?: number }>; }
export interface GeneratedPptxNormalizationOptions {
  /** Studio does not yet expose authored speaker notes. */
  stripUnusedNotes?: boolean;
  repairAuthoredNotes?: boolean;
  transitions?: ReadonlyMap<number, NativePptxTransition> | Record<number, NativePptxTransition>;
  shapeGradients?: NativeShapeGradientTransform[];
}
export interface GeneratedPptxNormalizationResult { strippedNoteParts: number; repairedAuthoredNotes: boolean; injectedTransitions: number; transformedGradients: number; renamedChartEmbeddings: number; removedDanglingChartAxisIds: number; repairedDuplicateShapeIds: number; formattedRelationshipParts: number; }

const transitionEntries = (value: GeneratedPptxNormalizationOptions["transitions"]): Array<[number, NativePptxTransition]> => value instanceof Map ? [...value.entries()] : Object.entries(value ?? {}).map(([index, spec]) => [Number(index), spec]);

const xmlAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/\"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeHex = (value: string) => { const match = /^#?([0-9a-f]{6})$/i.exec(value.trim()); if (!match) throw new TypeError(`gradient color ${value} must be six-digit hexadecimal`); return match[1]!.toUpperCase(); };

function gradientXml(transform: NativeShapeGradientTransform): string {
  if (!Number.isFinite(transform.angle)) throw new TypeError("gradient angle must be finite");
  if (!Array.isArray(transform.stops) || transform.stops.length < 2) throw new TypeError("gradient requires at least two stops");
  const stops = transform.stops.toSorted((left, right) => left.position - right.position).map((stop) => {
    if (!Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1) throw new TypeError("gradient stop position must be from 0 to 1");
    if (stop.transparency !== undefined && (!Number.isFinite(stop.transparency) || stop.transparency < 0 || stop.transparency > 100)) throw new TypeError("gradient stop transparency must be from 0 to 100");
    const alpha = stop.transparency === undefined ? "" : `<a:alpha val=\"${Math.round((100 - stop.transparency) * 1000)}\"/>`;
    return `<a:gs pos=\"${Math.round(stop.position * 100000)}\"><a:srgbClr val=\"${normalizeHex(stop.color)}\">${alpha}</a:srgbClr></a:gs>`;
  }).join("");
  const angle = Math.round(((transform.angle % 360 + 360) % 360) * 60000);
  return `<a:gradFill rotWithShape=\"1\"><a:gsLst>${stops}</a:gsLst><a:lin ang=\"${angle}\" scaled=\"1\"/></a:gradFill>`;
}

function applyShapeGradient(slideXml: string, transform: NativeShapeGradientTransform): string {
  const name = regexEscape(xmlAttribute(transform.objectName));
  const namePattern = new RegExp(`<p:cNvPr\\b[^>]*\\bname=\"${name}\"(?=[\\s/>])`);
  const match = [...slideXml.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)].find((candidate) => namePattern.test(candidate[0]));
  if (!match || match.index === undefined) throw new Error(`shape ${transform.objectName} is missing from slide${transform.slideNumber}.xml`);
  const shape = match[0];
  const gradient = gradientXml(transform);
  let updated = shape.replace(/<a:(?:solidFill|noFill)>[\s\S]*?<\/a:(?:solidFill|noFill)>|<a:noFill\/>/, gradient);
  if (updated === shape) updated = shape.replace(/<\/a:prstGeom>/, `</a:prstGeom>${gradient}`);
  if (updated === shape) throw new Error(`shape ${transform.objectName} has no fill insertion point`);
  return `${slideXml.slice(0, match.index)}${updated}${slideXml.slice(match.index + shape.length)}`;
}

function injectTransition(slideXml: string, transition: NativePptxTransition): string {
  const withoutExisting = slideXml.replace(/<p:transition\b[^>]*>[\s\S]*?<\/p:transition>/g, "").replace(/<p:transition\b[^>]*\/>/g, "");
  const fragment = nativeTransitionXml(transition);
  if (!fragment) return withoutExisting;
  if (withoutExisting.includes("</p:clrMapOvr>")) return withoutExisting.replace("</p:clrMapOvr>", `</p:clrMapOvr>${fragment}`);
  if (withoutExisting.includes("</p:cSld>")) return withoutExisting.replace("</p:cSld>", `</p:cSld>${fragment}`);
  throw new Error("slide XML is missing p:cSld and cannot receive a transition");
}

export async function normalizeGeneratedPptxPackage(path: string, options: GeneratedPptxNormalizationOptions = {}): Promise<GeneratedPptxNormalizationResult> {
  const archive = await JSZip.loadAsync(await readFile(path), { checkCRC32: true });
  let strippedNoteParts = 0;
  if (options.stripUnusedNotes) {
    const removeNotesRelationships = async (relationshipPath: string): Promise<void> => {
      const entry = archive.file(relationshipPath);
      if (!entry) return;
      const xml = await entry.async("string");
      archive.file(relationshipPath, xml.replace(/<Relationship\b[^>]*\/>/g, (tag) => /Type="[^"]*\/(?:notesMaster|notesSlide)"/.test(tag) ? "" : tag));
    };
    const presentation = archive.file("ppt/presentation.xml");
    if (presentation) archive.file("ppt/presentation.xml", (await presentation.async("string")).replace(/<p:notesMasterIdLst\b[^>]*>[\s\S]*?<\/p:notesMasterIdLst>/g, "").replace(/<p:notesMasterIdLst\b[^>]*\/>/g, ""));
    const contentTypes = archive.file("[Content_Types].xml");
    if (contentTypes) archive.file("[Content_Types].xml", (await contentTypes.async("string")).replace(/<Override\b[^>]*\/>/g, (tag) => /PartName="\/ppt\/(?:notesMasters|notesSlides)\//.test(tag) ? "" : tag));
    await removeNotesRelationships("ppt/_rels/presentation.xml.rels");
    for (const relationshipPath of Object.keys(archive.files).filter((entry) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(entry))) await removeNotesRelationships(relationshipPath);
    const noteParts = Object.keys(archive.files).filter((entry) => entry.startsWith("ppt/notesMasters/") || entry.startsWith("ppt/notesSlides/"));
    strippedNoteParts = noteParts.filter((entry) => !archive.files[entry]?.dir).length;
    archive.remove("ppt/notesMasters");
    archive.remove("ppt/notesSlides");
  }

  let repairedAuthoredNotes = false;
  if (options.repairAuthoredNotes && archive.file("ppt/notesMasters/notesMaster1.xml")) {
    const presentation = archive.file("ppt/presentation.xml");
    if (!presentation) throw new Error("authored notes require ppt/presentation.xml");
    let presentationXml = await presentation.async("string");
    const notesMaster = /<p:notesMasterIdLst\b[^>]*>[\s\S]*?<\/p:notesMasterIdLst>/.exec(presentationXml)?.[0];
    if (!notesMaster) throw new Error("authored notes are missing p:notesMasterIdLst");
    presentationXml = presentationXml.replace(notesMaster, "").replace("</p:sldMasterIdLst>", `</p:sldMasterIdLst>${notesMaster}`);
    archive.file("ppt/presentation.xml", presentationXml);
    const theme1 = archive.file("ppt/theme/theme1.xml");
    if (!theme1) throw new Error("authored notes require ppt/theme/theme1.xml");
    if (!archive.file("ppt/theme/theme2.xml")) archive.file("ppt/theme/theme2.xml", await theme1.async("uint8array"));
    const notesRelsPath = "ppt/notesMasters/_rels/notesMaster1.xml.rels"; const notesRels = archive.file(notesRelsPath);
    if (!notesRels) throw new Error("authored notes are missing notesMaster1.xml.rels");
    archive.file(notesRelsPath, (await notesRels.async("string")).replace(/\.\.\/theme\/theme1\.xml/g, "../theme/theme2.xml"));
    const contentTypes = archive.file("[Content_Types].xml");
    if (!contentTypes) throw new Error("authored notes require [Content_Types].xml");
    let contentTypesXml = await contentTypes.async("string");
    if (!contentTypesXml.includes('PartName="/ppt/theme/theme2.xml"')) contentTypesXml = contentTypesXml.replace("</Types>", '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>');
    archive.file("[Content_Types].xml", contentTypesXml);
    repairedAuthoredNotes = true;
  }

  let injectedTransitions = 0;
  for (const [slideNumber, transition] of transitionEntries(options.transitions)) {
    if (!Number.isInteger(slideNumber) || slideNumber < 1) throw new TypeError(`transition slide number ${slideNumber} must be a positive integer`);
    const slidePath = `ppt/slides/slide${slideNumber}.xml`;
    const slide = archive.file(slidePath);
    if (!slide) throw new Error(`transition targets missing ${slidePath}`);
    archive.file(slidePath, injectTransition(await slide.async("string"), transition));
    if (transition.kind !== "none") injectedTransitions += 1;
  }

  let transformedGradients = 0;
  for (const transform of options.shapeGradients ?? []) {
    if (!Number.isInteger(transform.slideNumber) || transform.slideNumber < 1) throw new TypeError(`gradient slide number ${transform.slideNumber} must be a positive integer`);
    const slidePath = `ppt/slides/slide${transform.slideNumber}.xml`;
    const slide = archive.file(slidePath);
    if (!slide) throw new Error(`gradient targets missing ${slidePath}`);
    archive.file(slidePath, applyShapeGradient(await slide.async("string"), transform));
    transformedGradients += 1;
  }

  let repairedDuplicateShapeIds = 0;
  for (const slidePath of Object.keys(archive.files).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))) {
    const slide = archive.file(slidePath); if (!slide) continue;
    let slideXml = await slide.async("string");
    const existingIds = [...slideXml.matchAll(/<p:cNvPr\b[^>]*\bid=\"(\d+)\"/g)].map((match) => Number(match[1]));
    let nextId = Math.max(1, ...existingIds) + 1; const seen = new Set<number>();
    slideXml = slideXml.replace(/<p:cNvPr\b[^>]*\bid=\"(\d+)\"[^>]*>/g, (tag, rawId: string) => { const id = Number(rawId); if (!seen.has(id)) { seen.add(id); return tag; } while (seen.has(nextId)) nextId += 1; const replacement = nextId; seen.add(replacement); nextId += 1; repairedDuplicateShapeIds += 1; return tag.replace(`id=\"${rawId}\"`, `id=\"${replacement}\"`); });
    archive.file(slidePath, slideXml);
  }

  let renamedChartEmbeddings = 0;
  for (const chartPath of Object.keys(archive.files).filter((entry) => /^ppt\/charts\/chart\d+\.xml$/.test(entry))) {
    const index = chartPath.match(/chart(\d+)\.xml$/)?.[1]; if (!index) continue;
    const legacyPath = `ppt/embeddings/Microsoft_Excel_Worksheet${index}.xlsx`; const compatiblePath = `ppt/embeddings/Microsoft_Excel_Sheet${index}.xlsx`;
    const legacy = archive.file(legacyPath);
    if (legacy && !archive.file(compatiblePath)) { archive.file(compatiblePath, await legacy.async("uint8array")); archive.remove(legacyPath); renamedChartEmbeddings += 1; }
    const relsPath = `ppt/charts/_rels/chart${index}.xml.rels`; const rels = archive.file(relsPath);
    if (rels) archive.file(relsPath, (await rels.async("string")).replace(`Microsoft_Excel_Worksheet${index}.xlsx`, `Microsoft_Excel_Sheet${index}.xlsx`));
  }

  let removedDanglingChartAxisIds = 0;
  for (const chartPath of Object.keys(archive.files).filter((entry) => /^ppt\/charts\/chart\d+\.xml$/.test(entry))) {
    const chart = archive.file(chartPath); if (!chart) continue;
    let chartXml = await chart.async("string");
    const actualAxisIds = new Set([...chartXml.matchAll(/<c:(?:catAx|valAx|dateAx|serAx)>[\s\S]*?<c:axId val=\"(\d+)\"\/>[\s\S]*?<\/c:(?:catAx|valAx|dateAx|serAx)>/g)].map((match) => match[1]!));
    chartXml = chartXml.replace(/<c:axId val=\"(\d+)\"\/>/g, (tag, id: string) => { if (actualAxisIds.has(id)) return tag; removedDanglingChartAxisIds += 1; return ""; });
    archive.file(chartPath, chartXml);
  }

  let formattedRelationshipParts = 0;
  for (const relationshipPath of Object.keys(archive.files).filter((entry) => entry.endsWith(".rels"))) {
    const relationshipPart = archive.file(relationshipPath);
    if (!relationshipPart) continue;
    const xml = await relationshipPart.async("string");
    const formatted = xml.replace(/><Relationship\b/g, ">\n<Relationship").replace(/><\/Relationships>/g, ">\n</Relationships>");
    if (formatted !== xml) formattedRelationshipParts += 1;
    archive.file(relationshipPath, formatted);
  }

  await writeFile(path, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { strippedNoteParts, repairedAuthoredNotes, injectedTransitions, transformedGradients, renamedChartEmbeddings, removedDanglingChartAxisIds, repairedDuplicateShapeIds, formattedRelationshipParts };
}
