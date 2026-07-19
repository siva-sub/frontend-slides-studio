import type {
  PresentationRole,
  PresentationSessionMessage,
  PresentationState,
  PresentationStatus,
  PresentationTimer,
} from "@slides-studio/protocol";

export interface PresentationTransport {
  post(message: PresentationSessionMessage): void;
  subscribe(listener: (message: unknown) => void): () => void;
  close(): void;
}

export interface PresentationPeer {
  senderId: string;
  role: PresentationRole;
  lastSeenAt: number;
  connected: boolean;
}

export interface PresentationSessionIdentity {
  sessionId: string;
  deckId: string;
  revision: string;
  senderRole: PresentationRole;
  senderId: string;
}

export interface PresentationSessionControllerOptions extends PresentationSessionIdentity {
  slideIds: string[];
  transport: PresentationTransport;
  initialIndex?: number;
  initialStatus?: PresentationStatus;
  initialElapsedMs?: number;
  timerRunning?: boolean;
  heartbeatMs?: number;
  peerTimeoutMs?: number;
  now?: () => number;
  onStateChange?: (state: PresentationState, message?: PresentationSessionMessage) => void;
  onPeersChange?: (peers: PresentationPeer[]) => void;
}

interface LamportTuple { seq: number; senderId: string }

const ROLES = new Set(["studio", "presenter", "audience"]);
const STATUSES = new Set(["idle", "running", "paused", "ended"]);
const STATE_REASONS = new Set(["initial", "navigation", "timer", "reconnect"]);
const TIMER_ACTIONS = new Set(["start", "pause", "resume", "reset", "end"]);
const GOODBYE_REASONS = new Set(["closed", "reloaded", "ended"]);
const nonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const nonemptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function isTimer(value: unknown): value is PresentationTimer {
  if (!value || typeof value !== "object") return false;
  const timer = value as Record<string, unknown>;
  if (typeof timer.running !== "boolean" || !nonnegativeInteger(timer.elapsedMs)) return false;
  if (timer.running) return nonnegativeInteger(timer.anchorEpochMs);
  return timer.anchorEpochMs === null;
}

function isState(value: unknown): value is PresentationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return nonnegativeInteger(state.slideIndex)
    && nonemptyString(state.slideId)
    && nonnegativeInteger(state.slideCount)
    && Number(state.slideCount) > 0
    && Number(state.slideIndex) < Number(state.slideCount)
    && STATUSES.has(String(state.status))
    && isTimer(state.timer);
}

function isSessionMessage(value: unknown): value is PresentationSessionMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.namespace !== "slides-studio-presentation"
    || message.protocolVersion !== 1
    || !nonemptyString(message.sessionId)
    || !nonemptyString(message.deckId)
    || !nonemptyString(message.revision)
    || !/^[a-f0-9]{64}$/i.test(message.revision)
    || !nonnegativeInteger(message.seq)
    || !ROLES.has(String(message.senderRole))
    || !nonemptyString(message.senderId)
    || !nonnegativeInteger(message.sentAt)
    || typeof message.type !== "string") return false;
  if (message.type === "presentation:hello") return typeof message.wantsState === "boolean";
  if (message.type === "presentation:state") return isState(message.state) && STATE_REASONS.has(String(message.reason));
  if (message.type === "presentation:navigation") return nonnegativeInteger(message.slideIndex) && nonemptyString(message.slideId) && nonnegativeInteger(message.slideCount) && Number(message.slideCount) > 0 && Number(message.slideIndex) < Number(message.slideCount);
  if (message.type === "presentation:timer") return STATUSES.has(String(message.status)) && isTimer(message.timer) && TIMER_ACTIONS.has(String(message.action));
  if (message.type === "presentation:heartbeat") return nonnegativeInteger(message.currentSlideIndex);
  if (message.type === "presentation:goodbye") return GOODBYE_REASONS.has(String(message.reason));
  return false;
}

function compareTuple(left: LamportTuple, right: LamportTuple): number {
  return left.seq === right.seq ? left.senderId.localeCompare(right.senderId) : left.seq - right.seq;
}

function cloneTimer(timer: PresentationTimer): PresentationTimer {
  return { running: timer.running, elapsedMs: timer.elapsedMs, anchorEpochMs: timer.anchorEpochMs };
}

function cloneState(state: PresentationState): PresentationState {
  return { slideIndex: state.slideIndex, slideId: state.slideId, slideCount: state.slideCount, status: state.status, timer: cloneTimer(state.timer) };
}

export class BroadcastChannelPresentationTransport implements PresentationTransport {
  readonly channel: BroadcastChannel;
  #listeners = new Set<(message: unknown) => void>();
  #onMessage = (event: MessageEvent<unknown>) => { for (const listener of this.#listeners) listener(event.data); };

  constructor(name: string, Channel: typeof BroadcastChannel = BroadcastChannel) {
    this.channel = new Channel(name);
    this.channel.addEventListener("message", this.#onMessage);
  }

  post(message: PresentationSessionMessage): void { this.channel.postMessage(message); }
  subscribe(listener: (message: unknown) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  close(): void { this.channel.removeEventListener("message", this.#onMessage); this.#listeners.clear(); this.channel.close(); }
}

export function presentationChannelName(sessionId: string): string {
  return `slides-studio:presentation:${sessionId}`;
}

export class PresentationSessionController {
  readonly identity: PresentationSessionIdentity;
  readonly slideIds: string[];
  readonly transport: PresentationTransport;
  readonly heartbeatMs: number;
  readonly peerTimeoutMs: number;
  #state: PresentationState;
  #seq = 0;
  #lastApplied: LamportTuple;
  #peers = new Map<string, PresentationPeer>();
  #now: () => number;
  #onStateChange?: PresentationSessionControllerOptions["onStateChange"];
  #onPeersChange?: PresentationSessionControllerOptions["onPeersChange"];
  #unsubscribe: () => void;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #destroyed = false;

  constructor(options: PresentationSessionControllerOptions) {
    if (options.slideIds.length === 0 || options.slideIds.some((id) => !id.trim())) throw new Error("presentation sessions require at least one non-empty slide ID");
    if (!/^[a-f0-9]{64}$/i.test(options.revision)) throw new Error("presentation revision must be a SHA-256 hex digest");
    this.identity = { sessionId: options.sessionId, deckId: options.deckId, revision: options.revision, senderRole: options.senderRole, senderId: options.senderId };
    this.slideIds = [...options.slideIds];
    this.transport = options.transport;
    this.heartbeatMs = options.heartbeatMs ?? 1000;
    this.peerTimeoutMs = options.peerTimeoutMs ?? Math.max(3500, this.heartbeatMs * 3);
    this.#now = options.now ?? Date.now;
    this.#onStateChange = options.onStateChange;
    this.#onPeersChange = options.onPeersChange;
    const initialIndex = Math.max(0, Math.min(options.initialIndex ?? 0, this.slideIds.length - 1));
    const running = options.timerRunning ?? true;
    const now = this.#now();
    this.#state = {
      slideIndex: initialIndex,
      slideId: this.slideIds[initialIndex]!,
      slideCount: this.slideIds.length,
      status: options.initialStatus ?? (running ? "running" : "idle"),
      timer: { running, elapsedMs: Math.max(0, Math.trunc(options.initialElapsedMs ?? 0)), anchorEpochMs: running ? now : null },
    };
    this.#lastApplied = { seq: 0, senderId: this.identity.senderId };
    this.#unsubscribe = this.transport.subscribe((message) => this.receive(message));
    if (this.heartbeatMs > 0) this.#heartbeat = setInterval(() => { this.prunePeers(); this.#send("presentation:heartbeat", { currentSlideIndex: this.#state.slideIndex }, false); }, this.heartbeatMs);
    this.#send("presentation:hello", { wantsState: true });
  }

  get state(): PresentationState { return cloneState(this.#state); }
  get currentIndex(): number { return this.#state.slideIndex; }
  get peers(): PresentationPeer[] { return Array.from(this.#peers.values(), (peer) => ({ ...peer })).sort((left, right) => left.senderId.localeCompare(right.senderId)); }
  get elapsedMs(): number {
    const timer = this.#state.timer;
    return timer.running && timer.anchorEpochMs !== null ? timer.elapsedMs + Math.max(0, this.#now() - timer.anchorEpochMs) : timer.elapsedMs;
  }

  next(): void { this.goTo(this.#state.slideIndex + 1); }
  previous(): void { this.goTo(this.#state.slideIndex - 1); }
  goTo(index: number): void {
    const next = Math.max(0, Math.min(Math.trunc(index), this.slideIds.length - 1));
    if (next === this.#state.slideIndex) return;
    this.#state = { ...this.#state, slideIndex: next, slideId: this.slideIds[next]!, status: this.#state.status === "ended" ? "ended" : "running" };
    const message = this.#send("presentation:navigation", { slideIndex: next, slideId: this.slideIds[next]!, slideCount: this.slideIds.length });
    this.#markApplied(message);
    this.#emitState(message);
  }

  startTimer(): void {
    this.#state = { ...this.#state, status: "running", timer: { running: true, elapsedMs: 0, anchorEpochMs: this.#now() } };
    this.#publishTimer("start");
  }
  pauseTimer(): void {
    if (!this.#state.timer.running) return;
    this.#state = { ...this.#state, status: "paused", timer: { running: false, elapsedMs: this.elapsedMs, anchorEpochMs: null } };
    this.#publishTimer("pause");
  }
  resumeTimer(): void {
    if (this.#state.timer.running) return;
    this.#state = { ...this.#state, status: "running", timer: { running: true, elapsedMs: this.#state.timer.elapsedMs, anchorEpochMs: this.#now() } };
    this.#publishTimer("resume");
  }
  resetTimer(): void {
    const running = this.#state.timer.running;
    this.#state = { ...this.#state, status: running ? "running" : "paused", timer: { running, elapsedMs: 0, anchorEpochMs: running ? this.#now() : null } };
    this.#publishTimer("reset");
  }
  end(): void {
    this.#state = { ...this.#state, status: "ended", timer: { running: false, elapsedMs: this.elapsedMs, anchorEpochMs: null } };
    this.#publishTimer("end");
  }

  broadcastState(reason: "initial" | "navigation" | "timer" | "reconnect" = "reconnect"): void {
    const message = this.#send("presentation:state", { state: this.state, reason });
    this.#markApplied(message);
  }

  reconnect(): void { this.#send("presentation:hello", { wantsState: true }); }

  receive(input: unknown): boolean {
    if (!isSessionMessage(input) || this.#destroyed) return false;
    const message = input;
    if (message.sessionId !== this.identity.sessionId || message.deckId !== this.identity.deckId || message.revision !== this.identity.revision || message.senderId === this.identity.senderId) return false;
    this.#seq = Math.max(this.#seq, message.seq);
    this.#recordPeer(message.senderId, message.senderRole, message.type !== "presentation:goodbye");
    if (message.type === "presentation:hello") {
      if (message.wantsState) this.broadcastState("reconnect");
      return true;
    }
    if (message.type === "presentation:heartbeat") return true;
    if (message.type === "presentation:goodbye") return true;
    if (!["presentation:state", "presentation:navigation", "presentation:timer"].includes(message.type)) return false;
    const tuple = { seq: message.seq, senderId: message.senderId };
    if (compareTuple(tuple, this.#lastApplied) <= 0) return false;
    if (message.type === "presentation:state") {
      if (message.state.slideCount !== this.slideIds.length || this.slideIds[message.state.slideIndex] !== message.state.slideId) return false;
      this.#state = cloneState(message.state);
    } else if (message.type === "presentation:navigation") {
      if (message.slideCount !== this.slideIds.length || this.slideIds[message.slideIndex] !== message.slideId) return false;
      this.#state = { ...this.#state, slideIndex: message.slideIndex, slideId: message.slideId, status: this.#state.status === "ended" ? "ended" : "running" };
    } else {
      this.#state = { ...this.#state, status: message.status, timer: cloneTimer(message.timer) };
    }
    this.#lastApplied = tuple;
    this.#emitState(message);
    return true;
  }

  prunePeers(): void {
    const now = this.#now();
    let changed = false;
    for (const [senderId, peer] of this.#peers) {
      if (peer.connected && now - peer.lastSeenAt > this.peerTimeoutMs) { this.#peers.set(senderId, { ...peer, connected: false }); changed = true; }
    }
    if (changed) this.#emitPeers();
  }

  destroy(reason: "closed" | "reloaded" | "ended" = "closed"): void {
    if (this.#destroyed) return;
    this.#send("presentation:goodbye", { reason });
    this.#destroyed = true;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    this.#unsubscribe();
    this.transport.close();
  }

  #publishTimer(action: "start" | "pause" | "resume" | "reset" | "end"): void {
    const message = this.#send("presentation:timer", { status: this.#state.status, timer: cloneTimer(this.#state.timer), action });
    this.#markApplied(message);
    this.#emitState(message);
  }

  #send<T extends PresentationSessionMessage["type"]>(type: T, payload: Omit<Extract<PresentationSessionMessage, { type: T }>, keyof PresentationSessionIdentity | "namespace" | "protocolVersion" | "seq" | "sentAt" | "type">, bump = true): Extract<PresentationSessionMessage, { type: T }> {
    if (bump) this.#seq += 1;
    const message = {
      namespace: "slides-studio-presentation",
      protocolVersion: 1,
      ...this.identity,
      type,
      seq: this.#seq,
      sentAt: this.#now(),
      ...payload,
    } as Extract<PresentationSessionMessage, { type: T }>;
    this.transport.post(message);
    return message;
  }

  #markApplied(message: PresentationSessionMessage): void { this.#lastApplied = { seq: message.seq, senderId: message.senderId }; }
  #emitState(message?: PresentationSessionMessage): void { this.#onStateChange?.(this.state, message); }
  #recordPeer(senderId: string, role: PresentationRole, connected: boolean): void {
    const previous = this.#peers.get(senderId);
    const next = { senderId, role, lastSeenAt: this.#now(), connected };
    this.#peers.set(senderId, next);
    if (!previous || previous.connected !== next.connected || previous.role !== next.role) this.#emitPeers();
  }
  #emitPeers(): void { this.#onPeersChange?.(this.peers); }
}
