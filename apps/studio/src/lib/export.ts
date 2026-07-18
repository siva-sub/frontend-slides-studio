export type ExportFormat = "pdf" | "pptx";
export type ExportQualityGate = "off" | "report" | "strict";
export type ExportQualityMode = "canonical" | "imported";

export interface ExportJob {
  id: string;
  format: ExportFormat;
  status: "queued" | "running" | "complete" | "failed";
  progress: number;
  source?: string;
  output?: string;
  error?: string;
  qualityReport?: string;
  qualityPassed?: boolean;
}

export interface ExportServiceOptions {
  service: string;
  token: string;
  signal?: AbortSignal;
}

function serviceUrl(service: string, path: string): string {
  const base = service.trim().replace(/\/$/, "");
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(base)) throw new Error("Export service must be a loopback HTTP URL.");
  return `${base}${path}`;
}

function parseJob(value: unknown): ExportJob {
  if (!value || typeof value !== "object") throw new Error("Export service returned an invalid job.");
  const job = value as Partial<ExportJob>;
  if (!job.id || !job.format || !job.status || typeof job.progress !== "number") throw new Error("Export service returned an incomplete job.");
  return job as ExportJob;
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error((await response.text()) || `Export service failed with ${response.status}.`);
  return response.json();
}

export async function submitExportJob(input: { source: string; format: ExportFormat; qualityGate: ExportQualityGate; qualityMode: ExportQualityMode }, options: ExportServiceOptions): Promise<ExportJob> {
  const source = input.source.trim();
  if (!source) throw new Error("Enter a service-visible source path after saving the deck.");
  if (!options.token.trim()) throw new Error("A local export service token is required.");
  const response = await fetch(serviceUrl(options.service, "/jobs"), {
    method: "POST",
    headers: { authorization: `Bearer ${options.token.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({ source, format: input.format, qualityGate: input.qualityGate, qualityMode: input.qualityMode }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return parseJob(await responseJson(response));
}

export async function waitForExportJob(initial: ExportJob, options: ExportServiceOptions & { pollMs?: number; timeoutMs?: number; onUpdate?: (job: ExportJob) => void }): Promise<ExportJob> {
  let job = initial;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  while (job.status !== "complete" && job.status !== "failed") {
    if (Date.now() >= deadline) throw new Error(`Export job ${job.id} timed out.`);
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 250));
    const response = await fetch(serviceUrl(options.service, `/jobs/${encodeURIComponent(job.id)}`), {
      headers: { authorization: `Bearer ${options.token.trim()}` },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    job = parseJob(await responseJson(response));
    options.onUpdate?.(job);
  }
  if (job.status === "failed") throw new Error(job.error || `Export job ${job.id} failed.`);
  return job;
}
