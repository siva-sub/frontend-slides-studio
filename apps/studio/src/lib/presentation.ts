import type { StudioLaunchSession } from "./launch";

export type PresentationViewRole = "audience" | "presenter";

export interface PresentationSessionLaunch {
  sessionId: string;
  deckId: string;
  revision: string;
  presenterUrl: string;
  audienceUrl: string;
}

export interface PresentationBootstrap {
  sessionId: string;
  deckId: string;
  revision: string;
  role: PresentationViewRole;
  html: string;
  assetBaseUrl: string;
  audienceUrl?: string;
}

interface PresentationScreen {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary?: boolean;
}

export interface PresentationScreenPlan {
  presenter: PresentationScreen;
  audience: PresentationScreen;
}

type MultiScreenWindow = Window & typeof globalThis & { getScreenDetails?: () => Promise<{ screens: PresentationScreen[]; currentScreen: PresentationScreen }> };

const endpoint = "/api/presentation-sessions";

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Presentation session request failed with ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

function validRevision(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }

export async function createPresentationSession(session: Pick<StudioLaunchSession, "token">, fetcher: typeof fetch = fetch): Promise<PresentationSessionLaunch> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "x-slides-studio-session": session.token },
    cache: "no-store",
  });
  const result = await responseJson<PresentationSessionLaunch>(response);
  if (!result.sessionId || !result.deckId || !validRevision(result.revision) || !result.presenterUrl || !result.audienceUrl) throw new Error("Presentation launch bridge returned an incomplete session.");
  return result;
}

export async function loadPresentationBootstrap(sessionId: string, capability: string, fetcher: typeof fetch = fetch): Promise<PresentationBootstrap> {
  const response = await fetcher(`${endpoint}/${encodeURIComponent(sessionId)}?capability=${encodeURIComponent(capability)}`, {
    headers: { "x-slides-studio-presentation": capability },
    cache: "no-store",
  });
  const result = await responseJson<PresentationBootstrap>(response);
  if (result.sessionId !== sessionId || !result.deckId || !validRevision(result.revision) || !["audience", "presenter"].includes(result.role) || typeof result.html !== "string" || !result.assetBaseUrl) throw new Error("Presentation launch bridge returned an incomplete bootstrap.");
  if (result.role === "audience" && /data-speaker-notes/i.test(result.html)) throw new Error("Audience bootstrap contains private speaker-note metadata.");
  return result;
}

export async function requestPresentationScreenPlan(host: MultiScreenWindow = window as MultiScreenWindow): Promise<PresentationScreenPlan | null> {
  if (!host.getScreenDetails) return null;
  try {
    const details = await host.getScreenDetails();
    const audience = details.screens.find((screen) => screen !== details.currentScreen && !screen.isPrimary)
      ?? details.screens.find((screen) => screen !== details.currentScreen);
    return audience ? { presenter: details.currentScreen, audience } : null;
  } catch { return null; }
}

export function placePresentationWindows(plan: PresentationScreenPlan | null, presenter: Window | null, audience: Window | null): boolean {
  if (!plan || !presenter || !audience) return false;
  try {
    presenter.moveTo(plan.presenter.availLeft, plan.presenter.availTop);
    presenter.resizeTo(plan.presenter.availWidth, plan.presenter.availHeight);
    audience.moveTo(plan.audience.availLeft, plan.audience.availTop);
    audience.resizeTo(plan.audience.availWidth, plan.audience.availHeight);
    audience.focus(); presenter.focus();
    return true;
  } catch { return false; }
}

export function presentationRoute(search = window.location.search): { role: PresentationViewRole; sessionId: string; capability: string } | null {
  const params = new URLSearchParams(search);
  const role = params.get("view");
  const sessionId = params.get("presentation")?.trim() ?? "";
  const capability = params.get("capability")?.trim() ?? "";
  if ((role !== "audience" && role !== "presenter") || !sessionId || !capability) return null;
  return { role, sessionId, capability };
}

export function withPresentationBase(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("base[data-slides-studio-presentation]").forEach((element) => element.remove());
  const base = doc.createElement("base");
  base.dataset.slidesStudioPresentation = "true";
  base.href = baseUrl;
  doc.head.prepend(base);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

const AUDIENCE_STYLE = `html,body{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#000!important}.deck-viewport{position:fixed!important;inset:0!important;overflow:hidden!important}.deck-stage{position:absolute!important;transform-origin:0 0!important}.slide{position:absolute!important;inset:0!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}.slide.active,.slide.visible{visibility:visible!important;opacity:1!important;pointer-events:auto!important}[data-authoring-ui],.presenter-tools,.slides-studio-chrome{display:none!important}html[data-presentation-reduced-motion=true] *,html[data-presentation-reduced-motion=true] *::before,html[data-presentation-reduced-motion=true] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}`;
const AUDIENCE_SCRIPT = `(()=>{const slides=Array.from(document.querySelectorAll('.slide')).filter(slide=>slide.dataset.slideSkipped!=='true');const fit=()=>{const stage=document.querySelector('.deck-stage')||slides[0];if(!stage)return;const width=stage.offsetWidth||slides[0]?.offsetWidth||1920,height=stage.offsetHeight||slides[0]?.offsetHeight||1080,scale=Math.min(innerWidth/width,innerHeight/height);Object.assign(stage.style,{position:'absolute',left:((innerWidth-width*scale)/2)+'px',top:((innerHeight-height*scale)/2)+'px',width:width+'px',height:height+'px',transform:'scale('+scale+')',transformOrigin:'0 0'});};const show=(index,reduced)=>{const next=Math.max(0,Math.min(Number(index)||0,slides.length-1));document.documentElement.dataset.presentationReducedMotion=String(Boolean(reduced));slides.forEach((slide,i)=>{const active=i===next;slide.classList.toggle('active',active);slide.classList.toggle('visible',active);slide.setAttribute('aria-hidden',String(!active));slide.style.pointerEvents=active?'auto':'none';if(!active)slide.querySelectorAll('video,audio').forEach(media=>media.pause());});dispatchEvent(new CustomEvent('slides-studio:slide-change',{detail:{index:next,slideId:slides[next]?.dataset.slideId}}));fit();};addEventListener('message',event=>{if(event.source!==parent)return;const data=event.data;if(data?.type==='slides-studio:presentation-state'&&Number.isInteger(data.index))show(data.index,data.reducedMotion);});addEventListener('resize',fit);document.fonts?.ready?.then(fit);show(0,matchMedia('(prefers-reduced-motion: reduce)').matches);parent.postMessage({type:'slides-studio:presentation-ready'},'*');})();`;

export function buildAudienceDocument(html: string, baseUrl = ""): string {
  const doc = new DOMParser().parseFromString(baseUrl ? withPresentationBase(html, baseUrl) : html, "text/html");
  doc.querySelectorAll("[data-speaker-notes]").forEach((element) => element.remove());
  const style = doc.createElement("style"); style.dataset.slidesStudioAudience = "true"; style.textContent = AUDIENCE_STYLE; doc.head.append(style);
  const script = doc.createElement("script"); script.dataset.slidesStudioAudience = "true"; script.textContent = AUDIENCE_SCRIPT; doc.body.append(script);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function presentationSlideIds(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll<HTMLElement>(".slide"))
    .filter((slide) => slide.dataset.slideSkipped !== "true")
    .map((slide, index) => slide.dataset.slideId || `slide-${String(index + 1).padStart(2, "0")}`);
}
