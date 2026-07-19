import { useEffect, useMemo, useRef, useState } from "react";
import type { PresentationPeer, PresentationSessionController as PresentationController } from "@slides-studio/runtime";
import { BroadcastChannelPresentationTransport, PresentationSessionController, presentationChannelName } from "@slides-studio/runtime";
import type { PresentationState } from "@slides-studio/protocol";
import { buildSlideThumbnails } from "./lib/thumbnails";
import { buildAudienceDocument, loadPresentationBootstrap, presentationRoute, presentationSlideIds, withPresentationBase, type PresentationBootstrap } from "./lib/presentation";
import { readPresentationSpeakerNotes, stripSpeakerNotes } from "./lib/speakerNotes";

interface ControllerView {
  controller: PresentationController;
  state: PresentationState;
  peers: PresentationPeer[];
  elapsedMs: number;
}

function formatElapsed(value: number): string {
  const total = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours > 0 ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function usePresentationController(bootstrap: PresentationBootstrap): ControllerView | null {
  const [view, setView] = useState<ControllerView | null>(null);
  useEffect(() => {
    if (!("BroadcastChannel" in window)) { setView(null); return; }
    let controller!: PresentationSessionController;
    const update = (state: PresentationState) => setView({ controller, state, peers: controller.peers, elapsedMs: controller.elapsedMs });
    const updatePeers = (peers: PresentationPeer[]) => setView((current) => current ? { ...current, peers } : { controller, state: controller.state, peers, elapsedMs: controller.elapsedMs });
    controller = new PresentationSessionController({
      sessionId: bootstrap.sessionId,
      deckId: bootstrap.deckId,
      revision: bootstrap.revision,
      senderRole: bootstrap.role,
      senderId: crypto.randomUUID(),
      slideIds: presentationSlideIds(bootstrap.html),
      transport: new BroadcastChannelPresentationTransport(presentationChannelName(bootstrap.sessionId)),
      onStateChange: update,
      onPeersChange: updatePeers,
    });
    setView({ controller, state: controller.state, peers: controller.peers, elapsedMs: controller.elapsedMs });
    const tick = window.setInterval(() => setView((current) => current ? { ...current, elapsedMs: controller.elapsedMs, peers: controller.peers } : current), 250);
    const beforeUnload = () => controller.destroy("reloaded");
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.clearInterval(tick); window.removeEventListener("beforeunload", beforeUnload); controller.destroy(); };
  }, [bootstrap.sessionId, bootstrap.deckId, bootstrap.revision, bootstrap.role]);
  return view;
}

function useAudienceKeyboard(next: () => void, previous: () => void, first: () => void, last: () => void, fullscreen: () => void, exit?: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target as HTMLElement | null)?.closest("input,textarea,button,[contenteditable=true]")) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); next(); }
      if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); previous(); }
      if (event.key === "Home") { event.preventDefault(); first(); }
      if (event.key === "End") { event.preventDefault(); last(); }
      if (event.key.toLowerCase() === "f") { event.preventDefault(); fullscreen(); }
      if (event.key === "Escape" && exit && !document.fullscreenElement) exit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, previous, first, last, fullscreen, exit]);
}

async function enterFullscreen(): Promise<void> {
  if (document.fullscreenElement) return;
  await document.documentElement.requestFullscreen();
}

function AudienceSurface({ html, index, slideCount, reducedMotion, connected, onNext, onPrevious, onFirst, onLast, onExit, title = "Audience presentation" }: {
  html: string;
  index: number;
  slideCount: number;
  reducedMotion: boolean;
  connected: boolean;
  onNext(): void;
  onPrevious(): void;
  onFirst(): void;
  onLast(): void;
  onExit?: () => void;
  title?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const postState = () => frame.current?.contentWindow?.postMessage({ type: "slides-studio:presentation-state", index, reducedMotion }, "*");
  useEffect(postState, [index, reducedMotion, html]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "slides-studio:presentation-command") return;
      if (event.data.command === "next") onNext();
      else if (event.data.command === "previous") onPrevious();
      else if (event.data.command === "first") onFirst();
      else if (event.data.command === "last") onLast();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onNext, onPrevious, onFirst, onLast]);
  useAudienceKeyboard(onNext, onPrevious, onFirst, onLast, () => { void enterFullscreen(); }, onExit);
  return <main className="presentation-audience" data-reduced-motion={reducedMotion}>
    <iframe ref={frame} title={title} sandbox="allow-scripts" allow="fullscreen" allowFullScreen srcDoc={html} onLoad={postState} />
    <div className="audience-status presenter-tools" aria-live="polite"><span className={connected ? "connected" : "solo"}>{connected ? "Presenter connected" : "Presentation only"}</span><b>{index + 1} / {slideCount}</b></div>
    <div className="audience-actions presenter-tools">
      <button onClick={onPrevious} disabled={index === 0} aria-label="Previous slide">←</button>
      <button onClick={() => { void enterFullscreen(); }}>Enter fullscreen <kbd>F</kbd></button>
      <button onClick={onNext} disabled={index >= slideCount - 1} aria-label="Next slide">→</button>
      {onExit && <button onClick={onExit}>Exit presentation</button>}
    </div>
    <div className="presentation-progress" style={{ width: `${((index + 1) / slideCount) * 100}%` }} />
  </main>;
}

function AudienceView({ bootstrap }: { bootstrap: PresentationBootstrap }) {
  const view = usePresentationController(bootstrap);
  const reducedMotion = useReducedMotion();
  const html = useMemo(() => buildAudienceDocument(bootstrap.html, bootstrap.assetBaseUrl), [bootstrap.html, bootstrap.assetBaseUrl]);
  if (!view) return <PresentationFailure message="This browser cannot synchronize presentation windows. Return to Studio and use Presentation only." />;
  const presenterConnected = view.peers.some((peer) => peer.role === "presenter" && peer.connected);
  return <AudienceSurface html={html} index={view.state.slideIndex} slideCount={view.state.slideCount} reducedMotion={reducedMotion} connected={presenterConnected} onNext={() => view.controller.next()} onPrevious={() => view.controller.previous()} onFirst={() => view.controller.goTo(0)} onLast={() => view.controller.goTo(view.state.slideCount - 1)} />;
}

function PresenterView({ bootstrap }: { bootstrap: PresentationBootstrap }) {
  const view = usePresentationController(bootstrap);
  const reducedMotion = useReducedMotion();
  const notes = useMemo(() => readPresentationSpeakerNotes(bootstrap.html), [bootstrap.html]);
  const previews = useMemo(() => buildSlideThumbnails(withPresentationBase(stripSpeakerNotes(bootstrap.html), bootstrap.assetBaseUrl)).filter((slide) => !slide.skipped), [bootstrap.html, bootstrap.assetBaseUrl]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!view) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target as HTMLElement | null)?.closest("input,textarea,button,[contenteditable=true]")) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); view.controller.next(); }
      if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); view.controller.previous(); }
      if (event.key === "Home") { event.preventDefault(); view.controller.goTo(0); }
      if (event.key === "End") { event.preventDefault(); view.controller.goTo(view.state.slideCount - 1); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);
  if (!view) return <PresentationFailure message="This browser cannot synchronize presentation windows. Return to Studio and use Presentation only." />;
  const current = previews[view.state.slideIndex];
  const upcoming = previews[view.state.slideIndex + 1];
  const audienceConnected = view.peers.some((peer) => peer.role === "audience" && peer.connected);
  return <main className="presenter-view" data-reduced-motion={reducedMotion}>
    <header><div><span className="presenter-kicker">PRESENTER VIEW</span><h1>{bootstrap.deckId.split(":")[0]}</h1></div><div className={`connection-pill ${audienceConnected ? "connected" : "disconnected"}`}>{audienceConnected ? "Audience connected" : "Audience disconnected"}</div></header>
    <section className="presenter-current"><span>Current · {view.state.slideIndex + 1}</span>{current ? <iframe title="Current slide preview" sandbox="allow-scripts" srcDoc={current.html} tabIndex={-1} aria-hidden="true" /> : <div className="preview-empty">Current slide unavailable</div>}</section>
    <section className="presenter-next"><span>Next</span>{upcoming ? <iframe title="Next slide preview" sandbox="allow-scripts" srcDoc={upcoming.html} tabIndex={-1} aria-hidden="true" /> : <div className="preview-empty">End of presentation</div>}</section>
    <section className="presenter-metrics">
      <div><small>Elapsed</small><strong>{formatElapsed(view.elapsedMs)}</strong></div>
      <div><small>Clock</small><strong>{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong></div>
      <div><small>Progress</small><strong>{view.state.slideIndex + 1} / {view.state.slideCount}</strong></div>
    </section>
    <section className="presenter-notes"><span>Speaker notes</span><pre>{notes[view.state.slideIndex]?.trim() || "No notes for this slide."}</pre></section>
    <nav className="presenter-controls" aria-label="Presentation controls">
      <button onClick={() => view.controller.previous()} disabled={view.state.slideIndex === 0}>← Previous</button>
      <button onClick={() => view.state.timer.running ? view.controller.pauseTimer() : view.controller.resumeTimer()}>{view.state.timer.running ? "Pause timer" : "Resume timer"}</button>
      <button onClick={() => view.controller.resetTimer()}>Reset timer</button>
      <button onClick={() => { const opened = bootstrap.audienceUrl ? window.open(bootstrap.audienceUrl, `slides-studio-audience-${bootstrap.sessionId}`, "popup,width=1280,height=720") : null; if (!opened) window.alert("Audience popup was blocked. Allow popups, then choose Reopen audience."); }}>Reopen audience</button>
      <button className="primary" onClick={() => view.controller.next()} disabled={view.state.slideIndex >= view.state.slideCount - 1}>Next →</button>
    </nav>
    <div className="presenter-progress"><i style={{ width: `${((view.state.slideIndex + 1) / view.state.slideCount) * 100}%` }} /></div>
  </main>;
}

function PresentationFailure({ message }: { message: string }) { return <main className="presentation-failure"><h1>Presentation view unavailable</h1><p>{message}</p><button onClick={() => window.close()}>Close window</button></main>; }

export function PresentationEntry() {
  const route = presentationRoute();
  const [bootstrap, setBootstrap] = useState<PresentationBootstrap | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (!route) { setError("The presentation URL is incomplete."); return; } void loadPresentationBootstrap(route.sessionId, route.capability).then((result) => { if (result.role !== route.role) throw new Error("Presentation capability role does not match the requested view."); setBootstrap(result); }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);
  if (error) return <PresentationFailure message={error} />;
  if (!bootstrap) return <main className="presentation-loading">Loading presentation…</main>;
  return bootstrap.role === "audience" ? <AudienceView bootstrap={bootstrap} /> : <PresenterView bootstrap={bootstrap} />;
}

export function PresentationOnlyView({ html, onExit }: { html: string; onExit(): void }) {
  const slides = useMemo(() => presentationSlideIds(html), [html]);
  const [index, setIndex] = useState(0);
  const reducedMotion = useReducedMotion();
  const audienceHtml = useMemo(() => buildAudienceDocument(stripSpeakerNotes(html)), [html]);
  const goTo = (value: number) => setIndex(Math.max(0, Math.min(value, slides.length - 1)));
  return <AudienceSurface html={audienceHtml} index={index} slideCount={slides.length} reducedMotion={reducedMotion} connected={false} onNext={() => goTo(index + 1)} onPrevious={() => goTo(index - 1)} onFirst={() => goTo(0)} onLast={() => goTo(slides.length - 1)} onExit={onExit} title="Presentation only" />;
}
