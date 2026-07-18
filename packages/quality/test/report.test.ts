import { describe, expect, it } from "vitest";
import type { QualityIssue, QualityIssueCategory } from "@slides-studio/protocol";
import { buildQualityReport, mergeQualityReports, summarizeQualityIssues } from "../src/report.js";

const categories: QualityIssueCategory[] = ["stage-bounds", "text-overflow", "media-bounds", "object-overlap", "connector-collision", "missing-asset", "unsafe-clone-content", "export-settlement", "duplicate-id", "clipped-content", "scroll-overflow", "other"];

describe("quality report construction", () => {
  it("covers every protocol category with exact summary counts", () => {
    const issues: QualityIssue[] = categories.map((category, index) => ({ category, severity: index % 4 === 0 ? "info" : index % 4 === 1 ? "warning" : index % 4 === 2 ? "error" : "critical", hard: index === 6, reason: `Issue ${category}`, evidence: [], ...(category === "export-settlement" ? { settled: false } : {}) }));
    const report = buildQualityReport({ id: "all-categories", canvas: { width: 1920, height: 1080 }, strict: true, issues });
    expect(new Set(report.issues.map((issue) => issue.category))).toEqual(new Set(categories));
    expect(report.summary).toEqual(summarizeQualityIssues(issues));
    expect(report.summary).toMatchObject({ total: 12, info: 3, warning: 3, error: 3, critical: 3, hard: 1 });
    expect(report.passed).toBe(false);
  });

  it("deduplicates identical findings when merging static and rendered reports", () => {
    const shared: QualityIssue = { category: "duplicate-id", severity: "error", hard: true, objectId: "hero", reason: "duplicate", evidence: [] };
    const staticReport = buildQualityReport({ id: "static", canvas: { width: 1280, height: 720 }, issues: [shared] });
    const browserReport = buildQualityReport({ id: "browser", canvas: { width: 1280, height: 720 }, issues: [shared, { category: "text-overflow", severity: "warning", hard: false, reason: "overflow", evidence: [] }] });
    const merged = mergeQualityReports("merged", [staticReport, browserReport]);
    expect(merged.issues).toHaveLength(2);
    expect(merged.summary).toMatchObject({ total: 2, warning: 1, error: 1, hard: 1 });
  });
});
