import { computePlacement } from "@slides-studio/media-kit";
import {
  assetJobSchema,
  assetPlanSchema,
  type AssetJob,
  type AssetPlan,
} from "@slides-studio/protocol";

export interface PreparedMedia {
  dataUrl: string;
  sha256: string;
  mime: string;
  originalBytes: number;
  storedBytes: number;
  width?: number;
  height?: number;
  warning?: string;
}

export interface MediaCrop { x: number; y: number; width: number; height: number; }
export interface MediaReframe {
  fit: "contain" | "cover";
  focalX: number;
  focalY: number;
  panX: number;
  panY: number;
  zoom: number;
  rotation: number;
  alt: string;
  layoutSlot: string;
  crop?: MediaCrop;
}

export interface AssetServiceOptions {
  service: string;
  token: string;
  fetcher?: typeof fetch;
}

const dataUrlFor = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const sha256 = async (blob: Blob): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const clampUnit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
const clamp = (value: number, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
const serialize = (doc: Document): string => `<!doctype html>\n${doc.documentElement.outerHTML}`;
const selectedMedia = (doc: Document, objectId: string) => Array.from(doc.querySelectorAll<HTMLElement>("img[data-object-id],video[data-object-id]")).find((element) => element.dataset.objectId === objectId) ?? null;
const serviceUrl = (service: string, path: string) => `${service.replace(/\/$/, "")}${path}`;
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });

export async function prepareMedia(file: File, maxDimension = 1400, quality = 0.78): Promise<PreparedMedia> {
  let stored: Blob = file; let width: number | undefined; let height: number | undefined;
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml" && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      width = canvas.width; height = canvas.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (compressed && compressed.size < file.size) stored = compressed;
    } catch {
      stored = file;
    }
  }
  return {
    dataUrl: await dataUrlFor(stored),
    sha256: await sha256(stored),
    mime: stored.type || file.type || "application/octet-stream",
    originalBytes: file.size,
    storedBytes: stored.size,
    ...(width ? { width } : {}), ...(height ? { height } : {}),
    ...(stored.size > 10 * 1024 * 1024 ? { warning: `Embedded payload is ${(stored.size / 1024 / 1024).toFixed(2)} MiB; attach a folder workspace to stage it offline.` } : {}),
  };
}

export function applyMediaSource(html: string, objectId: string, source: { src: string; sha256: string; originalName: string; width?: number; height?: number }): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const media = selectedMedia(doc, objectId);
  if (!media) return html;
  media.setAttribute("src", source.src);
  media.dataset.assetSha256 = source.sha256;
  media.dataset.originalName = source.originalName;
  if (source.width) media.dataset.sourceWidth = String(source.width);
  if (source.height) media.dataset.sourceHeight = String(source.height);
  return serialize(doc);
}

export function resolvePreviewMediaSources(html: string, sources: ReadonlyMap<string, string>): string {
  if (sources.size === 0) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll<HTMLElement>("img[src],video[src],audio[src],source[src]").forEach((element) => {
    const source = element.getAttribute("src");
    const preview = source ? sources.get(source) : undefined;
    if (preview) element.setAttribute("src", preview);
  });
  return serialize(doc);
}

export function readMediaReframe(html: string, objectId: string): MediaReframe | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const media = selectedMedia(doc, objectId);
  if (!media) return null;
  const fit = media.dataset.mediaFit === "contain" || media.style.objectFit === "contain" ? "contain" : "cover";
  const focalX = clampUnit(Number(media.dataset.focalX ?? 0.5)); const focalY = clampUnit(Number(media.dataset.focalY ?? 0.5));
  const panX = clamp(Number(media.dataset.panX ?? 0), -1, 1, 0); const panY = clamp(Number(media.dataset.panY ?? 0), -1, 1, 0);
  const zoom = clamp(Number(media.dataset.mediaZoom ?? 1), 0.1, 10, 1); const rotation = clamp(Number(media.dataset.mediaRotation ?? 0), -360, 360, 0);
  const cropValues = [media.dataset.cropX, media.dataset.cropY, media.dataset.cropWidth, media.dataset.cropHeight].map(Number);
  const crop = cropValues.every(Number.isFinite) ? { x: clampUnit(cropValues[0]!), y: clampUnit(cropValues[1]!), width: clamp(cropValues[2]!, 0.0001, 1, 1), height: clamp(cropValues[3]!, 0.0001, 1, 1) } : undefined;
  return { fit, focalX, focalY, panX, panY, zoom, rotation, alt: media.getAttribute("alt") ?? "", layoutSlot: media.dataset.layoutSlot ?? "freeform", ...(crop ? { crop } : {}) };
}

export function applyMediaReframe(html: string, objectId: string, changes: Partial<MediaReframe>): string {
  const doc = new DOMParser().parseFromString(html, "text/html"); const media = selectedMedia(doc, objectId); if (!media) return html;
  const current = readMediaReframe(html, objectId) ?? { fit: "cover" as const, focalX: 0.5, focalY: 0.5, panX: 0, panY: 0, zoom: 1, rotation: 0, alt: "", layoutSlot: "freeform" };
  const next: MediaReframe = {
    fit: changes.fit ?? current.fit,
    focalX: clampUnit(changes.focalX ?? current.focalX), focalY: clampUnit(changes.focalY ?? current.focalY),
    panX: clamp(changes.panX ?? current.panX, -1, 1, 0), panY: clamp(changes.panY ?? current.panY, -1, 1, 0),
    zoom: clamp(changes.zoom ?? current.zoom, 0.1, 10, 1), rotation: clamp(changes.rotation ?? current.rotation, -360, 360, 0),
    alt: changes.alt ?? current.alt, layoutSlot: changes.layoutSlot ?? current.layoutSlot,
    ...(changes.crop ? { crop: changes.crop } : current.crop ? { crop: current.crop } : {}),
  };
  const geometryChanged = ["fit", "focalX", "focalY", "panX", "panY", "zoom"].some((key) => Object.prototype.hasOwnProperty.call(changes, key));
  const sourceWidth = Number(media.dataset.sourceWidth); const sourceHeight = Number(media.dataset.sourceHeight);
  const slotWidth = Number.parseFloat(media.style.width || media.getAttribute("width") || "0"); const slotHeight = Number.parseFloat(media.style.height || media.getAttribute("height") || "0");
  if (!changes.crop && geometryChanged && sourceWidth > 0 && sourceHeight > 0 && slotWidth > 0 && slotHeight > 0) {
    const placement = computePlacement({ source: { width: sourceWidth, height: sourceHeight }, slot: { x: 0, y: 0, width: slotWidth, height: slotHeight }, fit: next.fit, focal: { x: next.focalX, y: next.focalY }, pan: { x: next.panX, y: next.panY }, zoom: next.zoom, rotation: next.rotation });
    next.crop = { x: placement.crop.x / sourceWidth, y: placement.crop.y / sourceHeight, width: placement.crop.width / sourceWidth, height: placement.crop.height / sourceHeight };
  }
  media.dataset.mediaFit = next.fit; media.dataset.focalX = String(next.focalX); media.dataset.focalY = String(next.focalY);
  media.dataset.panX = String(next.panX); media.dataset.panY = String(next.panY); media.dataset.mediaZoom = String(next.zoom); media.dataset.mediaRotation = String(next.rotation); media.dataset.layoutSlot = next.layoutSlot;
  if (next.crop) { media.dataset.cropX = String(next.crop.x); media.dataset.cropY = String(next.crop.y); media.dataset.cropWidth = String(next.crop.width); media.dataset.cropHeight = String(next.crop.height); }
  else for (const name of ["cropX", "cropY", "cropWidth", "cropHeight"] as const) delete media.dataset[name];
  media.setAttribute("alt", next.alt);
  const positionX = clampUnit(next.crop ? next.crop.x + next.crop.width / 2 : next.focalX + next.panX); const positionY = clampUnit(next.crop ? next.crop.y + next.crop.height / 2 : next.focalY + next.panY);
  media.style.objectFit = next.fit; media.style.objectPosition = `${Math.round(positionX * 10_000) / 100}% ${Math.round(positionY * 10_000) / 100}%`; media.style.setProperty("scale", String(next.zoom)); media.style.setProperty("rotate", `${next.rotation}deg`);
  return serialize(doc);
}

export function resetMediaReframe(html: string, objectId: string): string {
  const current = readMediaReframe(html, objectId); if (!current) return html;
  const reset = applyMediaReframe(html, objectId, { fit: "cover", focalX: 0.5, focalY: 0.5, panX: 0, panY: 0, zoom: 1, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } });
  const doc = new DOMParser().parseFromString(reset, "text/html"); const media = selectedMedia(doc, objectId); if (!media) return html;
  for (const name of ["cropX", "cropY", "cropWidth", "cropHeight"] as const) delete media.dataset[name];
  media.style.removeProperty("scale"); media.style.removeProperty("rotate");
  return serialize(doc);
}

export async function createStudioAssetPlan(input: { prompt: string; slideId?: string; styleId?: string; layoutId?: string; id?: string }): Promise<AssetPlan> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Describe the asset before generating it.");
  const promptHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return assetPlanSchema.parse({
    schemaVersion: 1,
    id: input.id ?? `studio-asset-${crypto.randomUUID()}`,
    ...(input.slideId ? { slideId: input.slideId } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
    ...(input.layoutId ? { layoutId: input.layoutId } : {}),
    operation: "generate",
    stages: ["prompt", "provider", "evidence", "review"],
    capabilities: ["ordinary-generation"],
    prompt,
    promptHash: { algorithm: "sha256", value: promptHash },
    referenceHashes: [],
    protectedRegions: [],
    alternativeRegions: [],
    placements: [],
  });
}

export async function submitAssetJob(planInput: unknown, options: AssetServiceOptions): Promise<AssetJob> {
  const plan = assetPlanSchema.parse(planInput);
  const response = await (options.fetcher ?? fetch)(serviceUrl(options.service, "/asset-jobs"), {
    method: "POST",
    headers: { ...authorization(options.token), "content-type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  if (!response.ok) throw new Error(`Asset service rejected the plan (${response.status}): ${await response.text()}`);
  return assetJobSchema.parse(await response.json());
}

export async function waitForAssetJob(job: AssetJob, options: AssetServiceOptions & { pollMs?: number; timeoutMs?: number }): Promise<AssetJob> {
  const fetcher = options.fetcher ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let current = job;
  while (!["complete", "failed", "cancelled"].includes(current.status)) {
    if (Date.now() >= deadline) throw new Error(`Asset job ${job.id} timed out.`);
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 300));
    const response = await fetcher(serviceUrl(options.service, `/asset-jobs/${encodeURIComponent(job.id)}`), { headers: authorization(options.token) });
    if (!response.ok) throw new Error(`Asset job poll failed (${response.status}): ${await response.text()}`);
    current = assetJobSchema.parse(await response.json());
  }
  if (current.status !== "complete") throw new Error(current.error ?? `Asset job ended as ${current.status}.`);
  return current;
}

export function generatedMediaArtifact(job: AssetJob): string | null {
  return job.output?.artifacts.find((path) => /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(path)) ?? null;
}

export async function fetchAssetArtifact(jobId: string, path: string, options: AssetServiceOptions): Promise<Blob> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await (options.fetcher ?? fetch)(serviceUrl(options.service, `/asset-jobs/${encodeURIComponent(jobId)}/artifacts/${encodedPath}`), { headers: authorization(options.token) });
  if (!response.ok) throw new Error(`Generated artifact download failed (${response.status}): ${await response.text()}`);
  return response.blob();
}
