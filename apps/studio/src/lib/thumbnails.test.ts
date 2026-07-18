import { describe, expect, it } from "vitest";
import { buildSlideThumbnails } from "./thumbnails";

const source = `<!doctype html><html><head><style>.deck-stage{width:1280px;height:720px}.slide{display:none}.slide.active{display:block}</style></head><body><main class="deck-stage"><section class="slide active" data-slide-id="one"><h1>First preview</h1><script>window.bad=true</script></section><section class="slide" data-slide-id="two" data-slide-skipped="true"><h2>Second preview</h2></section></main><script>window.deck=true</script></body></html>`;

describe("slide thumbnails", () => {
  it("builds one frozen script-stripped preview per slide including slide one", () => {
    const thumbnails = buildSlideThumbnails(source);
    expect(thumbnails).toHaveLength(2);
    expect(thumbnails[0]).toMatchObject({ index: 0, slideId: "one", label: "First preview", skipped: false });
    expect(thumbnails[1]).toMatchObject({ index: 1, slideId: "two", label: "Second preview", skipped: true });
    expect(thumbnails[0]!.html).toContain("First preview");
    expect(thumbnails[0]!.html).not.toContain("Second preview");
    expect(thumbnails[0]!.html).not.toContain("window.bad");
    expect(thumbnails[0]!.html).toContain("slides-studio-thumbnail");
  });

  it("refreshes content when the source changes", () => {
    expect(buildSlideThumbnails(source.replace("First preview", "Updated preview"))[0]!.label).toBe("Updated preview");
  });
});
