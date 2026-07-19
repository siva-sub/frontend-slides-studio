// Native OOXML preset catalog. PptxGenJS is MIT-licensed; ppt-rs compatibility
// aliases below are adapted from Apache-2.0 source at commit 2e5a3f812711bfeeb729c5f7e5938c1367c3f480.
export const NATIVE_SHAPE_PRESETS = [
  "accentBorderCallout1", "accentBorderCallout2", "accentBorderCallout3", "accentCallout1", "accentCallout2", "accentCallout3",
  "actionButtonBackPrevious", "actionButtonBeginning", "actionButtonBlank", "actionButtonDocument", "actionButtonEnd", "actionButtonForwardNext", "actionButtonHelp", "actionButtonHome", "actionButtonInformation", "actionButtonMovie", "actionButtonReturn", "actionButtonSound",
  "arc", "bentArrow", "bentUpArrow", "bevel", "blockArc", "borderCallout1", "borderCallout2", "borderCallout3", "bracePair", "bracketPair",
  "callout1", "callout2", "callout3", "can", "chartPlus", "chartStar", "chartX", "chevron", "chord", "circularArrow", "cloud", "cloudCallout", "corner", "cornerTabs", "cube", "curvedDownArrow", "curvedLeftArrow", "curvedRightArrow", "curvedUpArrow",
  "decagon", "diagStripe", "diamond", "dodecagon", "donut", "doubleWave", "downArrow", "downArrowCallout", "ellipse", "ellipseRibbon", "ellipseRibbon2",
  "flowChartAlternateProcess", "flowChartCollate", "flowChartConnector", "flowChartDecision", "flowChartDelay", "flowChartDisplay", "flowChartDocument", "flowChartExtract", "flowChartInputOutput", "flowChartInternalStorage", "flowChartMagneticDisk", "flowChartMagneticDrum", "flowChartMagneticTape", "flowChartManualInput", "flowChartManualOperation", "flowChartMerge", "flowChartMultidocument", "flowChartOfflineStorage", "flowChartOffpageConnector", "flowChartOnlineStorage", "flowChartOr", "flowChartPredefinedProcess", "flowChartPreparation", "flowChartProcess", "flowChartPunchedCard", "flowChartPunchedTape", "flowChartSort", "flowChartSummingJunction", "flowChartTerminator",
  "foldedCorner", "frame", "funnel", "gear6", "gear9", "halfFrame", "heart", "heptagon", "hexagon", "homePlate", "horizontalScroll",
  "irregularSeal1", "irregularSeal2", "leftArrow", "leftArrowCallout", "leftBrace", "leftBracket", "leftCircularArrow", "leftRightArrow", "leftRightArrowCallout", "leftRightCircularArrow", "leftRightRibbon", "leftRightUpArrow", "leftUpArrow", "lightningBolt", "line", "lineInv",
  "mathDivide", "mathEqual", "mathMinus", "mathMultiply", "mathNotEqual", "mathPlus", "moon", "noSmoking", "nonIsoscelesTrapezoid", "notchedRightArrow", "octagon", "parallelogram", "pentagon", "pie", "pieWedge", "plaque", "plaqueTabs", "plus",
  "quadArrow", "quadArrowCallout", "rect", "ribbon", "ribbon2", "rightArrow", "rightArrowCallout", "rightBrace", "rightBracket", "round1Rect", "round2DiagRect", "round2SameRect", "roundRect", "rtTriangle",
  "smileyFace", "snip1Rect", "snip2DiagRect", "snip2SameRect", "snipRoundRect", "squareTabs", "star10", "star12", "star16", "star24", "star32", "star4", "star5", "star6", "star7", "star8", "stripedRightArrow", "sun", "swooshArrow",
  "teardrop", "trapezoid", "triangle", "upArrow", "upArrowCallout", "upDownArrow", "upDownArrowCallout", "uturnArrow", "verticalScroll", "wave", "wedgeEllipseCallout", "wedgeRectCallout", "wedgeRoundRectCallout",
] as const;

export type NativeShapePreset = typeof NATIVE_SHAPE_PRESETS[number];
const NATIVE_SHAPE_SET = new Set<string>(NATIVE_SHAPE_PRESETS);

export const LEGACY_SHAPE_ALIASES = {
  rectangle: "rect",
  "rounded-rectangle": "roundRect",
  ellipse: "ellipse",
  line: "line",
} as const satisfies Record<string, NativeShapePreset>;

/**
 * Invalid ppt-rs preset names are never passed through to OOXML. Exact spelling
 * fixes and clear semantic equivalents map to valid presets. Names without a
 * faithful preset remain unsupported until custom geometry is implemented.
 */
export const PPT_RS_SHAPE_COMPATIBILITY = {
  flowChartData: "flowChartInputOutput",
  flowChartOffPageConnector: "flowChartOffpageConnector",
  curvedLeftRightArrow: "leftRightCircularArrow",
  curvedUpDownArrow: "upDownArrow",
  pentArrow: "homePlate",
  isoTrapezoid: "trapezoid",
  cone: null,
  cylinder: "can",
  musicNote: null,
  seal: "irregularSeal1",
  seal4: "star4",
  seal8: "star8",
  seal16: "star16",
  seal32: "star32",
} as const satisfies Record<string, NativeShapePreset | null>;

export type ShapePresetInput = NativeShapePreset | keyof typeof LEGACY_SHAPE_ALIASES | keyof typeof PPT_RS_SHAPE_COMPATIBILITY;

export function resolveNativeShapePreset(value: string): { preset: NativeShapePreset; compatibilityAlias?: string } | undefined {
  if (NATIVE_SHAPE_SET.has(value)) return { preset: value as NativeShapePreset };
  const legacy = LEGACY_SHAPE_ALIASES[value as keyof typeof LEGACY_SHAPE_ALIASES];
  if (legacy) return { preset: legacy, compatibilityAlias: value };
  const compatible = PPT_RS_SHAPE_COMPATIBILITY[value as keyof typeof PPT_RS_SHAPE_COMPATIBILITY];
  if (compatible) return { preset: compatible, compatibilityAlias: value };
  return undefined;
}
