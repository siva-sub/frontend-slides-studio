import { useEffect, useMemo, useRef, useState } from "react";
import { stageBrowserMedia, type BrowserDirectoryHandle } from "@slides-studio/media-kit";
import { NATIVE_SHAPE_PRESETS } from "@slides-studio/pptx-compat/browser";
import { analyzePptxHtmlReadiness } from "@slides-studio/presentation-objects";
import { parseStudioMessage, type MotionProgramV1, type QualityReport, type StudioMessage, type TransitionSpecV1 } from "@slides-studio/protocol";
import { inspectRecipe, inspectStyle, listRecipes, listStyles } from "@slides-studio/style-registry";
import { injectStudioBridge } from "./lib/bridge";
import { deleteSlide, duplicateSlide, reorderSlide, toggleSlideSkipped } from "./lib/deckOperations";
import { insertDiagram } from "./lib/diagram";
import { submitExportJob, waitForExportJob, type ExportFormat, type ExportJob, type ExportQualityGate } from "./lib/export";
import { launchToken, loadLaunchSession, saveLaunchSession, type StudioLaunchSession } from "./lib/launch";
import {
  applyMediaReframe,
  applyMediaSource,
  createStudioAssetPlan,
  fetchAssetArtifact,
  generatedMediaArtifact,
  prepareMedia,
  readMediaReframe,
  resetMediaReframe,
  resolvePreviewMediaSources,
  submitAssetJob,
  waitForAssetJob,
} from "./lib/media";
import { normalizeDeck } from "./lib/normalizeDeck";
import { applyObjectMotion, applySlideTransition, createMotionTrack, readMotionProgram, readSlideTransition, removeObjectMotion, type MotionPreset } from "./lib/motion";
import { insertNativePptxShape } from "./lib/nativeShape";
import { applySlidePptxIntent, readSlidePptxIntent } from "./lib/pptxReadiness";
import { changeObjectLayer, type LayerAction } from "./lib/objectOperations";
import { revisionFor, saveSnapshot } from "./lib/storage";
import { applyLayoutSlotToObject, applyStyleToHtml, attachLayoutToPage, type StyleApplyScope } from "./lib/style";
import { buildSlideThumbnails } from "./lib/thumbnails";
import { type StudioMode, useStudioStore } from "./store";

const STYLE_OPTIONS = listStyles();
const RECIPE_OPTIONS = listRecipes();
const INITIAL_RECIPE = RECIPE_OPTIONS[0];
const INITIAL_STYLE_ID = INITIAL_RECIPE?.recommendedStyleId ?? STYLE_OPTIONS[0]?.id ?? "";
const compoundLayoutId = (styleId: string, layoutId: string) => layoutId.includes("/") ? layoutId : `${styleId}/${layoutId}`;

const welcomeDeck = `<!doctype html><html><head><style>
*{box-sizing:border-box}body{margin:0;background:#131510;color:#f5f2e8;font-family:Georgia,serif}.slide{position:absolute;inset:0;width:1920px;height:1080px;padding:110px;visibility:hidden;opacity:0;pointer-events:none;background:radial-gradient(circle at 78% 28%,#314f45 0 16%,transparent 34%),#171914}.slide.active,.slide.visible{visibility:visible;opacity:1;pointer-events:auto}.kicker{font:700 22px/1 monospace;letter-spacing:.22em;color:#ff6b3d}.title{font-size:132px;line-height:.88;max-width:1150px;margin:180px 0 45px}.deck-note{font:500 30px/1.5 system-ui;max-width:720px;color:#bdc6b8}.folio{position:absolute;right:100px;bottom:80px;font:18px monospace;color:#7e897a}</style></head><body><section class="slide active visible"><p class="kicker">FRONTEND SLIDES / STUDIO</p><h1 class="title">Author motion.<br/>Keep the source.</h1><p class="deck-note">Import an HTML deck, preserve its behavior, then edit with stable IDs and deterministic history.</p><span class="folio">01 — LOCAL FIRST</span></section></body></html>`;

interface LocalFileHandle { name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>; }
type FilePickerWindow = Window & typeof globalThis & { showOpenFilePicker?: (options?: unknown) => Promise<LocalFileHandle[]>; showSaveFilePicker?: (options?: unknown) => Promise<LocalFileHandle>; showDirectoryPicker?: (options?: unknown) => Promise<BrowserDirectoryHandle>; };

function patchSource(html: string, message: Extract<StudioMessage, { type: "studio:patch" }>): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const element = doc.querySelector<HTMLElement>(`[data-object-id="${CSS.escape(message.objectId)}"]`);
  if (!element) return html;
  if (message.patch.delete === true) element.remove();
  else {
    if (typeof message.patch.text === "string") element.textContent = message.patch.text;
    if (message.patch.style && typeof message.patch.style === "object") Object.assign(element.style, message.patch.style);
    if (message.patch.attributes && typeof message.patch.attributes === "object") Object.entries(message.patch.attributes).forEach(([name, value]) => value == null ? element.removeAttribute(name) : element.setAttribute(name, String(value)));
  }
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/html" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export function App() {
  const store = useStudioStore();
  const frame = useRef<HTMLIFrameElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const fileHandle = useRef<LocalFileHandle | null>(null);
  const workspaceDirectory = useRef<BrowserDirectoryHandle | null>(null);
  const previewAssetUrls = useRef(new Map<string, string>());
  const [previewAssetRevision, setPreviewAssetRevision] = useState(0);
  const [frameSource, setFrameSource] = useState("");
  const [importNotice, setImportNotice] = useState("No source file is overwritten until Save is explicit.");
  const [launchSession, setLaunchSession] = useState<StudioLaunchSession | null>(null);
  const [assetPrompt, setAssetPrompt] = useState("");
  const [assetService, setAssetService] = useState("http://127.0.0.1:4317");
  const [assetToken, setAssetToken] = useState(() => sessionStorage.getItem("slides-studio-asset-token") ?? "");
  const [assetStatus, setAssetStatus] = useState("Evidence is required before generated assets can be approved.");
  const [assetBusy, setAssetBusy] = useState(false);
  const [motionPreset, setMotionPreset] = useState<MotionPreset>("fade");
  const [motionReplay, setMotionReplay] = useState<MotionProgramV1["replay"]>("once");
  const [motionDuration, setMotionDuration] = useState(500);
  const [motionDelay, setMotionDelay] = useState(0);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [qualityBusy, setQualityBusy] = useState(false);
  const [recipeId, setRecipeId] = useState(INITIAL_RECIPE?.id ?? "");
  const [styleId, setStyleId] = useState(INITIAL_STYLE_ID);
  const [layoutId, setLayoutId] = useState("");
  const [stylePreview, setStylePreview] = useState(false);
  const [authoringStatus, setAuthoringStatus] = useState("Choose a style to preview it; Apply writes visible theme CSS into the deck.");
  const [diagramJson, setDiagramJson] = useState("");
  const [diagramStatus, setDiagramStatus] = useState("Paste a DiagramSpec v1/v2 JSON document to insert editable SVG primitives.");
  const [nativeShapePreset, setNativeShapePreset] = useState<string>("chevron");
  const [exportSourcePath, setExportSourcePath] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
  const [exportQualityGate, setExportQualityGate] = useState<ExportQualityGate>("strict");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportStatus, setExportStatus] = useState("Choose an output intent. PDF is static with selectable text; editable presentation output is PPTX.");

  const load = async (fileName: string, source: string) => {
    for (const url of previewAssetUrls.current.values()) URL.revokeObjectURL(url);
    previewAssetUrls.current.clear(); setPreviewAssetRevision((value) => value + 1);
    const normalized = normalizeDeck(source);
    const revision = await revisionFor(normalized.html);
    store.loadDeck({ fileName, html: normalized.html, slideCount: normalized.slideCount, strategy: normalized.strategy, confidence: normalized.confidence, warnings: normalized.warnings, revision });
    setFrameSource(normalized.html);
    setStylePreview(false);
    setImportNotice(`${normalized.strategy} · ${normalized.confidence} confidence · ${normalized.slideCount} page${normalized.slideCount === 1 ? "" : "s"}`);
    setQualityReport(null);
  };

  useEffect(() => {
    const token = launchToken();
    if (!token) { void load("welcome.html", welcomeDeck); return; }
    void loadLaunchSession(token).then(async (session) => {
      setLaunchSession(session);
      setExportSourcePath(session.sourcePath);
      await load(session.fileName, session.html);
      setImportNotice(`Opened ${session.fileName} through the authenticated Studio launch bridge. Save writes atomically to the configured source.`);
    }).catch((error) => {
      void load("welcome.html", welcomeDeck);
      setImportNotice(`Studio launch failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, []);
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: "studio:set-mode", protocolVersion: 1, mode: store.mode }, "*"); }, [store.mode, frameSource]);
  useEffect(() => {
    if (!store.sourceHtml || store.historyIndex < 0) return;
    const timer = window.setTimeout(() => { const entry = store.history[store.historyIndex]; if (entry) void saveSnapshot({ id: `${store.deckId}:${entry.revision}`, deckId: store.deckId, createdAt: Date.now(), html: store.sourceHtml, revision: entry.revision }); }, 350);
    return () => clearTimeout(timer);
  }, [store.sourceHtml, store.historyIndex, store.deckId]);

  const selectedRecipe = useMemo(() => recipeId ? inspectRecipe(recipeId) : null, [recipeId]);
  const selectedStyle = useMemo(() => styleId ? inspectStyle(styleId) : null, [styleId]);
  const compatibleLayouts = selectedStyle?.layouts ?? [];
  const selectedLayoutProfile = compatibleLayouts.find((layout) => compoundLayoutId(layout.styleId, layout.id) === layoutId) ?? null;
  useEffect(() => {
    if (!compatibleLayouts.some((layout) => compoundLayoutId(layout.styleId, layout.id) === layoutId)) setLayoutId(compatibleLayouts[0] ? compoundLayoutId(compatibleLayouts[0].styleId, compatibleLayouts[0].id) : "");
  }, [styleId, layoutId]);
  const styledFrameSource = useMemo(() => {
    if (!stylePreview || !selectedStyle || !frameSource) return frameSource;
    try { return applyStyleToHtml(frameSource, selectedStyle.style, "page", store.currentSlide, { ...(recipeId ? { recipeId } : {}), ...(layoutId ? { layoutId } : {}) }); }
    catch { return frameSource; }
  }, [frameSource, stylePreview, selectedStyle, store.currentSlide, recipeId, layoutId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      let message: StudioMessage;
      try { message = parseStudioMessage(event.data); } catch { return; }
      if (message.type === "studio:select") store.selectObject(message.objectId, message.tagName ?? null);
      if (message.type === "studio:quality-report") { setQualityReport(message.report); setQualityBusy(false); }
      if (message.type === "studio:patch") {
        const next = patchSource(useStudioStore.getState().sourceHtml, message);
        void revisionFor(next).then((revision) => {
          const current = useStudioStore.getState(); current.commit(next, message.patch.delete === true ? `Delete ${message.objectId}` : `Edit ${message.objectId}`, revision); setQualityReport(null);
          if (message.patch.delete === true) current.selectObject(null);
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const srcDoc = useMemo(() => styledFrameSource ? injectStudioBridge(resolvePreviewMediaSources(styledFrameSource, previewAssetUrls.current)) : "", [styledFrameSource, previewAssetRevision]);
  const selectSlide = (index: number) => { store.setCurrentSlide(index); setQualityReport(null); frame.current?.contentWindow?.postMessage({ type: "studio:go-to", protocolVersion: 1, index }, "*"); };
  const applyInspectorText = (text: string) => {
    if (!store.selectedObjectId) return;
    const message = { type: "studio:patch", protocolVersion: 1, objectId: store.selectedObjectId, patch: { text } } as const;
    const next = patchSource(store.sourceHtml, message);
    frame.current?.contentWindow?.postMessage(message, "*");
    void revisionFor(next).then((revision) => { store.commit(next, `Edit ${message.objectId}`, revision); setQualityReport(null); });
  };
  const restore = (direction: "undo" | "redo") => { direction === "undo" ? store.undo() : store.redo(); queueMicrotask(() => setFrameSource(useStudioStore.getState().sourceHtml)); };
  const commitDeckOperation = async (html: string, label: string) => { const revision = await revisionFor(html); store.commit(html, label, revision); store.setSlideCount(new DOMParser().parseFromString(html, "text/html").querySelectorAll(".slide").length); store.selectObject(null); setQualityReport(null); setFrameSource(html); };
  const applySelectedStyle = (scope: StyleApplyScope) => {
    if (!selectedStyle) return;
    try {
      const next = applyStyleToHtml(store.sourceHtml, selectedStyle.style, scope, store.currentSlide, { ...(recipeId ? { recipeId } : {}), ...(layoutId ? { layoutId } : {}) });
      setStylePreview(false);
      setAuthoringStatus(`Applied ${selectedStyle.style.name} to ${scope === "deck" ? "the deck" : `page ${store.currentSlide + 1}`}.`);
      void commitDeckOperation(next, `Apply style ${selectedStyle.style.id}`);
    } catch (error) { setAuthoringStatus(error instanceof Error ? error.message : String(error)); }
  };
  const attachSelectedLayout = (nextLayoutId = layoutId) => {
    if (!nextLayoutId || !styleId) return;
    try {
      const next = attachLayoutToPage(store.sourceHtml, store.currentSlide, styleId, nextLayoutId, recipeId || undefined);
      setAuthoringStatus(`Attached layout contract ${nextLayoutId} to page ${store.currentSlide + 1}; existing geometry is preserved.`);
      void commitDeckOperation(next, `Attach layout ${nextLayoutId}`);
    } catch (error) { setAuthoringStatus(error instanceof Error ? error.message : String(error)); }
  };
  const applySelectedSlotGeometry = () => {
    if (!store.selectedObjectId || !selectedLayoutProfile || !selectedMediaFrame || selectedMediaFrame.layoutSlot === "freeform") return;
    try {
      const next = applyLayoutSlotToObject(store.sourceHtml, store.selectedObjectId, selectedLayoutProfile, selectedMediaFrame.layoutSlot);
      setAuthoringStatus(`Applied ${selectedMediaFrame.layoutSlot} slot geometry from ${selectedLayoutProfile.id}.`);
      void commitDeckOperation(next, `Apply layout slot ${selectedMediaFrame.layoutSlot}`);
    } catch (error) { setAuthoringStatus(error instanceof Error ? error.message : String(error)); }
  };
  const applyLayer = (action: LayerAction) => { if (!store.selectedObjectId) return; void commitDeckOperation(changeObjectLayer(store.sourceHtml, store.selectedObjectId, action), `Layer ${action}`); };
  const nudgeSelected = (dx: number, dy: number) => frame.current?.contentWindow?.postMessage({ type: "studio:nudge-selected", protocolVersion: 1, dx, dy }, "*");
  const openNativeFile = async () => {
    const picker = (window as FilePickerWindow).showOpenFilePicker; if (!picker) { fileInput.current?.click(); return; }
    try { const [handle] = await picker({ multiple: false, types: [{ description: "HTML deck", accept: { "text/html": [".html", ".htm"] } }] }); if (!handle) return; fileHandle.current = handle; setLaunchSession(null); setExportSourcePath(""); const file = await handle.getFile(); await load(file.name, await file.text()); setImportNotice(`Opened ${file.name} with save-in-place permission.`); } catch (error) { if ((error as DOMException)?.name !== "AbortError") setImportNotice(error instanceof Error ? error.message : String(error)); }
  };
  const attachFolderWorkspace = async () => {
    const picker = (window as FilePickerWindow).showDirectoryPicker;
    if (!picker) { setImportNotice("Folder workspaces require the File System Access API; media will use embedded data URLs with a size warning."); return; }
    try { workspaceDirectory.current = await picker({ mode: "readwrite" }); setImportNotice("Folder workspace attached. New media will stage under assets/user-media/ with a manifest."); }
    catch (error) { if ((error as DOMException)?.name !== "AbortError") setImportNotice(error instanceof Error ? error.message : String(error)); }
  };
  const saveCurrent = async () => {
    try {
      if (launchSession) {
        const saved = await saveLaunchSession(launchSession, store.sourceHtml);
        store.markSaved();
        setImportNotice(`Saved ${store.fileName} atomically through the Studio launch bridge · ${saved.revision.slice(0, 12)}.`);
        return;
      }
      let handle = fileHandle.current;
      if (!handle && (window as FilePickerWindow).showSaveFilePicker) handle = await (window as FilePickerWindow).showSaveFilePicker!({ suggestedName: store.fileName, types: [{ description: "HTML deck", accept: { "text/html": [".html"] } }] });
      if (!handle) { download(store.fileName, store.sourceHtml); store.markSaved(); setImportNotice("Downloaded a copy; the imported source was not overwritten."); return; }
      const writable = await handle.createWritable(); await writable.write(store.sourceHtml); await writable.close(); fileHandle.current = handle; store.markSaved(); setImportNotice(`Saved ${handle.name} atomically through the File System Access API.`);
    } catch (error) { if ((error as DOMException)?.name !== "AbortError") setImportNotice(error instanceof Error ? error.message : String(error)); }
  };
  const replaceSelectedMedia = async (file: File, propagateError = false) => {
    if (!store.selectedObjectId) return;
    try {
      let source: { src: string; sha256: string; originalName: string; width?: number; height?: number }; let previewSrc: string; let notice: string;
      if (workspaceDirectory.current) {
        const staged = await stageBrowserMedia(workspaceDirectory.current, file, file.name, { ...(file.type ? { declaredMime: file.type } : {}) });
        const previewUrl = URL.createObjectURL(file); const previous = previewAssetUrls.current.get(staged.path); if (previous) URL.revokeObjectURL(previous);
        previewAssetUrls.current.set(staged.path, previewUrl); setPreviewAssetRevision((value) => value + 1);
        source = { src: staged.path, sha256: staged.entry.hash.value, originalName: file.name, ...(staged.entry.width ? { width: staged.entry.width } : {}), ...(staged.entry.height ? { height: staged.entry.height } : {}) }; previewSrc = previewUrl;
        notice = `${staged.deduplicated ? "Reused" : "Staged"} ${file.name} at ${staged.path}; manifest updated.`;
      } else {
        const prepared = await prepareMedia(file);
        source = { src: prepared.dataUrl, sha256: prepared.sha256, originalName: file.name, ...(prepared.width ? { width: prepared.width } : {}), ...(prepared.height ? { height: prepared.height } : {}) }; previewSrc = prepared.dataUrl;
        notice = `${prepared.warning ?? "File-only fallback embeds media in HTML."} ${prepared.originalBytes.toLocaleString()} → ${prepared.storedBytes.toLocaleString()} bytes.`;
      }
      const next = applyMediaSource(store.sourceHtml, store.selectedObjectId, source);
      const revision = await revisionFor(next); store.commit(next, workspaceDirectory.current ? "Stage media" : "Embed media", revision); setQualityReport(null);
      frame.current?.contentWindow?.postMessage({ type: "studio:patch", protocolVersion: 1, objectId: store.selectedObjectId, patch: { attributes: { src: previewSrc, "data-asset-sha256": source.sha256, "data-original-name": source.originalName, ...(source.width ? { "data-source-width": source.width } : {}), ...(source.height ? { "data-source-height": source.height } : {}) } } }, "*");
      setImportNotice(notice);
    } catch (error) { setImportNotice(error instanceof Error ? error.message : String(error)); if (propagateError) throw error; }
  };
  const commitMediaReframe = async (changes: Parameters<typeof applyMediaReframe>[2], reset = false) => {
    if (!store.selectedObjectId) return;
    const next = reset ? resetMediaReframe(store.sourceHtml, store.selectedObjectId) : applyMediaReframe(store.sourceHtml, store.selectedObjectId, changes);
    const revision = await revisionFor(next); store.commit(next, reset ? "Reset media framing" : "Reframe media", revision);
    const updated = readMediaReframe(next, store.selectedObjectId);
    if (updated) {
      const positionX = updated.crop ? updated.crop.x + updated.crop.width / 2 : updated.focalX + updated.panX; const positionY = updated.crop ? updated.crop.y + updated.crop.height / 2 : updated.focalY + updated.panY;
      frame.current?.contentWindow?.postMessage({ type: "studio:patch", protocolVersion: 1, objectId: store.selectedObjectId, patch: { style: { objectFit: updated.fit, objectPosition: `${Math.max(0, Math.min(1, positionX)) * 100}% ${Math.max(0, Math.min(1, positionY)) * 100}%`, scale: updated.zoom === 1 ? "" : String(updated.zoom), rotate: updated.rotation === 0 ? "" : `${updated.rotation}deg` }, attributes: { alt: updated.alt, "data-media-fit": updated.fit, "data-focal-x": updated.focalX, "data-focal-y": updated.focalY, "data-pan-x": updated.panX, "data-pan-y": updated.panY, "data-media-zoom": updated.zoom, "data-media-rotation": updated.rotation, "data-layout-slot": updated.layoutSlot, "data-crop-x": updated.crop?.x ?? null, "data-crop-y": updated.crop?.y ?? null, "data-crop-width": updated.crop?.width ?? null, "data-crop-height": updated.crop?.height ?? null } } }, "*");
    }
  };
  const generateSelectedAsset = async () => {
    if (!store.selectedObjectId || !assetToken.trim()) return;
    setAssetBusy(true);
    try {
      sessionStorage.setItem("slides-studio-asset-token", assetToken.trim());
      const doc = new DOMParser().parseFromString(store.sourceHtml, "text/html");
      const slideId = doc.querySelectorAll<HTMLElement>(".slide")[store.currentSlide]?.dataset.slideId;
      setAssetStatus("Planning asset…");
      const plan = await createStudioAssetPlan({ prompt: assetPrompt, ...(slideId ? { slideId } : {}), ...(styleId ? { styleId } : {}), ...(layoutId ? { layoutId } : {}) });
      setAssetStatus("Queued with local asset service…");
      const accepted = await submitAssetJob(plan, { service: assetService, token: assetToken.trim() });
      setAssetStatus(`Generating · ${accepted.id.slice(0, 8)}`);
      const complete = await waitForAssetJob(accepted, { service: assetService, token: assetToken.trim() });
      const artifact = generatedMediaArtifact(complete);
      if (!artifact) throw new Error("Asset job completed without an image artifact.");
      const blob = await fetchAssetArtifact(complete.id, artifact, { service: assetService, token: assetToken.trim() });
      await replaceSelectedMedia(new File([blob], artifact.split("/").pop() ?? "generated-asset", { type: blob.type || "application/octet-stream" }), true);
      setAssetStatus(`Applied ${artifact} · rendered evidence pending manual review.`);
    } catch (error) {
      setAssetStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setAssetBusy(false);
    }
  };
  const insertCurrentDiagram = async () => {
    try {
      const inserted = insertDiagram(store.sourceHtml, store.currentSlide, JSON.parse(diagramJson));
      await commitDeckOperation(inserted.html, `Insert ${inserted.spec.type} diagram`);
      setDiagramStatus(`Inserted ${inserted.spec.type} as ${inserted.objectId}.`);
      setDiagramJson("");
    } catch (error) {
      setDiagramStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const exportExplanation = exportFormat === "pdf"
    ? "PDF preserves selectable text where Chrome supports it, but the pages are static and are not a natively editable presentation."
    : exportFormat === "pptx"
      ? "Raster PPTX places one full-slide image on each page. ISO/IEC 29500 Transitional package compatibility is validated, but slide objects are not editable."
      : "Editable PPTX maps supported stable-ID text, shapes, and images to native objects, records raster fallbacks, requires strict quality, and remains pending manual review after render-back.";
  const runExport = async () => {
    if (store.dirty) { setExportStatus("Save the current deck before exporting so the service reads the same revision."); return; }
    if (exportFormat === "editable-pptx" && !pptxReadiness.ready) { setExportStatus("Resolve blocking Editable PPTX readiness issues before export."); return; }
    setExportBusy(true); setExportJob(null);
    try {
      sessionStorage.setItem("slides-studio-asset-token", assetToken.trim());
      setExportStatus("Submitting evidence-gated export…");
      const accepted = await submitExportJob({ source: exportSourcePath, format: exportFormat, qualityGate: exportQualityGate, qualityMode: "canonical" }, { service: assetService, token: assetToken.trim() });
      setExportJob(accepted);
      const complete = await waitForExportJob(accepted, { service: assetService, token: assetToken.trim(), onUpdate: setExportJob });
      setExportJob(complete);
      setExportStatus(`Complete · ${complete.output ?? "output path unavailable"}`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setExportBusy(false);
    }
  };
  const focusQualityIssue = (issue: QualityReport["issues"][number]) => {
    let slideIndex = store.currentSlide;
    if (issue.slideId) {
      const document = new DOMParser().parseFromString(store.sourceHtml, "text/html");
      const index = Array.from(document.querySelectorAll<HTMLElement>(".slide")).findIndex((slide) => slide.dataset.slideId === issue.slideId);
      if (index >= 0) slideIndex = index;
    }
    if (slideIndex !== store.currentSlide) selectSlide(slideIndex);
    const objectId = issue.objectId ?? issue.pair?.[0];
    window.setTimeout(() => frame.current?.contentWindow?.postMessage({ type: "studio:quality-focus", protocolVersion: 1, ...(objectId ? { objectId } : {}), ...(issue.bounds ? { bounds: issue.bounds } : {}), durationMs: 3000 }, "*"), 0);
  };
  const currentTransition = useMemo<TransitionSpecV1>(() => readSlideTransition(store.sourceHtml, store.currentSlide) ?? { schemaVersion: 1, kind: "none", durationMs: 400, easing: "ease-out", reducedMotion: "fade", targetEntranceStartFraction: 0.55 }, [store.sourceHtml, store.currentSlide]);
  const selectedMotionProgram = useMemo(() => readMotionProgram(store.sourceHtml, store.currentSlide), [store.sourceHtml, store.currentSlide]);
  const selectedHasMotion = Boolean(store.selectedObjectId && selectedMotionProgram?.tracks.some((track) => track.objectId === store.selectedObjectId));
  const commitPageTransition = (changes: Partial<TransitionSpecV1>) => {
    const next = { ...currentTransition, ...changes, schemaVersion: 1 } as TransitionSpecV1;
    void commitDeckOperation(applySlideTransition(store.sourceHtml, store.currentSlide, next), `Transition ${next.kind}`);
  };
  const applySelectedMotion = () => {
    if (!store.selectedObjectId) return;
    const track = createMotionTrack(store.selectedObjectId, motionPreset, { durationMs: motionDuration, delayMs: motionDelay });
    void commitDeckOperation(applyObjectMotion(store.sourceHtml, store.currentSlide, store.selectedObjectId, track, motionReplay), `Motion ${motionPreset}`);
  };
  const runPageAudit = () => {
    const requestId = `studio-quality-${store.currentSlide}-${store.history[store.historyIndex]?.revision.slice(0, 12) ?? "draft"}`;
    setQualityBusy(true); setQualityReport(null);
    frame.current?.contentWindow?.postMessage({ type: "studio:quality-request", protocolVersion: 1, requestId, slideIndex: store.currentSlide, mode: "imported", strict: false }, "*");
  };
  const selectedText = useMemo(() => { if (!store.selectedObjectId) return ""; const doc = new DOMParser().parseFromString(store.sourceHtml, "text/html"); return doc.querySelector(`[data-object-id="${CSS.escape(store.selectedObjectId)}"]`)?.textContent ?? ""; }, [store.sourceHtml, store.selectedObjectId]);
  const selectedMediaFrame = useMemo(() => store.selectedObjectId ? readMediaReframe(store.sourceHtml, store.selectedObjectId) : null, [store.sourceHtml, store.selectedObjectId]);
  const selectedMediaCrop = selectedMediaFrame?.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const pptxReadiness = useMemo(() => analyzePptxHtmlReadiness(new DOMParser().parseFromString(store.sourceHtml, "text/html")), [store.sourceHtml]);
  const currentPptxIntent = useMemo(() => readSlidePptxIntent(store.sourceHtml, store.currentSlide), [store.sourceHtml, store.currentSlide]);
  const editableExportBlocked = exportFormat === "editable-pptx" && !pptxReadiness.ready;
  const slideSummaries = useMemo(() => buildSlideThumbnails(resolvePreviewMediaSources(stylePreview ? styledFrameSource : store.sourceHtml, previewAssetUrls.current)).filter((slide) => !store.search.trim() || slide.label.toLowerCase().includes(store.search.trim().toLowerCase())), [store.sourceHtml, store.search, stylePreview, styledFrameSource, previewAssetRevision]);

  return <main className="studio-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">FS</span><div><strong>Frontend Slides Studio</strong><small>LOCAL AUTHORING WORKBENCH</small></div></div>
      <div className="mode-switch" aria-label="Editing mode">
        {(["browse", "edit", "move"] as StudioMode[]).map((mode) => <button className={store.mode === mode ? "active" : ""} onClick={() => store.setMode(mode)} key={mode}>{mode}<kbd>{mode === "browse" ? "1" : mode === "edit" ? "2" : "3"}</kbd></button>)}
      </div>
      <div className="top-actions">
        <button className="icon-button" onClick={() => restore("undo")} disabled={store.historyIndex <= 0} aria-label="Undo">↶</button>
        <button className="icon-button" onClick={() => restore("redo")} disabled={store.historyIndex >= store.history.length - 1} aria-label="Redo">↷</button>
        <button className="quiet-button" onClick={() => { void openNativeFile(); }}>Open HTML</button>
        <button className="quiet-button" onClick={() => { void attachFolderWorkspace(); }}>Attach folder</button>
        <button className="quiet-button" onClick={() => download(store.fileName, store.sourceHtml)}>Download copy</button>
        <button className="save-button" onClick={() => { void saveCurrent(); }}>Save <span>⌘S</span></button>
        <input ref={fileInput} hidden type="file" accept=".html,.htm,text/html" onChange={(event) => { const file = event.target.files?.[0]; if (file) { fileHandle.current = null; setLaunchSession(null); setExportSourcePath(""); void file.text().then((text) => load(file.name, text)); } }} />
        <input ref={mediaInput} hidden type="file" accept="image/*,video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void replaceSelectedMedia(file); event.currentTarget.value = ""; }} />
      </div>
    </header>

    <aside className="rail left-rail">
      <div className="rail-heading"><span>Pages</span><em>{String(store.slideCount).padStart(2, "0")}</em></div>
      <div className="search-box"><span>⌕</span><input value={store.search} onChange={(event) => store.setSearch(event.target.value)} placeholder="Find a page" /></div>
      <div className="page-list">
        {slideSummaries.map((slide) => <button key={slide.slideId} onClick={() => selectSlide(slide.index)} className={`page-thumb ${store.currentSlide === slide.index ? "active" : ""} ${slide.skipped ? "skipped" : ""}`}>
          <span className="page-number">{String(slide.index + 1).padStart(2, "0")}</span><div className="mini-canvas"><iframe name={`slide-thumbnail-${slide.index + 1}`} title={`Page ${slide.index + 1} preview`} sandbox="allow-scripts" srcDoc={slide.html} loading="lazy" tabIndex={-1} /></div><span className="page-label">{slide.skipped ? `Skipped · ${slide.label}` : slide.label}</span>
        </button>)}
      </div>
      <button className="add-page" onClick={() => { void commitDeckOperation(duplicateSlide(store.sourceHtml, store.currentSlide), "Duplicate page"); }}>＋ Duplicate page</button>
    </aside>

    <section className="workspace">
      <div className="workspace-meta"><div><span className={`confidence ${store.confidence}`}>{store.confidence}</span><strong>{store.fileName}</strong>{store.dirty && <i>UNSAVED</i>}</div><span>{importNotice}</span></div>
      <div className="canvas-stage"><iframe ref={frame} name="studio-preview" title="Imported deck" sandbox="allow-scripts" srcDoc={srcDoc} onLoad={() => { frame.current?.contentWindow?.postMessage({ type: "studio:set-mode", protocolVersion: 1, mode: useStudioStore.getState().mode }, "*"); frame.current?.contentWindow?.postMessage({ type: "studio:go-to", protocolVersion: 1, index: useStudioStore.getState().currentSlide }, "*"); }} /></div>
      <div className="canvas-footer"><span><b>16:9</b> fixed stage</span><span>100%</span><span>Object moves compose through CSS <code>translate</code>, not animated <code>transform</code>.</span></div>
    </section>

    <aside className="rail inspector">
      <div className="rail-heading"><span>Inspector</span><em>{store.mode.toUpperCase()}</em></div>
      <div className="inspector-section style-recipe-panel">
        <label htmlFor="recipe-profile">Recipe</label>
        <select id="recipe-profile" value={recipeId} onChange={(event) => { const nextId = event.target.value; const recipe = inspectRecipe(nextId); setRecipeId(nextId); setStyleId(recipe.recommendedStyleId); setLayoutId(""); setStylePreview(true); setAuthoringStatus(`Previewing the recommended ${recipe.recommendedStyleId} style on page ${store.currentSlide + 1}.`); }}>
          {RECIPE_OPTIONS.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
        </select>
        <label htmlFor="style-profile">Style</label>
        <select id="style-profile" value={styleId} onChange={(event) => { setStyleId(event.target.value); setLayoutId(""); setStylePreview(true); setAuthoringStatus(`Previewing ${event.target.selectedOptions[0]?.textContent ?? event.target.value} on page ${store.currentSlide + 1}; Apply to persist it.`); }}>
          {STYLE_OPTIONS.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
        </select>
        <div className="control-grid style-actions"><button className={stylePreview ? "active" : ""} onClick={() => setStylePreview((value) => !value)}>{stylePreview ? "Stop preview" : "Preview style"}</button><button onClick={() => applySelectedStyle("page")}>Apply to page</button><button onClick={() => applySelectedStyle("deck")}>Apply to deck</button></div>
        <label htmlFor="layout-profile">Layout contract</label>
        <select id="layout-profile" value={layoutId} onChange={(event) => { const next = event.target.value; setLayoutId(next); attachSelectedLayout(next); }}>
          {compatibleLayouts.map((layout) => { const id = compoundLayoutId(layout.styleId, layout.id); return <option key={id} value={id}>{layout.role} · {layout.name}</option>; })}
        </select>
        <button className="control-button" disabled={!layoutId} onClick={() => attachSelectedLayout()}>Attach to page</button>
        <p>{selectedRecipe?.description ?? "Choose a recipe and style."}</p><p className="authoring-status" aria-live="polite">{authoringStatus}</p>
      </div>
      <div className="inspector-section diagram-panel">
        <label htmlFor="diagram-json">DiagramSpec JSON</label>
        <textarea id="diagram-json" rows={5} value={diagramJson} onChange={(event) => setDiagramJson(event.target.value)} placeholder='{"schemaVersion":2,"id":"flow",…}' />
        <button className="control-button" disabled={!diagramJson.trim()} onClick={() => { void insertCurrentDiagram(); }}>Insert validated diagram</button>
        <p aria-live="polite">{diagramStatus}</p>
      </div>
      <div className="inspector-section"><label>Selected object</label><output>{store.selectedObjectId ?? "Nothing selected"}</output></div>
      {store.selectedObjectId ? <>
        {!(["IMG", "VIDEO"].includes(store.selectedObjectTag ?? "")) && <div className="inspector-section"><label>Text content</label><textarea key={store.selectedObjectId} rows={5} defaultValue={selectedText} placeholder="Replace selected text" onBlur={(event) => { if (event.target.value !== selectedText) applyInspectorText(event.target.value); }} /></div>}
        {["IMG", "VIDEO"].includes(store.selectedObjectTag ?? "") && <>
          <div className="inspector-section media-controls">
            <label>Media</label>
            <button className="control-button" onClick={() => mediaInput.current?.click()}>Replace {store.selectedObjectTag === "VIDEO" ? "video" : "image"}</button>
            {selectedMediaFrame && <>
              <label htmlFor="media-slot">Layout slot</label>
              <select id="media-slot" value={selectedMediaFrame.layoutSlot} onChange={(event) => commitMediaReframe({ layoutSlot: event.target.value })}><option value="freeform">Freeform</option>{selectedLayoutProfile?.slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.id} · {slot.fit}</option>)}</select>
              <button className="control-button" disabled={selectedMediaFrame.layoutSlot === "freeform" || !selectedLayoutProfile} onClick={applySelectedSlotGeometry}>Apply slot geometry</button>
              <label htmlFor="media-fit">Fit</label>
              <select id="media-fit" value={selectedMediaFrame.fit} onChange={(event) => commitMediaReframe({ fit: event.target.value as "contain" | "cover" })}><option value="cover">Cover</option><option value="contain">Contain</option></select>
              <label htmlFor="focal-x">Focal X <output>{Math.round(selectedMediaFrame.focalX * 100)}%</output></label><input id="focal-x" type="range" min="0" max="1" step="0.01" value={selectedMediaFrame.focalX} onChange={(event) => commitMediaReframe({ focalX: Number(event.target.value) })} />
              <label htmlFor="focal-y">Focal Y <output>{Math.round(selectedMediaFrame.focalY * 100)}%</output></label><input id="focal-y" type="range" min="0" max="1" step="0.01" value={selectedMediaFrame.focalY} onChange={(event) => commitMediaReframe({ focalY: Number(event.target.value) })} />
              <label htmlFor="pan-x">Pan X <output>{selectedMediaFrame.panX.toFixed(2)}</output></label><input id="pan-x" type="range" min="-1" max="1" step="0.01" value={selectedMediaFrame.panX} onChange={(event) => commitMediaReframe({ panX: Number(event.target.value) })} />
              <label htmlFor="pan-y">Pan Y <output>{selectedMediaFrame.panY.toFixed(2)}</output></label><input id="pan-y" type="range" min="-1" max="1" step="0.01" value={selectedMediaFrame.panY} onChange={(event) => commitMediaReframe({ panY: Number(event.target.value) })} />
              <label htmlFor="media-zoom">Zoom <output>{selectedMediaFrame.zoom.toFixed(2)}×</output></label><input id="media-zoom" type="range" min="0.1" max="4" step="0.05" value={selectedMediaFrame.zoom} onChange={(event) => commitMediaReframe({ zoom: Number(event.target.value) })} />
              <label htmlFor="media-rotation">Rotation <output>{selectedMediaFrame.rotation.toFixed(0)}°</output></label><input id="media-rotation" type="range" min="-180" max="180" step="1" value={selectedMediaFrame.rotation} onChange={(event) => commitMediaReframe({ rotation: Number(event.target.value) })} />
              <label>Normalized crop</label><div className="crop-grid">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key}<input type="number" min="0" max="1" step="0.01" defaultValue={selectedMediaCrop[key]} onBlur={(event) => commitMediaReframe({ crop: { ...selectedMediaCrop, [key]: Number(event.target.value) } })} /></label>)}</div>
              <label htmlFor="media-alt">Alt text</label><input key={`${store.selectedObjectId}-${selectedMediaFrame.alt}`} id="media-alt" defaultValue={selectedMediaFrame.alt} onBlur={(event) => { if (event.target.value !== selectedMediaFrame.alt) void commitMediaReframe({ alt: event.target.value }); }} />
              <button className="control-button" onClick={() => { void commitMediaReframe({}, true); }}>Reset framing</button>
            </>}
          </div>
          <div className="inspector-section asset-generator">
            <label htmlFor="asset-prompt">Generate asset</label>
            <textarea id="asset-prompt" rows={4} value={assetPrompt} onChange={(event) => setAssetPrompt(event.target.value)} placeholder="Describe composition, visual language, and reserved text areas." />
            <label htmlFor="asset-service">Local service</label>
            <input id="asset-service" value={assetService} onChange={(event) => setAssetService(event.target.value)} />
            <label htmlFor="asset-token">Session token</label>
            <input id="asset-token" type="password" value={assetToken} onChange={(event) => setAssetToken(event.target.value)} autoComplete="off" />
            <p className="asset-context">Plan context · {styleId || "no style"} · {layoutId || "no layout"}</p>
            <button className="control-button generate-button" disabled={assetBusy || !assetPrompt.trim() || !assetToken.trim()} onClick={() => { void generateSelectedAsset(); }}>{assetBusy ? "Generating…" : "Generate and apply"}</button>
            <p className="asset-status" aria-live="polite">{assetStatus}</p>
          </div>
        </>}
        <div className="inspector-section"><label>Geometry</label><p className="geometry-hint">Eight resize handles; grid and sibling snapping; hold Alt to bypass.</p><div className="control-grid nudge-grid"><button onClick={() => nudgeSelected(-1, 0)}>←</button><button onClick={() => nudgeSelected(0, -1)}>↑</button><button onClick={() => nudgeSelected(0, 1)}>↓</button><button onClick={() => nudgeSelected(1, 0)}>→</button></div></div>
        <div className="inspector-section"><label>Layer</label><div className="control-grid"><button onClick={() => applyLayer("back")}>Send back</button><button onClick={() => applyLayer("backward")}>Backward</button><button onClick={() => applyLayer("forward")}>Forward</button><button onClick={() => applyLayer("front")}>Bring front</button></div></div>
        <div className="inspector-section motion-controls">
          <label htmlFor="motion-preset">Object motion</label>
          <select id="motion-preset" value={motionPreset} onChange={(event) => setMotionPreset(event.target.value as MotionPreset)}>{["reveal", "fade", "slide", "scale", "draw", "focus", "loop", "blur", "wipe", "rotate", "pulse", "stagger"].map((preset) => <option key={preset} value={preset}>{preset}</option>)}</select>
          <div className="two-col"><div><label htmlFor="motion-duration">Duration ms</label><input id="motion-duration" type="number" min="1" max="10000" value={motionDuration} onChange={(event) => setMotionDuration(Math.max(1, Number(event.target.value) || 1))} /></div><div><label htmlFor="motion-delay">Delay ms</label><input id="motion-delay" type="number" min="0" max="10000" value={motionDelay} onChange={(event) => setMotionDelay(Math.max(0, Number(event.target.value) || 0))} /></div></div>
          <label htmlFor="motion-replay">Replay</label><select id="motion-replay" value={motionReplay} onChange={(event) => setMotionReplay(event.target.value as MotionProgramV1["replay"])}><option value="once">Once</option><option value="always">Always</option><option value="never">Never</option></select>
          <button className="control-button motion-apply" onClick={applySelectedMotion}>Apply motion</button>
          {selectedHasMotion && <button className="control-button" onClick={() => { if (store.selectedObjectId) void commitDeckOperation(removeObjectMotion(store.sourceHtml, store.currentSlide, store.selectedObjectId), "Remove motion"); }}>Remove motion</button>}
        </div>
        <div className="inspector-section"><button className="danger-button" onClick={() => frame.current?.contentWindow?.postMessage({ type: "studio:delete-selected", protocolVersion: 1 }, "*")}>Delete object</button></div>
      </> : <div className="empty-state"><span>◎</span><h3>Select something</h3><p>Choose Edit for copy or Move for geometry. Browse leaves the original deck untouched.</p></div>}
      <div className="inspector-section transition-controls">
        <label htmlFor="page-transition-kind">Page transition</label>
        <select id="page-transition-kind" value={currentTransition.kind} onChange={(event) => commitPageTransition({ kind: event.target.value as TransitionSpecV1["kind"] })}>{["none", "crossfade", "slide", "zoom", "circle-reveal", "clip-wipe", "pixel-grid", "pixel-bars", "slice-vertical", "slice-horizontal"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
        <label htmlFor="transition-duration">Duration ms</label><input key={`${store.currentSlide}-${currentTransition.durationMs}`} id="transition-duration" type="number" min="0" max="4000" defaultValue={currentTransition.durationMs} onBlur={(event) => { const durationMs = Math.max(0, Math.min(4000, Number(event.target.value) || 0)); if (durationMs !== currentTransition.durationMs) commitPageTransition({ durationMs }); }} />
        <label htmlFor="transition-entrance">Target entrance <output>{Math.round((currentTransition.targetEntranceStartFraction ?? 0.55) * 100)}%</output></label><input id="transition-entrance" type="range" min="0" max="1" step="0.05" value={currentTransition.targetEntranceStartFraction ?? 0.55} onChange={(event) => commitPageTransition({ targetEntranceStartFraction: Number(event.target.value) })} />
        <label htmlFor="transition-reduced">Reduced motion</label><select id="transition-reduced" value={currentTransition.reducedMotion} onChange={(event) => commitPageTransition({ reducedMotion: event.target.value as TransitionSpecV1["reducedMotion"] })}><option value="fade">Fade</option><option value="crossfade">Crossfade</option><option value="skip">Skip</option><option value="none">None</option></select>
        <button className="control-button" onClick={() => { void commitDeckOperation(applySlideTransition(store.sourceHtml, store.currentSlide, null), "Clear transition"); }}>Clear override</button>
      </div>
      <div className="inspector-section native-shape-panel">
        <label htmlFor="native-shape-preset">Native PowerPoint shape</label>
        <select id="native-shape-preset" value={nativeShapePreset} onChange={(event) => setNativeShapePreset(event.target.value)}>{NATIVE_SHAPE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}</select>
        <button className="control-button" onClick={() => { try { const inserted = insertNativePptxShape(store.sourceHtml, store.currentSlide, nativeShapePreset); void commitDeckOperation(inserted.html, `Insert native shape ${inserted.preset}`); setImportNotice(`Inserted ${inserted.preset}. Editable PPTX preserves it as a native shape.`); } catch (error) { setImportNotice(error instanceof Error ? error.message : String(error)); } }}>Insert native shape</button>
        <p>Preview uses CSS. Editable PPTX uses the selected OOXML preset.</p>
      </div>
      <div className="inspector-section quality-panel">
        <label>Rendered audit</label>
        <button className="control-button" disabled={qualityBusy} onClick={runPageAudit}>{qualityBusy ? "Auditing…" : "Run page audit"}</button>
        {qualityReport ? <>
          <div className={`quality-status ${qualityReport.passed ? "passed" : "failed"}`}><strong>{qualityReport.passed ? "PASS" : "REVIEW"}</strong><span>{qualityReport.summary.total} issues · {qualityReport.summary.error + qualityReport.summary.critical} blocking</span></div>
          <ul>{qualityReport.issues.slice(0, 8).map((issue, index) => <li key={`${issue.category}-${issue.objectId ?? index}`}><button onClick={() => focusQualityIssue(issue)}><b>{issue.category}</b><span>{issue.objectId ? `${issue.objectId} · ` : ""}{issue.reason}</span></button></li>)}</ul>
        </> : <p>Checks rendered bounds, text, media, overlaps, connectors, assets, IDs, and clone safety inside the sandbox.</p>}
      </div>
      <div className="inspector-section pptx-readiness-panel">
        <label htmlFor="pptx-slide-intent">Editable PPTX readiness</label>
        <select id="pptx-slide-intent" value={currentPptxIntent} onChange={(event) => { const intent = event.target.value as "" | "native-oriented" | "hybrid" | "raster"; void commitDeckOperation(applySlidePptxIntent(store.sourceHtml, store.currentSlide, intent), `PPTX intent ${intent || "unspecified"}`); }}><option value="">Intent not set</option><option value="native-oriented">Native-oriented</option><option value="hybrid">Hybrid</option><option value="raster">Raster</option></select>
        <div className={`quality-status ${pptxReadiness.status === "native-oriented" ? "passed" : "failed"}`}><strong>{pptxReadiness.status.toUpperCase()}</strong><span>{pptxReadiness.nativeCandidates} native candidates · {pptxReadiness.runtimeDependent} runtime checks · {pptxReadiness.regionalFallbacks + pptxReadiness.fullSlideFallbacks} fallback risks</span></div>
        <dl><div><dt>Stable objects</dt><dd>{pptxReadiness.stableObjects}</dd></div><div><dt>Clean plates</dt><dd>{pptxReadiness.cleanPlateFallbacks}</dd></div></dl>
        <ul>{pptxReadiness.issues.filter((entry) => entry.severity !== "info").slice(0, 6).map((entry, index) => <li key={`${entry.code}-${entry.objectId ?? entry.slideId ?? index}`}><span><b>{entry.code}</b>{entry.objectId ? ` · ${entry.objectId}` : entry.slideId ? ` · ${entry.slideId}` : ""}<br />{entry.reason}</span></li>)}</ul>
        <p>Preflight predicts HTML capture only. The exported PPTX still requires strict quality, ISO/IEC 29500 validation, render-back, inventory review, and named visual review.</p>
      </div>
      <div className="inspector-section export-panel">
        <label htmlFor="export-source-path">Evidence-gated export</label>
        <input id="export-source-path" value={exportSourcePath} onChange={(event) => setExportSourcePath(event.target.value)} placeholder="/absolute/path/to/saved-deck.html" />
        <label htmlFor="export-service">Local service</label><input id="export-service" value={assetService} onChange={(event) => setAssetService(event.target.value)} />
        <label htmlFor="export-token">Session token</label><input id="export-token" type="password" value={assetToken} onChange={(event) => setAssetToken(event.target.value)} autoComplete="off" />
        <div className="two-col"><div><label htmlFor="export-format">Output intent</label><select id="export-format" value={exportFormat} onChange={(event) => { const format = event.target.value as ExportFormat; setExportFormat(format); if (format === "editable-pptx") setExportQualityGate("strict"); }}><option value="pdf">PDF — text-preserving static pages</option><option value="pptx">PPTX — raster, non-editable</option><option value="editable-pptx">Editable PPTX — native objects + fallbacks</option></select></div><div><label htmlFor="export-quality-gate">Quality gate</label><select id="export-quality-gate" value={exportQualityGate} disabled={exportFormat === "editable-pptx"} onChange={(event) => setExportQualityGate(event.target.value as ExportQualityGate)}><option value="strict">Strict</option><option value="report">Report</option><option value="off">Off</option></select></div></div>
        <p className="export-intent">{exportExplanation}</p>
        <button className="control-button export-button" disabled={exportBusy || !exportSourcePath.trim() || !assetToken.trim() || store.dirty || editableExportBlocked} onClick={() => { void runExport(); }}>{exportBusy ? "Exporting…" : store.dirty ? "Save before export" : editableExportBlocked ? "Resolve PPTX blockers" : "Run export"}</button>
        <p className="export-status" aria-live="polite">{exportStatus}</p>
        {exportJob && <dl><div><dt>Status</dt><dd>{exportJob.status} · {Math.round(exportJob.progress * 100)}%</dd></div>{exportJob.output && <div><dt>Output</dt><dd>{exportJob.output}</dd></div>}{exportJob.exportReport && <div><dt>Report</dt><dd>{exportJob.editableStatus ? `${exportJob.editableStatus} · ` : ""}{exportJob.exportReport}</dd></div>}{exportJob.qualityReport && <div><dt>Quality</dt><dd>{exportJob.qualityPassed === false ? "review" : "pass"} · {exportJob.qualityReport}</dd></div>}{exportJob.error && <div><dt>Error</dt><dd>{exportJob.error}</dd></div>}</dl>}
      </div>
      <div className="inspector-section"><label>Current page</label><div className="control-grid"><button disabled={store.currentSlide === 0} onClick={() => { void commitDeckOperation(reorderSlide(store.sourceHtml, store.currentSlide, store.currentSlide - 1), "Move page up"); }}>Move up</button><button disabled={store.currentSlide >= store.slideCount - 1} onClick={() => { void commitDeckOperation(reorderSlide(store.sourceHtml, store.currentSlide, store.currentSlide + 1), "Move page down"); }}>Move down</button><button onClick={() => { void commitDeckOperation(toggleSlideSkipped(store.sourceHtml, store.currentSlide), "Toggle skipped page"); }}>Skip / include</button><button className="danger-button" onClick={() => { try { void commitDeckOperation(deleteSlide(store.sourceHtml, store.currentSlide), "Delete page"); } catch (error) { setImportNotice(error instanceof Error ? error.message : String(error)); } }}>Delete page</button></div></div>
      <div className="inspector-section audit"><label>Import audit</label><dl><div><dt>Strategy</dt><dd>{store.strategy}</dd></div><div><dt>History</dt><dd>{store.history.length}/50</dd></div><div><dt>Runtime</dt><dd>Sandboxed</dd></div></dl>{store.warnings.map((warning) => <p key={warning}>⚑ {warning}</p>)}</div>
    </aside>
  </main>;
}
