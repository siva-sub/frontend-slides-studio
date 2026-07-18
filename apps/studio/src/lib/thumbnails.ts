export interface SlideThumbnail {
  index: number;
  slideId: string;
  skipped: boolean;
  label: string;
  html: string;
}

const THUMBNAIL_STYLE = `html,body{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#d8d9d4!important}body{position:relative!important}#slides-studio-selection-overlay,#slides-studio-quality-focus,[data-studio-chrome],nav,aside{display:none!important}.slide{visibility:visible!important;opacity:1!important;display:block!important;pointer-events:none!important;animation:none!important;transition:none!important}.slide *, .slide *::before,.slide *::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;
const THUMBNAIL_SCRIPT = `(()=>{const fit=()=>{const stage=document.querySelector('.deck-stage')||document.querySelector('.slide');if(!stage)return;const width=stage.offsetWidth||1280,height=stage.offsetHeight||720,scale=Math.min(innerWidth/width,innerHeight/height);Object.assign(stage.style,{position:'absolute',left:((innerWidth-width*scale)/2)+'px',top:((innerHeight-height*scale)/2)+'px',width:width+'px',height:height+'px',transform:'scale('+scale+')',transformOrigin:'0 0',overflow:'hidden'});const slide=stage.matches('.slide')?stage:stage.querySelector('.slide');if(slide)Object.assign(slide.style,{position:'absolute',inset:'0',width:'100%',height:'100%',visibility:'visible',opacity:'1',display:'block'});};addEventListener('load',fit,{once:true});document.fonts?.ready?.then(fit);fit()})();`;

function serialize(doc: Document): string {
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function labelFor(slide: HTMLElement, index: number): string {
  return (slide.querySelector("h1,h2,h3")?.textContent || slide.textContent || `Page ${index + 1}`).replace(/\s+/g, " ").trim().slice(0, 44) || `Page ${index + 1}`;
}

export function buildSlideThumbnails(html: string): SlideThumbnail[] {
  const source = new DOMParser().parseFromString(html, "text/html");
  const slides = Array.from(source.querySelectorAll<HTMLElement>(".slide"));
  return slides.map((slide, index) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,template,noscript").forEach((element) => element.remove());
    const candidates = Array.from(doc.querySelectorAll<HTMLElement>(".slide"));
    candidates.forEach((candidate, candidateIndex) => {
      if (candidateIndex !== index) candidate.remove();
      else {
        candidate.classList.add("active", "visible");
        candidate.removeAttribute("aria-hidden");
        candidate.removeAttribute("contenteditable");
      }
    });
    const style = doc.createElement("style"); style.dataset.slidesStudioThumbnail = "true"; style.textContent = THUMBNAIL_STYLE; doc.head.append(style);
    const script = doc.createElement("script"); script.dataset.slidesStudioThumbnail = "true"; script.textContent = THUMBNAIL_SCRIPT; doc.body.append(script);
    return {
      index,
      slideId: slide.dataset.slideId || `slide-${index + 1}`,
      skipped: slide.dataset.slideSkipped === "true",
      label: labelFor(slide, index),
      html: serialize(doc),
    };
  });
}
