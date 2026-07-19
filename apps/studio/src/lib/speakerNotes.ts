const NOTES_SELECTOR = 'script[type="text/plain"][data-speaker-notes]';
const BASE64_ENCODING = "base64";

function serialize(doc: Document): string { return `<!doctype html>\n${doc.documentElement.outerHTML}`; }

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function notesFromElement(element: HTMLScriptElement | null): string {
  if (!element) return "";
  const value = element.textContent ?? "";
  if (element.dataset.speakerNotesEncoding !== BASE64_ENCODING) return value;
  try { return decodeBase64(value); } catch { return ""; }
}

export function readSpeakerNotes(html: string, slideIndex: number): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slide = doc.querySelectorAll<HTMLElement>(".slide")[slideIndex];
  return notesFromElement(slide?.querySelector<HTMLScriptElement>(NOTES_SELECTOR) ?? null);
}

export function readAllSpeakerNotes(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll<HTMLElement>(".slide"), (slide) => notesFromElement(slide.querySelector<HTMLScriptElement>(NOTES_SELECTOR)));
}

export function readPresentationSpeakerNotes(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll<HTMLElement>(".slide"))
    .filter((slide) => slide.dataset.slideSkipped !== "true")
    .map((slide) => notesFromElement(slide.querySelector<HTMLScriptElement>(NOTES_SELECTOR)));
}

export function applySpeakerNotes(html: string, slideIndex: number, notes: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const slide = doc.querySelectorAll<HTMLElement>(".slide")[slideIndex];
  if (!slide) throw new Error(`Slide ${slideIndex + 1} was not found.`);
  slide.querySelectorAll(NOTES_SELECTOR).forEach((element) => element.remove());
  if (notes.length > 0) {
    const element = doc.createElement("script");
    element.type = "text/plain";
    element.dataset.speakerNotes = "";
    if (/<\/script/i.test(notes)) {
      element.dataset.speakerNotesEncoding = BASE64_ENCODING;
      element.textContent = encodeBase64(notes);
    } else {
      element.textContent = notes;
    }
    slide.append(element);
  }
  return serialize(doc);
}

export function stripSpeakerNotes(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("[data-speaker-notes]").forEach((element) => element.remove());
  return serialize(doc);
}
