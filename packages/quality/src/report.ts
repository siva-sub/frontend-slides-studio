import {
  qualityReportSchema,
  type CanvasSpec,
  type QualityIssue,
  type QualityReport,
  type QualityReportSummary,
} from "@slides-studio/protocol";

export interface QualityReportInput {
  id: string;
  deckId?: string;
  canvas: CanvasSpec;
  mode?: "canonical" | "imported";
  strict?: boolean;
  issues?: QualityIssue[];
}

export function summarizeQualityIssues(issues: QualityIssue[]): QualityReportSummary {
  const summary: QualityReportSummary = { total: issues.length, info: 0, warning: 0, error: 0, critical: 0, hard: 0 };
  for (const issue of issues) {
    summary[issue.severity] += 1;
    if (issue.hard) summary.hard += 1;
  }
  return summary;
}

export function buildQualityReport(input: QualityReportInput): QualityReport {
  const issues = input.issues ?? [];
  const blocking = issues.some((issue) => issue.hard || issue.severity === "error" || issue.severity === "critical" || (issue.category === "export-settlement" && issue.settled !== true));
  return qualityReportSchema.parse({
    schemaVersion: 1,
    id: input.id,
    ...(input.deckId ? { deckId: input.deckId } : {}),
    canvas: input.canvas,
    mode: input.mode ?? "canonical",
    strict: input.strict ?? false,
    issues,
    passed: !blocking,
    summary: summarizeQualityIssues(issues),
  });
}

function issueKey(issue: QualityIssue): string {
  return JSON.stringify([issue.category, issue.slideId ?? "", issue.objectId ?? "", issue.pair ?? [], issue.group ?? "", issue.reason, issue.settled]);
}

export function mergeQualityReports(id: string, reports: QualityReport[], overrides: Partial<Omit<QualityReportInput, "id" | "issues">> = {}): QualityReport {
  if (reports.length === 0 && !overrides.canvas) throw new Error("mergeQualityReports requires a report or canvas override");
  const first = reports[0];
  const issues = new Map<string, QualityIssue>();
  for (const report of reports) for (const issue of report.issues) issues.set(issueKey(issue), issue);
  const deckId = overrides.deckId ?? first?.deckId;
  return buildQualityReport({
    id,
    ...(deckId ? { deckId } : {}),
    canvas: overrides.canvas ?? first!.canvas,
    mode: overrides.mode ?? first?.mode ?? "canonical",
    strict: overrides.strict ?? reports.some((report) => report.strict),
    issues: [...issues.values()],
  });
}
