import { describe, expect, it } from "vitest";
import { catalog } from "@slides-studio/layout-contracts";

describe("CLI surface dependencies", () => { it("ships an original compact layout catalog", () => { expect(catalog.length).toBeGreaterThanOrEqual(6); expect(new Set(catalog.map((layout) => layout.key)).size).toBe(catalog.length); }); });
