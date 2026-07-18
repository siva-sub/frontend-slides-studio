import { beforeEach, describe, expect, it } from "vitest";
import { useStudioStore } from "./store";

beforeEach(() => useStudioStore.getState().loadDeck({ fileName: "deck.html", html: "<html>0</html>", slideCount: 1, strategy: "section.slide", confidence: "high", warnings: [], revision: "0".repeat(64) }));

describe("Studio history", () => {
  it("caps command history at the newest 50 entries", () => { for (let index = 1; index <= 55; index++) useStudioStore.getState().commit(`<html>${index}</html>`, `Edit ${index}`, String(index).padStart(64, "0")); const state = useStudioStore.getState(); expect(state.history).toHaveLength(50); expect(state.history[0]?.label).toBe("Edit 6"); expect(state.historyIndex).toBe(49); });
  it("restores exact source snapshots through undo and redo", () => { useStudioStore.getState().commit("<html>one</html>", "one", "1".repeat(64)); useStudioStore.getState().commit("<html>two</html>", "two", "2".repeat(64)); useStudioStore.getState().undo(); expect(useStudioStore.getState().sourceHtml).toBe("<html>one</html>"); useStudioStore.getState().redo(); expect(useStudioStore.getState().sourceHtml).toBe("<html>two</html>"); });
});
