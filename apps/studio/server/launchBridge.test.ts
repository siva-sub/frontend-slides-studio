import { describe, expect, it } from "vitest";
import { stripSpeakerNotesFromHtml } from "./launchBridge";

describe("presentation launch bridge", () => {
  it("removes speaker-note scripts regardless of attribute order", () => {
    const source = '<section class="slide"><script data-speaker-notes type="text/plain">Private A</script><h1>Visible</h1><script type="text/plain" data-other data-speaker-notes="">Private B</script><script type="application/json" data-deck-goal>{"ok":true}</script></section>';
    const audience = stripSpeakerNotesFromHtml(source);
    expect(audience).toContain("Visible");
    expect(audience).toContain("data-deck-goal");
    expect(audience).not.toContain("Private A");
    expect(audience).not.toContain("Private B");
    expect(audience).not.toContain("data-speaker-notes");
  });

  it("fails closed when note metadata survives outside a script", () => {
    expect(() => stripSpeakerNotesFromHtml('<section data-speaker-notes="leak">Visible</section>')).toThrow(/still contains/);
  });
});
