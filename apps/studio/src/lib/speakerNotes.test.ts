import { describe, expect, it } from "vitest";
import { applySpeakerNotes, readAllSpeakerNotes, readSpeakerNotes, stripSpeakerNotes } from "./speakerNotes";

const deck = '<!doctype html><html><body><main><section class="slide" data-slide-id="s1"><h1>One</h1></section><section class="slide" data-slide-id="s2"><h1>Two</h1><script type="text/plain" data-speaker-notes>Existing note</script></section></main></body></html>';

describe("speaker notes", () => {
  it("adds, replaces, removes, and reads one notes element per slide", () => {
    const added = applySpeakerNotes(deck, 0, "Opening cue\nPause.");
    expect(readSpeakerNotes(added, 0)).toBe("Opening cue\nPause.");
    const replaced = applySpeakerNotes(added, 0, "Replacement");
    const doc = new DOMParser().parseFromString(replaced, "text/html");
    expect(doc.querySelectorAll('.slide:nth-of-type(1) script[data-speaker-notes]')).toHaveLength(1);
    expect(readAllSpeakerNotes(replaced)).toEqual(["Replacement", "Existing note"]);
    const removed = applySpeakerNotes(replaced, 0, "");
    expect(readSpeakerNotes(removed, 0)).toBe("");
    expect(new DOMParser().parseFromString(removed, "text/html").querySelector('.slide:nth-of-type(1) [data-speaker-notes]')).toBeNull();
  });

  it("round-trips Unicode and a literal closing script sequence safely", () => {
    const privateText = "备注 🎤 </script><script>alert('no')</script>";
    const updated = applySpeakerNotes(deck, 0, privateText);
    const doc = new DOMParser().parseFromString(updated, "text/html");
    const element = doc.querySelector<HTMLScriptElement>('.slide:nth-of-type(1) script[data-speaker-notes]')!;
    expect(element.dataset.speakerNotesEncoding).toBe("base64");
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(readSpeakerNotes(updated, 0)).toBe(privateText);
  });

  it("removes note metadata from audience HTML", () => {
    const updated = applySpeakerNotes(deck, 0, "Private cue");
    const stripped = stripSpeakerNotes(updated);
    expect(stripped).not.toContain("data-speaker-notes");
    expect(stripped).not.toContain("Private cue");
    expect(stripped).not.toContain("Existing note");
  });
});
