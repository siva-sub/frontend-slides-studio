import { describe, expect, it, vi } from "vitest";
import { PresentationSessionController, type PresentationTransport } from "../src/index.js";
import type { PresentationSessionMessage } from "@slides-studio/protocol";

const REVISION = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

class MemoryHub {
  transports = new Set<MemoryTransport>();
  messages: PresentationSessionMessage[] = [];
  create(): MemoryTransport { const transport = new MemoryTransport(this); this.transports.add(transport); return transport; }
  publish(sender: MemoryTransport, message: PresentationSessionMessage): void {
    this.messages.push(structuredClone(message));
    for (const transport of this.transports) if (transport !== sender && !transport.closed) transport.deliver(message);
  }
}

class MemoryTransport implements PresentationTransport {
  listeners = new Set<(message: unknown) => void>();
  closed = false;
  constructor(readonly hub: MemoryHub) {}
  post(message: PresentationSessionMessage): void { this.hub.publish(this, message); }
  subscribe(listener: (message: unknown) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  deliver(message: unknown): void { for (const listener of this.listeners) listener(structuredClone(message)); }
  close(): void { this.closed = true; this.listeners.clear(); }
}

function controller(hub: MemoryHub, role: "presenter" | "audience", senderId: string, overrides: Partial<ConstructorParameters<typeof PresentationSessionController>[0]> = {}) {
  return new PresentationSessionController({
    sessionId: "session-1",
    deckId: "deck-1",
    revision: REVISION,
    senderRole: role,
    senderId,
    slideIds: ["slide-01", "slide-02", "slide-03"],
    transport: hub.create(),
    heartbeatMs: 0,
    now: () => 10_000,
    ...overrides,
  });
}

describe("PresentationSessionController", () => {
  it("synchronizes bidirectional navigation and never transports speaker notes", () => {
    const hub = new MemoryHub();
    const audience = controller(hub, "audience", "audience-a");
    const presenter = controller(hub, "presenter", "presenter-a");
    presenter.goTo(2);
    expect(audience.currentIndex).toBe(2);
    audience.previous();
    expect(presenter.currentIndex).toBe(1);
    expect(hub.messages.every((message) => !("notes" in message) && !JSON.stringify(message).includes("speaker secret"))).toBe(true);
    audience.destroy(); presenter.destroy();
  });

  it("rejects stale, cross-session, wrong-revision, and invalid-slide messages", () => {
    const hub = new MemoryHub();
    const audience = controller(hub, "audience", "audience-a");
    const presenter = controller(hub, "presenter", "presenter-a");
    presenter.goTo(2);
    const latest = [...hub.messages].reverse().find((message) => message.type === "presentation:navigation")!;
    expect(audience.receive({ ...latest, seq: latest.seq - 1, slideIndex: 0, slideId: "slide-01" })).toBe(false);
    expect(audience.receive({ ...latest, sessionId: "other", seq: latest.seq + 10, slideIndex: 0, slideId: "slide-01" })).toBe(false);
    expect(audience.receive({ ...latest, revision: "0".repeat(64), seq: latest.seq + 11, slideIndex: 0, slideId: "slide-01" })).toBe(false);
    expect(audience.receive({ ...latest, seq: latest.seq + 12, slideIndex: 1, slideId: "wrong" })).toBe(false);
    expect(audience.currentIndex).toBe(2);
    audience.destroy(); presenter.destroy();
  });

  it("rejects malformed payloads without throwing or poisoning later valid state", () => {
    const hub = new MemoryHub();
    const receiver = controller(hub, "audience", "receiver");
    const base = { namespace: "slides-studio-presentation" as const, protocolVersion: 1 as const, sessionId: "session-1", deckId: "deck-1", revision: REVISION, senderRole: "presenter" as const, senderId: "malformed", sentAt: 10_000 };
    expect(() => receiver.receive({ ...base, seq: 100, type: "presentation:state" })).not.toThrow();
    expect(receiver.receive({ ...base, seq: 101, type: "presentation:timer", status: "running", action: "resume", timer: { running: true, elapsedMs: -1, anchorEpochMs: null } })).toBe(false);
    expect(receiver.receive({ ...base, seq: -1, type: "presentation:heartbeat", currentSlideIndex: 0 })).toBe(false);
    expect(receiver.receive({ ...base, seq: 1_000, type: "presentation:navigation", slideIndex: 1, slideId: "wrong", slideCount: 3 })).toBe(false);
    expect(receiver.receive({ ...base, seq: 5, type: "presentation:navigation", slideIndex: 1, slideId: "slide-02", slideCount: 3 })).toBe(true);
    expect(receiver.currentIndex).toBe(1);
    receiver.destroy();
  });

  it("resolves equal Lamport sequences deterministically by sender ID", () => {
    const hub = new MemoryHub();
    const receiver = controller(hub, "audience", "receiver");
    const base = {
      namespace: "slides-studio-presentation" as const,
      protocolVersion: 1 as const,
      sessionId: "session-1",
      deckId: "deck-1",
      revision: REVISION,
      seq: 50,
      sentAt: 10_000,
      type: "presentation:navigation" as const,
      senderRole: "presenter" as const,
      slideCount: 3,
    };
    expect(receiver.receive({ ...base, senderId: "alpha", slideIndex: 1, slideId: "slide-02" })).toBe(true);
    expect(receiver.receive({ ...base, senderId: "aardvark", slideIndex: 0, slideId: "slide-01" })).toBe(false);
    expect(receiver.receive({ ...base, senderId: "zulu", slideIndex: 2, slideId: "slide-03" })).toBe(true);
    expect(receiver.currentIndex).toBe(2);
    receiver.destroy();
  });

  it("shares pause, resume, reset, and end timer state", () => {
    const hub = new MemoryHub();
    let now = 1_000;
    const audience = controller(hub, "audience", "audience-a", { now: () => now });
    const presenter = controller(hub, "presenter", "presenter-a", { now: () => now });
    now = 4_500;
    presenter.pauseTimer();
    expect(audience.state.status).toBe("paused");
    expect(audience.state.timer.elapsedMs).toBe(3500);
    now = 5_000;
    presenter.resumeTimer();
    now = 7_000;
    expect(presenter.elapsedMs).toBe(5500);
    presenter.resetTimer();
    expect(audience.state.timer.elapsedMs).toBe(0);
    presenter.end();
    expect(audience.state.status).toBe("ended");
    audience.destroy(); presenter.destroy();
  });

  it("tracks reconnects, goodbye, and heartbeat timeout", () => {
    vi.useFakeTimers();
    let now = 0;
    const hub = new MemoryHub();
    const audience = controller(hub, "audience", "audience-a", { now: () => now, heartbeatMs: 100, peerTimeoutMs: 250 });
    const presenter = controller(hub, "presenter", "presenter-a", { now: () => now, heartbeatMs: 100, peerTimeoutMs: 250 });
    expect(audience.peers.some((peer) => peer.role === "presenter" && peer.connected)).toBe(true);
    presenter.destroy("reloaded");
    expect(audience.peers.find((peer) => peer.senderId === "presenter-a")?.connected).toBe(false);
    const presenter2 = controller(hub, "presenter", "presenter-b", { now: () => now, heartbeatMs: 100, peerTimeoutMs: 250 });
    expect(audience.peers.find((peer) => peer.senderId === "presenter-b")?.connected).toBe(true);
    now = 1_000;
    presenter2.transport.close();
    audience.prunePeers();
    expect(audience.peers.find((peer) => peer.senderId === "presenter-b")?.connected).toBe(false);
    audience.destroy(); presenter2.destroy();
    vi.useRealTimers();
  });
});
