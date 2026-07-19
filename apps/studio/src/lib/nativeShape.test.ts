import { describe, expect, it } from "vitest";
import { insertNativePptxShape } from "./nativeShape.js";

const html = '<!doctype html><html><body><main class="deck-stage"><section class="slide" data-slide-id="s1"></section></main></body></html>';

describe("native PowerPoint shape insertion", () => {
  it("inserts stable export metadata and resolves ppt-rs aliases", () => {
    const inserted = insertNativePptxShape(html, 0, "flowChartOffPageConnector", { text: "Continue" });
    expect(inserted.preset).toBe("flowChartOffpageConnector");
    expect(inserted.html).toContain('data-pptx-shape="flowChartOffpageConnector"');
    expect(inserted.html).toContain('data-object-id="pptx-flowChartOffpageConnector-1"');
    expect(inserted.html).toContain("Continue");
    const duplicate = insertNativePptxShape(inserted.html, 0, "flowChartOffpageConnector");
    expect(duplicate.objectId).toBe("pptx-flowChartOffpageConnector-2");
  });

  it("rejects invalid upstream preset names and missing slides", () => {
    expect(() => insertNativePptxShape(html, 0, "cone")).toThrow(/no schema-valid/);
    expect(() => insertNativePptxShape(html, 2, "chevron")).toThrow(/does not exist/);
  });
});
