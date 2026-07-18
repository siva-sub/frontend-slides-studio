import { create } from "zustand";
import type { Confidence, ImportStrategy } from "./lib/normalizeDeck";

export type StudioMode = "browse" | "edit" | "move";
export interface HistoryEntry { html: string; label: string; revision: string; }
interface StudioState {
  deckId: string;
  fileName: string;
  sourceHtml: string;
  mode: StudioMode;
  selectedObjectId: string | null;
  selectedObjectTag: string | null;
  currentSlide: number;
  slideCount: number;
  strategy: ImportStrategy;
  confidence: Confidence;
  warnings: string[];
  history: HistoryEntry[];
  historyIndex: number;
  dirty: boolean;
  search: string;
  loadDeck(payload: { fileName: string; html: string; slideCount: number; strategy: ImportStrategy; confidence: Confidence; warnings: string[]; revision: string }): void;
  setMode(mode: StudioMode): void;
  selectObject(id: string | null, tagName?: string | null): void;
  setCurrentSlide(index: number): void;
  setSlideCount(count: number): void;
  setSearch(search: string): void;
  commit(html: string, label: string, revision: string): void;
  undo(): void;
  redo(): void;
  markSaved(): void;
}

export const useStudioStore = create<StudioState>((set) => ({
  deckId: "welcome", fileName: "untitled.html", sourceHtml: "", mode: "browse", selectedObjectId: null, selectedObjectTag: null, currentSlide: 0, slideCount: 0, strategy: "document", confidence: "low", warnings: [], history: [], historyIndex: -1, dirty: false, search: "",
  loadDeck: (payload) => set({ deckId: `${payload.fileName}:${payload.revision.slice(0, 12)}`, fileName: payload.fileName, sourceHtml: payload.html, slideCount: payload.slideCount, strategy: payload.strategy, confidence: payload.confidence, warnings: payload.warnings, history: [{ html: payload.html, label: "Imported", revision: payload.revision }], historyIndex: 0, dirty: false, selectedObjectId: null, selectedObjectTag: null, currentSlide: 0 }),
  setMode: (mode) => set({ mode }), selectObject: (selectedObjectId, selectedObjectTag = null) => set({ selectedObjectId, selectedObjectTag }), setCurrentSlide: (currentSlide) => set({ currentSlide }), setSlideCount: (slideCount) => set((state) => ({ slideCount, currentSlide: Math.min(state.currentSlide, Math.max(0, slideCount - 1)) })), setSearch: (search) => set({ search }),
  commit: (html, label, revision) => set((state) => { const history = [...state.history.slice(0, state.historyIndex + 1), { html, label, revision }].slice(-50); return { sourceHtml: html, history, historyIndex: history.length - 1, dirty: true }; }),
  undo: () => set((state) => { const index = Math.max(0, state.historyIndex - 1); return { historyIndex: index, sourceHtml: state.history[index]?.html ?? state.sourceHtml, dirty: true }; }),
  redo: () => set((state) => { const index = Math.min(state.history.length - 1, state.historyIndex + 1); return { historyIndex: index, sourceHtml: state.history[index]?.html ?? state.sourceHtml, dirty: true }; }),
  markSaved: () => set({ dirty: false }),
}));
