import type { DiagramEdge, DiagramFamily, DiagramNode, DiagramType } from "@slides-studio/protocol";

export interface Point { x: number; y: number; }
export interface Box extends Point { width: number; height: number; }

export interface RoutedEdge {
  edge: DiagramEdge;
  points: Point[];
  path: string;
  labelPoint: Point;
  bridges: Point[];
}

interface PrimitiveBase {
  id: string;
  sourceId: string;
  z: number;
}

export interface RectPrimitive extends PrimitiveBase, Box {
  kind: "rect";
  fill: string;
  stroke: string;
  radius: number;
  strokeWidth?: number;
  dash?: string;
  opacity?: number;
}

export interface EllipsePrimitive extends PrimitiveBase, Box {
  kind: "ellipse";
  fill: string;
  stroke: string;
  strokeWidth?: number;
  dash?: string;
  opacity?: number;
}

export interface TextPrimitive extends PrimitiveBase, Box {
  kind: "text";
  text: string;
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  align?: "left" | "center" | "right";
  mono?: boolean;
}

export interface ConnectorPrimitive extends PrimitiveBase {
  kind: "connector";
  points: Point[];
  stroke: string;
  strokeWidth?: number;
  dashed?: boolean;
  endArrow?: boolean;
  label?: string;
  labelPoint?: Point;
  bridges?: Point[];
  sourceObjectId?: string;
  targetObjectId?: string;
}

export type DiagramPrimitive = RectPrimitive | EllipsePrimitive | TextPrimitive | ConnectorPrimitive;

export interface DiagramAdapterMetadata {
  type: DiagramType;
  family: DiagramFamily;
  grammar: string;
  budget: { items: number; connections: number };
  allowNodeOverlap?: boolean;
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: Map<string, DiagramNode & Box>;
  edges: RoutedEdge[];
  primitives: DiagramPrimitive[];
  adapter: DiagramAdapterMetadata;
}

export interface DiagramIssue {
  severity: "error" | "warning";
  code: string;
  target?: string;
  message: string;
}
