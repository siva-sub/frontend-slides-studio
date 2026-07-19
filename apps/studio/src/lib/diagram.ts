import { renderDiagramSvg } from "@slides-studio/diagram-kit";
import { parseDiagramSpec, type DiagramSpecAny } from "@slides-studio/protocol";

export interface InsertedDiagram {
  html: string;
  objectId: string;
  spec: DiagramSpecAny;
}

function namespaceSvg(svg: string, prefix: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (root.tagName.toLowerCase() === "parsererror") throw new Error("Diagram renderer returned invalid SVG.");
  const idMap = new Map<string, string>();
  root.querySelectorAll("[id]").forEach((element) => {
    const id = element.getAttribute("id");
    if (!id) return;
    const namespaced = `${prefix}-${id}`;
    idMap.set(id, namespaced);
    element.setAttribute("id", namespaced);
  });
  root.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value;
      for (const [source, target] of idMap) value = value.replaceAll(`url(#${source})`, `url(#${target})`).replaceAll(`#${source}`, `#${target}`);
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
    const objectId = element.getAttribute("data-object-id");
    if (objectId) element.setAttribute("data-object-id", `${prefix}-${objectId}`);
    const sourceId = element.getAttribute("data-source-id");
    if (sourceId) element.setAttribute("data-source-id", `${prefix}-${sourceId}`);
  });
  root.setAttribute("width", "100%");
  root.setAttribute("height", "100%");
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return root.outerHTML;
}

export function insertDiagram(html: string, slideIndex: number, input: unknown): InsertedDiagram {
  const spec = parseDiagramSpec(input);
  const document = new DOMParser().parseFromString(html, "text/html");
  const slide = document.querySelectorAll<HTMLElement>(".slide")[slideIndex];
  if (!slide) throw new Error(`Slide ${slideIndex + 1} does not exist.`);
  const objectId = `diagram-${spec.id}`;
  const duplicate = Array.from(document.querySelectorAll<HTMLElement>("[data-object-id]")).some((element) => element.dataset.objectId === objectId);
  if (duplicate) throw new Error(`Diagram object ${objectId} already exists.`);
  const figure = document.createElement("figure");
  figure.dataset.objectId = objectId;
  figure.dataset.sourceId = spec.id;
  figure.dataset.diagramType = spec.type;
  figure.setAttribute("aria-label", `${spec.type} diagram`);
  figure.style.cssText = "position:absolute;left:10%;top:16%;width:80%;height:68%;margin:0;overflow:visible";
  figure.innerHTML = namespaceSvg(renderDiagramSvg(spec), objectId);
  const metadata = document.createElement("script"); metadata.type = "application/json"; metadata.dataset.diagramSpec = ""; metadata.textContent = JSON.stringify(spec).replace(/</g, "\\u003c"); figure.append(metadata);
  slide.append(figure);
  return { html: `<!doctype html>\n${document.documentElement.outerHTML}`, objectId, spec };
}
