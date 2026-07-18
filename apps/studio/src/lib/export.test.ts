import { afterEach, describe, expect, it, vi } from "vitest";
import { submitExportJob, waitForExportJob } from "./export";

afterEach(() => vi.unstubAllGlobals());

const queued = { id: "job-1", format: "pdf" as const, status: "queued" as const, progress: 0 };

describe("Studio export client", () => {
  it("submits the established jobs contract and returns quality evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(queued), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...queued, status: "running", progress: 0.5, qualityReport: "/jobs/job-1/quality-report.json", qualityPassed: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...queued, status: "complete", progress: 1, output: "/jobs/job-1/deck.pdf", qualityReport: "/jobs/job-1/quality-report.json", qualityPassed: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const accepted = await submitExportJob({ source: "/source/deck.html", format: "pdf", qualityGate: "strict", qualityMode: "canonical" }, { service: "http://127.0.0.1:4317", token: "secret" });
    const updates: string[] = [];
    const complete = await waitForExportJob(accepted, { service: "http://127.0.0.1:4317", token: "secret", pollMs: 0, onUpdate: (job) => updates.push(job.status) });
    expect(complete.output).toBe("/jobs/job-1/deck.pdf");
    expect(complete.qualityReport).toMatch(/quality-report\.json$/);
    expect(updates).toEqual(["running", "complete"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ source: "/source/deck.html", format: "pdf", qualityGate: "strict", qualityMode: "canonical" });
  });

  it("rejects non-loopback services and unsaved paths", async () => {
    await expect(submitExportJob({ source: "", format: "pdf", qualityGate: "report", qualityMode: "canonical" }, { service: "http://127.0.0.1:4317", token: "secret" })).rejects.toThrow(/source path/);
    await expect(submitExportJob({ source: "/deck.html", format: "pdf", qualityGate: "report", qualityMode: "canonical" }, { service: "https://example.com", token: "secret" })).rejects.toThrow(/loopback/);
  });
});
