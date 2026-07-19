// Native slide-transition XML adapted from ppt-rs transition.rs (Apache-2.0),
// expanded with explicit timing and downgrade evidence.
export const NATIVE_PPTX_TRANSITION_KINDS = ["none", "cut", "fade", "push", "wipe", "split", "reveal", "cover", "zoom"] as const;
export type NativePptxTransitionKind = typeof NATIVE_PPTX_TRANSITION_KINDS[number];
export type NativePptxDirection = "left" | "right" | "up" | "down";
export interface NativePptxTransition {
  kind: NativePptxTransitionKind;
  direction?: NativePptxDirection;
  speed?: "slow" | "medium" | "fast";
  durationMs?: number;
  splitOrientation?: "horizontal" | "vertical";
  splitDirection?: "in" | "out";
  zoomDirection?: "in" | "out";
}
export interface NativeTransitionMapping {
  transition: NativePptxTransition;
  exact: boolean;
  sourceKind: string;
  reason?: string;
}

const directionCode = (direction: NativePptxDirection | undefined) => ({ left: "l", right: "r", up: "u", down: "d" } as const)[direction ?? "right"];
const speedCode = (speed: NativePptxTransition["speed"] | undefined) => ({ slow: "slow", medium: "med", fast: "fast" } as const)[speed ?? "medium"];
const DIRECTIONAL_KINDS = new Set<NativePptxTransitionKind>(["push", "wipe", "reveal", "cover"]);
const P14_NAMESPACE = "http://schemas.microsoft.com/office/powerpoint/2010/main";

export function assertNativePptxTransition(value: unknown): asserts value is NativePptxTransition {
  if (!value || typeof value !== "object") throw new TypeError("native transition must be an object");
  const spec = value as Partial<NativePptxTransition>;
  if (!(NATIVE_PPTX_TRANSITION_KINDS as readonly unknown[]).includes(spec.kind)) throw new TypeError("native transition kind is unsupported");
  if (spec.speed !== undefined && !(["slow", "medium", "fast"] as unknown[]).includes(spec.speed)) throw new TypeError("native transition speed is unsupported");
  if (spec.durationMs !== undefined && (!Number.isInteger(spec.durationMs) || spec.durationMs < 0 || spec.durationMs > 86_400_000)) throw new TypeError("native transition durationMs must be an integer from 0 to 86400000");
  if (spec.direction !== undefined && !(["left", "right", "up", "down"] as unknown[]).includes(spec.direction)) throw new TypeError("native transition direction is unsupported");
  if (spec.splitOrientation !== undefined && !(["horizontal", "vertical"] as unknown[]).includes(spec.splitOrientation)) throw new TypeError("native transition splitOrientation is unsupported");
  if (spec.splitDirection !== undefined && !(["in", "out"] as unknown[]).includes(spec.splitDirection)) throw new TypeError("native transition splitDirection is unsupported");
  if (spec.zoomDirection !== undefined && !(["in", "out"] as unknown[]).includes(spec.zoomDirection)) throw new TypeError("native transition zoomDirection is unsupported");
  if (spec.kind === "none" && Object.keys(spec).some((key) => key !== "kind")) throw new TypeError("native transition kind none cannot declare transition options");
  if (spec.kind === "split") {
    if (spec.direction !== undefined) throw new TypeError("native split transition must use splitOrientation and splitDirection rather than direction");
  } else if (spec.splitOrientation !== undefined || spec.splitDirection !== undefined) throw new TypeError("native splitOrientation and splitDirection are only valid for split transitions");
  if (spec.kind !== "zoom" && spec.zoomDirection !== undefined) throw new TypeError("native zoomDirection is only valid for zoom transitions");
  if (spec.direction !== undefined && !DIRECTIONAL_KINDS.has(spec.kind!)) throw new TypeError(`native ${spec.kind} transition does not support a cardinal direction`);
}

export function nativeTransitionXml(spec: NativePptxTransition): string {
  assertNativePptxTransition(spec);
  if (spec.kind === "none") return "";
  const usesP14 = spec.kind === "reveal" || spec.durationMs !== undefined;
  const attributes = [`spd=\"${speedCode(spec.speed)}\"`, ...(usesP14 ? [`xmlns:p14=\"${P14_NAMESPACE}\"`] : []), ...(spec.durationMs !== undefined ? [`p14:dur=\"${spec.durationMs}\"`] : [])].join(" ");
  const direction = directionCode(spec.direction);
  const child = spec.kind === "cut" ? "<p:cut/>"
    : spec.kind === "fade" ? "<p:fade/>"
      : spec.kind === "push" ? `<p:push dir=\"${direction}\"/>`
        : spec.kind === "wipe" ? `<p:wipe dir=\"${direction}\"/>`
          : spec.kind === "split" ? `<p:split dir=\"${spec.splitDirection ?? "out"}\" orient=\"${spec.splitOrientation === "vertical" ? "vert" : "horz"}\"/>`
            : spec.kind === "reveal" ? `<p14:reveal dir=\"${direction}\"/>`
              : spec.kind === "cover" ? `<p:cover dir=\"${direction}\"/>`
                : `<p:zoom dir=\"${spec.zoomDirection ?? "in"}\"/>`;
  return `<p:transition ${attributes}>${child}</p:transition>`;
}

export function mapStudioTransitionToNative(kind: string, durationMs?: number, direction?: string): NativeTransitionMapping {
  const directionAliases: Record<string, NativePptxDirection> = { left: "left", right: "right", up: "up", down: "down", ltr: "right", rtl: "left", ttb: "down", btt: "up" };
  const nativeDirection = direction ? directionAliases[direction] : undefined;
  const withCommon = (transition: NativePptxTransition, preserveDirection = false): NativePptxTransition => ({ ...transition, ...(durationMs !== undefined ? { durationMs } : {}), ...(preserveDirection && nativeDirection ? { direction: nativeDirection } : {}) });
  if (kind === "none") return { sourceKind: kind, exact: true, transition: { kind: "none" } };
  if (kind === "crossfade") return { sourceKind: kind, exact: true, transition: withCommon({ kind: "fade" }) };
  if (kind === "slide") return { sourceKind: kind, exact: true, transition: withCommon({ kind: "push" }, true) };
  if (kind === "zoom") {
    const exact = direction === undefined || direction === "in" || direction === "out";
    return { sourceKind: kind, exact, transition: withCommon({ kind: "zoom", ...(direction === "in" || direction === "out" ? { zoomDirection: direction } : {}) }), ...(!exact ? { reason: `zoom direction ${direction} has no native PowerPoint equivalent and was downgraded to in` } : {}) };
  }
  if (kind === "clip-wipe") return { sourceKind: kind, exact: true, transition: withCommon({ kind: "wipe" }, true) };
  if (kind === "slice-horizontal") return { sourceKind: kind, exact: true, transition: withCommon({ kind: "split", splitOrientation: "horizontal" }) };
  if (kind === "slice-vertical") return { sourceKind: kind, exact: true, transition: withCommon({ kind: "split", splitOrientation: "vertical" }) };
  return { sourceKind: kind, exact: false, transition: withCommon({ kind: "fade" }), reason: `${kind} has no equivalent native PowerPoint transition and was downgraded to fade` };
}
