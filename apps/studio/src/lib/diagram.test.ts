import { describe, expect, it } from "vitest";
import { insertDiagram } from "./diagram";

const theme = { paper: "#f5f5f2", paper2: "#fff", ink: "#20231f", muted: "#6f756d", rule: "#d8dbd4", accent: "#f05a36", accentTint: "#fde8e1", link: "#315f9d", titleFont: "Fraunces", bodyFont: "Manrope", monoFont: "IBM Plex Mono" };
const source = '<!doctype html><html><body><main class="deck-stage"><section class="slide" data-slide-id="one"></section><section class="slide" data-slide-id="two"></section></main></body></html>';
const spec = { schemaVersion: 1 as const, id: "system", type: "architecture" as const, variant: "light" as const, direction: "ltr" as const, theme, nodes: [{ id: "a", label: "A", kind: "step" as const }, { id: "b", label: "B", kind: "store" as const }], edges: [{ id: "a-b", source: "a", target: "b", kind: "link" as const }] };

describe("Studio diagram insertion", () => {
  it("validates, namespaces, and inserts a deterministic diagram on the requested slide", () => {
    const result = insertDiagram(source, 1, spec);
    const document = new DOMParser().parseFromString(result.html, "text/html");
    expect(document.querySelectorAll(".slide")[0]?.querySelector("svg")).toBeNull();
    const figure = document.querySelector<HTMLElement>('[data-object-id="diagram-system"]');
    expect(figure?.closest(".slide")?.getAttribute("data-slide-id")).toBe("two");
    expect(figure?.dataset.sourceId).toBe("system");
    expect(figure?.querySelector("svg")?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(JSON.parse(figure?.querySelector<HTMLScriptElement>('script[data-diagram-spec]')?.textContent ?? "{}").id).toBe("system");
    const ids = Array.from(figure?.querySelectorAll("[id]") ?? [], (element) => element.id);
    expect(ids.every((id) => id.startsWith("diagram-system-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects invalid input and duplicate stable IDs", () => {
    expect(() => insertDiagram(source, 0, { ...spec, nodes: [] })).toThrow();
    const once = insertDiagram(source, 0, spec);
    expect(() => insertDiagram(once.html, 0, spec)).toThrow(/already exists/);
  });
});
