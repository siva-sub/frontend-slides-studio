import { describe, expect, it, vi } from "vitest";
import { injectStudioBridge } from "./bridge";

function box(element: Element, width: number, height: number): void {
  Object.defineProperties(element, { offsetWidth: { configurable: true, value: width }, offsetHeight: { configurable: true, value: height }, clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height }, scrollWidth: { configurable: true, value: width }, scrollHeight: { configurable: true, value: height }, getBoundingClientRect: { configurable: true, value: () => ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() { return this; } }) } });
}

describe("Studio bridge quality reporting", () => {
  it("runs the sandbox-local rendered audit and posts a protocol report", () => {
    const source = '<!doctype html><html><head></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="s1"><h1 data-object-id="title">Title</h1></section></main></body></html>';
    const injected = injectStudioBridge(source);
    const parsed = new DOMParser().parseFromString(injected, "text/html");
    const bridgeSource = parsed.querySelector<HTMLScriptElement>("script[data-slides-studio-bridge]")?.textContent;
    expect(bridgeSource).toContain("studio:quality-request");
    document.documentElement.innerHTML = '<head></head><body><main class="deck-stage"><section class="slide active visible" data-slide-id="s1"><h1 data-object-id="title">Title</h1></section></main></body>';
    const stage = document.querySelector(".deck-stage")!; const slide = document.querySelector(".slide")!; const title = document.querySelector("h1")!;
    box(stage, 1280, 720); box(slide, 1280, 720); box(title, 400, 80);
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    window.eval(bridgeSource!);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "studio:quality-request", protocolVersion: 1, requestId: "audit-1", slideIndex: 0, mode: "imported", strict: false } }));
    const reportCall = postMessage.mock.calls.map((call) => call[0] as { type?: string; report?: { id: string; summary: { total: number } } }).find((message) => message.type === "studio:quality-report");
    expect(reportCall?.report?.id).toBe("audit-1");
    expect(reportCall?.report?.summary.total).toBe(0);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "studio:quality-focus", protocolVersion: 1, objectId: "title", bounds: [0, 0, 400, 80], durationMs: 10_000 } }));
    expect(document.querySelector("h1")?.getAttribute("data-studio-selected")).toBe("true");
    expect(document.querySelector<HTMLElement>("#slides-studio-quality-focus")?.style.width).toBe("400px");
    postMessage.mockRestore();
  });
});
