// Original metadata-driven style browser HTML. Browser-safe (no filesystem).
//
// generateStyleBrowserHtml() emits a self-contained HTML document with one card
// per style (32) and the layout metadata for each. No upstream images or
// binaries are embedded; all content is derived from the typed registry data.

import { allLayouts, allStyles, layoutsForStyle } from "./lookup.js";
import { REGISTRY_META } from "./generated/meta.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paletteSwatches(style: { palette: Record<string, string | undefined> }): string {
  const colors = ["paper", "accent", "ink", "muted", "rule", "accentTint", "link"];
  const chips = colors
    .map((key) => {
      const value = style.palette[key];
      if (!value) return "";
      return `<span class="chip" style="background:${escapeHtml(value)}" title="${escapeHtml(key)}: ${escapeHtml(value)}"></span>`;
    })
    .filter(Boolean)
    .join("");
  return chips ? `<div class="palette">${chips}</div>` : "";
}

function roleBadge(role: string): string {
  return `<span class="role role-${escapeHtml(role)}">${escapeHtml(role)}</span>`;
}

function layoutRows(styleId: string): string {
  return layoutsForStyle(styleId)
    .map((layout) => {
      const reusePolicy = layout.reuse.policy;
      return (
        `<tr>` +
        `<td class="mono">${escapeHtml(layout.id)}</td>` +
        `<td>${roleBadge(layout.role)}</td>` +
        `<td>${escapeHtml(layout.visualSignature)}</td>` +
        `<td class="num">${layout.capacity}</td>` +
        `<td class="num">${layout.slots.length}</td>` +
        `<td><span class="reuse reuse-${escapeHtml(reusePolicy)}">${escapeHtml(reusePolicy)}</span></td>` +
        `</tr>`
      );
    })
    .join("");
}

function styleCard(style: ReturnType<typeof allStyles>[number]): string {
  const fonts = [style.fonts.title, style.fonts.body].filter((s): s is string => Boolean(s)).map(escapeHtml).join(" · ");
  return (
    `<section class="card" id="style-${escapeHtml(style.id)}">` +
    `<header>` +
    `<h2>${escapeHtml(style.name)}</h2>` +
    `<code class="slug">${escapeHtml(style.id)}</code>` +
    `</header>` +
    (fonts ? `<p class="fonts">${fonts}</p>` : "") +
    paletteSwatches(style) +
    `<table class="layouts">` +
    `<thead><tr><th>Compound layout id</th><th>Role</th><th>Visual signature</th><th>Content capacity</th><th>Media slots</th><th>Reuse</th></tr></thead>` +
    `<tbody>${layoutRows(style.id)}</tbody>` +
    `</table>` +
    `</section>`
  );
}

/**
 * Generate a complete, self-contained HTML document listing every style as a
 * card with its layout metadata. Deterministic and image-free.
 */
export function generateStyleBrowserHtml(): string {
  const styles = allStyles();
  const cards = styles.map(styleCard).join("\n");
  const styleList = styles
    .map((style) => `<li><a href="#style-${escapeHtml(style.id)}">${escapeHtml(style.name)} <code>${escapeHtml(style.id)}</code></a></li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Style Browser — Frontend Slides Studio</title>
<style>
  :root { color-scheme: light; --ink:#1a1a1a; --muted:#666; --rule:#e3e3e3; --paper:#fafafa; --accent:#0a6; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--ink); background:var(--paper); }
  header.top { position:sticky; top:0; background:#fff; border-bottom:1px solid var(--rule); padding:14px 22px; display:flex; gap:18px; align-items:baseline; flex-wrap:wrap; }
  header.top h1 { font-size:18px; margin:0; }
  header.top .meta { color:var(--muted); font-size:13px; }
  nav.index { padding:14px 22px; }
  nav.index ul { list-style:none; columns:2; margin:0; padding:0; column-gap:32px; }
  nav.index a { color:var(--accent); text-decoration:none; }
  nav.index a code { color:var(--muted); font-size:12px; }
  main { padding:0 22px 60px; }
  .card { background:#fff; border:1px solid var(--rule); border-radius:10px; padding:18px 20px; margin:16px 0; }
  .card header { display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; }
  .card h2 { margin:0; font-size:17px; }
  .slug { color:var(--muted); font-size:12px; }
  .fonts { color:var(--muted); margin:6px 0 10px; font-size:13px; }
  .palette { display:flex; gap:6px; margin:0 0 12px; }
  .chip { width:20px; height:20px; border-radius:4px; border:1px solid var(--rule); display:inline-block; }
  table.layouts { width:100%; border-collapse:collapse; font-size:13px; }
  table.layouts th, table.layouts td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--rule); vertical-align:top; }
  table.layouts th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.03em; }
  td.num, th.num { text-align:right; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; }
  .role { display:inline-block; padding:1px 7px; border-radius:10px; font-size:11px; background:#eef; color:#336; }
  .role-content{background:#eef6ec;color:#264d1f;} .role-cover{background:#fdece6;color:#7a2410;} .role-data{background:#eaf2fb;color:#1d3f6b;} .role-section{background:#f3ecfb;color:#432466;} .role-agenda{background:#fbf3e0;color:#6b4e12;} .role-quote{background:#f1f1f4;color:#444;} .role-closing{background:#eafaf3;color:#155a36;}
  .reuse { font-size:11px; padding:1px 6px; border-radius:8px; background:#eee; color:#444; }
  .reuse-singleton{background:#fde8e1;color:#931;} .reuse-unique{background:#fff3d6;color:#6b5300;} .reuse-shared{background:#e6f4ea;color:#1b5e20;}
</style>
</head>
<body>
<header class="top">
  <h1>Style Browser</h1>
  <span class="meta">${styles.length} styles · ${allLayouts().length} layouts · source ${escapeHtml(REGISTRY_META.sourceCommit.slice(0, 10))} (Apache-2.0)</span>
</header>
<nav class="index">
  <ul>${styleList}</ul>
</nav>
<main>
${cards}
</main>
</body>
</html>
`;
}
