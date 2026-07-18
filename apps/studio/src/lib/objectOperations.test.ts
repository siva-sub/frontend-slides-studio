import { describe, expect, it } from "vitest";
import { changeObjectLayer, nudgeObject } from "./objectOperations";

const html = '<html><body><section class="slide"><div data-object-id="a" style="z-index:1"></div><div data-object-id="b" style="z-index:2"></div><div data-object-id="c" style="z-index:3"></div></section></body></html>';

describe("object operations", () => {
  it("nudges using independent CSS translate", () => { const next = nudgeObject(html, "b", 10, -2); expect(next).toContain("translate: 10px -2px"); expect(next).toContain('data-tx="10"'); });
  it("normalizes z-order after moving an object to the front", () => { const next = changeObjectLayer(html, "a", "front"); const doc = new DOMParser().parseFromString(next, "text/html"); expect(doc.querySelector<HTMLElement>('[data-object-id="a"]')?.style.zIndex).toBe("3"); expect(doc.querySelector<HTMLElement>('[data-object-id="b"]')?.style.zIndex).toBe("1"); expect(doc.querySelector<HTMLElement>('[data-object-id="c"]')?.style.zIndex).toBe("2"); });
});
