import { describe, expect, it, vi } from "vitest";
import { buildAudienceDocument, createPresentationSession, loadPresentationBootstrap, presentationRoute, presentationSlideIds, withPresentationBase } from "./presentation";

const REVISION = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const deck = '<!doctype html><html><head></head><body><main class="deck-stage"><section class="slide" data-slide-id="s1"><h1>One</h1><script type="text/plain" data-speaker-notes>Secret</script></section><section class="slide" data-slide-id="s2" data-slide-skipped="true">Two</section><section class="slide" data-slide-id="s3">Three</section></main></body></html>';

describe("presentation client", () => {
  it("creates sessions without putting the Studio token into role URLs", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({ "x-slides-studio-session": "studio-secret" });
      return new Response(JSON.stringify({ sessionId: "p1", deckId: "deck", revision: REVISION, presenterUrl: "/?view=presenter&capability=presenter-cap", audienceUrl: "/?view=audience&capability=audience-cap" }), { status: 201, headers: { "content-type": "application/json" } });
    });
    const result = await createPresentationSession({ token: "studio-secret" }, fetcher as typeof fetch);
    expect(result.presenterUrl).not.toContain("studio-secret");
    expect(result.audienceUrl).not.toContain("studio-secret");
  });

  it("rejects audience bootstrap that contains speaker notes", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionId: "p1", deckId: "deck", revision: REVISION, role: "audience", html: deck, assetBaseUrl: "/assets/" }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(loadPresentationBootstrap("p1", "cap", fetcher as typeof fetch)).rejects.toThrow(/private speaker-note metadata/);
  });

  it("builds a notes-free audience document with a contained asset base and host bridge", () => {
    const audience = buildAudienceDocument(deck, "/api/presentation-assets/p1/cap/");
    expect(audience).not.toContain("data-speaker-notes");
    expect(audience).not.toContain("Secret");
    expect(new DOMParser().parseFromString(audience, "text/html").querySelector("base")?.getAttribute("href")).toBe("/api/presentation-assets/p1/cap/");
    expect(audience).toContain("slides-studio:presentation-state");
    expect(presentationSlideIds(deck)).toEqual(["s1", "s3"]);
  });

  it("parses only complete role routes and replaces prior presentation bases", () => {
    expect(presentationRoute("?view=presenter&presentation=p1&capability=cap")).toEqual({ role: "presenter", sessionId: "p1", capability: "cap" });
    expect(presentationRoute("?view=audience&presentation=p1")).toBeNull();
    const once = withPresentationBase(deck, "/one/");
    const twice = withPresentationBase(once, "/two/");
    expect(new DOMParser().parseFromString(twice, "text/html").querySelectorAll("base[data-slides-studio-presentation]")).toHaveLength(1);
    expect(twice).toContain('href="/two/"');
  });
});
