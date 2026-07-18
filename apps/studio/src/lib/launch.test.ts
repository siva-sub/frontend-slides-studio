import { describe, expect, it, vi } from "vitest";
import { launchToken, loadLaunchSession, saveLaunchSession } from "./launch";

describe("Studio launch session client", () => {
  it("reads the launch token and loads the configured source", async () => {
    expect(launchToken("?session=abc%20123")).toBe("abc 123");
    expect(launchToken("?other=value")).toBeNull();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ fileName: "deck.html", sourcePath: "/work/deck.html", html: "<section class=\"slide\"></section>", revision: "a".repeat(64) }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(loadLaunchSession("secret", fetcher as typeof fetch)).resolves.toMatchObject({ token: "secret", fileName: "deck.html", sourcePath: "/work/deck.html" });
    expect(fetcher).toHaveBeenCalledWith("/api/studio-session?token=secret", expect.objectContaining({ headers: { "x-slides-studio-session": "secret" } }));
  });

  it("saves only HTML through the configured launch session", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ saved: true, sourcePath: "/work/deck.html", revision: "b".repeat(64) }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(saveLaunchSession({ token: "secret" }, "<main>saved</main>", fetcher as typeof fetch)).resolves.toMatchObject({ saved: true, sourcePath: "/work/deck.html" });
    expect(fetcher).toHaveBeenCalledWith("/api/studio-session?token=secret", expect.objectContaining({ method: "PUT", body: JSON.stringify({ html: "<main>saved</main>" }) }));
  });

  it("surfaces bridge errors", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "Invalid Studio launch session token." }), { status: 401, headers: { "content-type": "application/json" } }));
    await expect(loadLaunchSession("wrong", fetcher as typeof fetch)).rejects.toThrow(/Invalid Studio launch session token/);
  });
});
