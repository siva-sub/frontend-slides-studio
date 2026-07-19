import { describe, expect, it } from "vitest";
import { normalizeDeck } from "./normalizeDeck.js";

const source = `<!doctype html><html><head><meta charset="utf-8"><style>.accent{color:#f05a36;font-weight:700}.nested em{text-decoration:underline}</style></head><body><main><section class="slide" data-slide-id="one"><h1>Entities &amp; Unicode ✓</h1><p class="nested" style="font-size:24px;background-color:rgb(1,2,3);font-family:Georgia">Nested <strong>bold <em>italic</em></strong><br>&lt;text&gt;</p><ul><li style="color:#f05a36">First</li><li>Second</li></ul><a href='https://example.com' title='safe'>Link</a><table><thead><tr><th>Metric</th></tr></thead><tbody><tr><td>42</td></tr></tbody></table><pre><code>const x = 1 &lt; 2;</code></pre><blockquote>Quoted note</blockquote><img src="data:image/png;base64,AA==" alt="Evidence image"><script>window.deckRuntime=true</script></section><section class="slide"><h2>Second</h2><a href="https://example.com">Safe link</a></section></main></body></html>`;

describe("ppt-rs HTML invariants in the DOM-first importer", () => {
  it("preserves entities, Unicode, nested style, tables, images, code, blockquotes, and runtime scripts without flattening", () => {
    const normalized = normalizeDeck(source);
    expect(normalized.slideCount).toBe(2);
    const document = new DOMParser().parseFromString(normalized.html, "text/html");
    expect(document.querySelector("h1")?.textContent).toBe("Entities & Unicode ✓");
    expect(document.querySelector(".nested strong em")?.textContent).toBe("italic");
    expect(document.querySelector(".nested")?.textContent).toContain("<text>");
    expect(document.querySelector(".nested br")).toBeTruthy();
    expect(document.querySelector<HTMLElement>(".nested")?.style.fontFamily).toBe("Georgia");
    expect(document.querySelectorAll("li[data-object-id]")).toHaveLength(2);
    expect(document.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(document.querySelector("a")?.getAttribute("data-object-id")).toBeTruthy();
    expect(document.querySelector("table tbody td")?.textContent).toBe("42");
    expect(document.querySelector("pre code")?.textContent).toContain("1 < 2");
    expect(document.querySelector("pre")?.getAttribute("data-object-id")).toBeTruthy();
    expect(document.querySelector("blockquote")?.dataset.objectId).toBeTruthy();
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("Evidence image");
    expect(document.querySelector("script")?.textContent).toContain("deckRuntime");
    expect(document.querySelector("script")?.hasAttribute("data-object-id")).toBe(false);
    expect(document.querySelectorAll(".slide")).toHaveLength(2);
    expect(document.querySelector("table")?.dataset.objectId).toBeTruthy();
  });

  it("round-trips normalized HTML without changing slide or stable-object identity", () => {
    const first = normalizeDeck(source);
    const second = normalizeDeck(first.html);
    const firstDocument = new DOMParser().parseFromString(first.html, "text/html");
    const secondDocument = new DOMParser().parseFromString(second.html, "text/html");
    expect(second.slideCount).toBe(first.slideCount);
    expect(Array.from(secondDocument.querySelectorAll("[data-object-id]"), (element) => element.getAttribute("data-object-id"))).toEqual(Array.from(firstDocument.querySelectorAll("[data-object-id]"), (element) => element.getAttribute("data-object-id")));
    expect(secondDocument.querySelector("table tbody td")?.textContent).toBe("42");
  });

  it("recovers malformed HTML while preserving a positioned slide tree", () => {
    const normalized = normalizeDeck('<html><body><section class="slide"><h1>Broken &amp; safe<p style="position:absolute;left:10px">Copy<section class="slide"><h2>Two');
    const document = new DOMParser().parseFromString(normalized.html, "text/html");
    expect(normalized.slideCount).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("h1")?.textContent).toContain("Broken & safe");
    expect(document.querySelector<HTMLElement>('p[style]')?.style.left).toBe("10px");
  });
});
