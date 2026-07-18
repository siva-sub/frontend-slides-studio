import type { DiagramEdge, DiagramNode } from "@slides-studio/protocol";
import type { Box, Point, RoutedEdge } from "./primitives.js";

const GRID = 4;
const roundGrid = (value: number) => Math.round(value / GRID) * GRID;

export function intersectsBox(start: Point, end: Point, box: Box): boolean {
  if (start.x === end.x) return start.x > box.x && start.x < box.x + box.width && Math.max(start.y, end.y) > box.y && Math.min(start.y, end.y) < box.y + box.height;
  if (start.y === end.y) return start.y > box.y && start.y < box.y + box.height && Math.max(start.x, end.x) > box.x && Math.min(start.x, end.x) < box.x + box.width;
  return false;
}

export function roundedPath(points: Point[], radius = 8): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const inLength = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    const outLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const before = { x: current.x + Math.sign(previous.x - current.x) * r, y: current.y + Math.sign(previous.y - current.y) * r };
    const after = { x: current.x + Math.sign(next.x - current.x) * r, y: current.y + Math.sign(next.y - current.y) * r };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}

function segmentCrossing(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const aHorizontal = a1.y === a2.y;
  const bHorizontal = b1.y === b2.y;
  if (aHorizontal === bHorizontal) return null;
  const horizontalStart = aHorizontal ? a1 : b1;
  const horizontalEnd = aHorizontal ? a2 : b2;
  const verticalStart = aHorizontal ? b1 : a1;
  const verticalEnd = aHorizontal ? b2 : a2;
  const x = verticalStart.x;
  const y = horizontalStart.y;
  const withinHorizontal = x > Math.min(horizontalStart.x, horizontalEnd.x) && x < Math.max(horizontalStart.x, horizontalEnd.x);
  const withinVertical = y > Math.min(verticalStart.y, verticalEnd.y) && y < Math.max(verticalStart.y, verticalEnd.y);
  return withinHorizontal && withinVertical ? { x, y } : null;
}

function addCrossingBridges(edges: RoutedEdge[]): RoutedEdge[] {
  return edges.map((edge, edgeIndex) => {
    const bridges: Point[] = [];
    for (const earlier of edges.slice(0, edgeIndex)) {
      if ([edge.edge.source, edge.edge.target].some((id) => id === earlier.edge.source || id === earlier.edge.target)) continue;
      for (let currentIndex = 0; currentIndex < edge.points.length - 1; currentIndex += 1) {
        for (let earlierIndex = 0; earlierIndex < earlier.points.length - 1; earlierIndex += 1) {
          const crossing = segmentCrossing(edge.points[currentIndex]!, edge.points[currentIndex + 1]!, earlier.points[earlierIndex]!, earlier.points[earlierIndex + 1]!);
          if (crossing && !bridges.some((point) => point.x === crossing.x && point.y === crossing.y)) bridges.push(crossing);
        }
      }
    }
    return { ...edge, bridges };
  });
}

export function routeOrthogonal(edges: DiagramEdge[], nodes: Map<string, DiagramNode & Box>): RoutedEdge[] {
  const sourceOrder = new Map<string, DiagramEdge[]>();
  const targetOrder = new Map<string, DiagramEdge[]>();
  for (const edge of edges) {
    sourceOrder.set(edge.source, [...(sourceOrder.get(edge.source) ?? []), edge]);
    targetOrder.set(edge.target, [...(targetOrder.get(edge.target) ?? []), edge]);
  }
  const routed = edges.flatMap((edge, edgeIndex) => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) return [];
    const primarilyHorizontal = Math.abs((target.x + target.width / 2) - (source.x + source.width / 2)) >= Math.abs((target.y + target.height / 2) - (source.y + source.height / 2));
    const sourceFan = sourceOrder.get(edge.source) ?? [edge];
    const targetFan = targetOrder.get(edge.target) ?? [edge];
    const sourceIndex = sourceFan.findIndex((item) => item.id === edge.id) + 1;
    const targetIndex = targetFan.findIndex((item) => item.id === edge.id) + 1;
    let start: Point;
    let end: Point;
    if (primarilyHorizontal) {
      const rightward = target.x > source.x;
      start = { x: rightward ? source.x + source.width : source.x, y: roundGrid(source.y + (source.height * sourceIndex) / (sourceFan.length + 1)) };
      end = { x: rightward ? target.x : target.x + target.width, y: roundGrid(target.y + (target.height * targetIndex) / (targetFan.length + 1)) };
    } else {
      const downward = target.y > source.y;
      start = { x: roundGrid(source.x + (source.width * sourceIndex) / (sourceFan.length + 1)), y: downward ? source.y + source.height : source.y };
      end = { x: roundGrid(target.x + (target.width * targetIndex) / (targetFan.length + 1)), y: downward ? target.y : target.y + target.height };
    }
    let points: Point[] | undefined;
    const obstacles = [...nodes.values()].filter((node) => node.id !== source.id && node.id !== target.id);
    if (start.x === end.x || start.y === end.y) {
      if (!obstacles.some((box) => intersectsBox(start, end, box))) points = [start, end];
      else if (start.x === end.x) {
        let detourX = roundGrid(Math.max(source.x + source.width, target.x + target.width) + 32 + (edgeIndex % 3) * 16);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const candidate: Point[] = [start, { x: detourX, y: start.y }, { x: detourX, y: end.y }, end];
          if (!obstacles.some((box) => candidate.slice(0, -1).some((point, index) => intersectsBox(point, candidate[index + 1]!, box)))) { points = candidate; break; }
          detourX += 24;
        }
        points ??= [start, { x: detourX, y: start.y }, { x: detourX, y: end.y }, end];
      } else {
        let detourY = roundGrid(Math.max(source.y + source.height, target.y + target.height) + 32 + (edgeIndex % 3) * 16);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const candidate: Point[] = [start, { x: start.x, y: detourY }, { x: end.x, y: detourY }, end];
          if (!obstacles.some((box) => candidate.slice(0, -1).some((point, index) => intersectsBox(point, candidate[index + 1]!, box)))) { points = candidate; break; }
          detourY += 24;
        }
        points ??= [start, { x: start.x, y: detourY }, { x: end.x, y: detourY }, end];
      }
    } else if (primarilyHorizontal) {
      let middleX = roundGrid((start.x + end.x) / 2 + (edgeIndex % 3 - 1) * 12);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate: Point[] = [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
        if (!obstacles.some((box) => candidate.slice(0, -1).some((point, index) => intersectsBox(point, candidate[index + 1]!, box)))) { points = candidate; break; }
        middleX += 24;
      }
      points ??= [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
    } else {
      let middleY = roundGrid((start.y + end.y) / 2 + (edgeIndex % 3 - 1) * 12);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate: Point[] = [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
        if (!obstacles.some((box) => candidate.slice(0, -1).some((point, index) => intersectsBox(point, candidate[index + 1]!, box)))) { points = candidate; break; }
        middleY += 24;
      }
      points ??= [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
    }
    const middle = points[Math.floor(points.length / 2)]!;
    return [{ edge, points, path: roundedPath(points), labelPoint: { x: middle.x, y: middle.y - 16 }, bridges: [] }];
  });
  return addCrossingBridges(routed);
}
