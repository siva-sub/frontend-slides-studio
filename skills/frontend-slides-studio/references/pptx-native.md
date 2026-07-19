# Native PowerPoint Shapes, Transitions, and OOXML

Frontend Slides Studio can preserve selected HTML objects as editable PowerPoint shapes. The editable exporter writes valid ISO/IEC 29500 Transitional OOXML and runs the TypeScript compatibility validator before delivery.

## Discover the Native Catalog

Run commands from the repository root:

```bash
pnpm cli -- pptx html-check --input /absolute/path/deck.html --output pptx-html-readiness.json
pnpm cli -- pptx shapes list
pnpm cli -- pptx shapes resolve --name flowChartOffPageConnector
pnpm cli -- pptx transitions
pnpm cli -- pptx validate --input /absolute/path/deck.pptx
```

The shape catalog contains 178 presets that pass the Microsoft Open XML SDK, direct `ppt-rs` validation, repair checks, python-pptx inspection, and LibreOffice render-back in the native-shape gallery gate.

The native transition catalog is `none`, `cut`, `fade`, `push`, `wipe`, `split`, `reveal`, `cover`, and `zoom`. `reveal` uses the Office 2010 `p14:reveal` namespace. Transition duration uses the Office 2010 `p14:dur` attribute; `advTm` is reserved for explicitly authored automatic slide advance and is never inferred from animation duration. The `p:reveal` emitted by pinned `ppt-rs` fails Microsoft Open XML SDK schema validation and must not be copied.

## Understand HTML Readiness

Read `../workflows/pptx-html.md` for every editable-PPTX request. Each slide must declare `data-pptx-intent="native-oriented"`, `"hybrid"`, or `"raster"`; Studio exposes the same choice in its readiness panel. The HTML readiness report is conservative:

- explicit valid shapes, tables, charts, local pictures, and DiagramSpec hosts are native candidates;
- generic text or filled elements remain runtime-dependent until browser capture sees computed style and positive bounds;
- video, canvas, iframe, generic SVG, remote/blob media, and unsupported stable elements require regional fallback;
- untagged content is preserved only in the per-slide clean plate and is not independently editable;
- invalid IDs or native metadata block editable export.

A readiness report predicts capture behavior. The actual export report determines native and fallback counts. ISO/IEC 29500 validation applies to the exported PPTX package, not the HTML source.

## Declare a Native Shape in HTML

Every editable object still needs a stable `data-object-id`. Add `data-pptx-shape` to request a native preset:

```html
<div
  data-object-id="decision-1"
  data-pptx-shape="flowChartDecision"
  data-pptx-fill="#DBEAFE"
  data-pptx-stroke="#1D4ED8"
  data-pptx-line-width="2"
  data-pptx-rotation="4"
  data-pptx-hyperlink="https://example.com"
  style="position:absolute;left:200px;top:160px;width:420px;height:220px;
         display:grid;place-items:center;background:#dbeafe;border:2px solid #1d4ed8">
  Approve?
</div>
```

Use `data-pptx-gradient` for a native linear gradient. The value is JSON and must contain at least two normalized stops:

```html
<div
  data-object-id="hero-chevron"
  data-pptx-shape="chevron"
  data-pptx-gradient='{"angle":45,"stops":[{"color":"#FDE8E1","position":0},{"color":"#F05A36","position":1,"transparency":10}]}'
  style="position:absolute;left:160px;top:240px;width:600px;height:240px">
  Native gradient
</div>
```

The browser preview remains ordinary HTML/CSS. The editable exporter reads the `data-pptx-*` contract and creates the native PowerPoint object. Invalid presets and unsafe hyperlink schemes fail before export.

## Use the Presentation Object Graph

Agents and tools can call `exportEditablePptx()` with a version 1 object graph:

```json
{
  "schemaVersion": 1,
  "title": "Native example",
  "slides": [{
    "id": "slide-1",
    "width": 1920,
    "height": 1080,
    "nativeTransition": { "kind": "wipe", "direction": "left", "durationMs": 650 },
    "objects": [{
      "id": "native-chevron",
      "sourceId": "native-chevron",
      "sourceKind": "dom",
      "type": "shape",
      "shape": "chevron",
      "x": 240,
      "y": 220,
      "width": 800,
      "height": 360,
      "zIndex": 1,
      "native": true,
      "gradient": {
        "angle": 45,
        "stops": [
          { "color": "#FDE8E1", "position": 0 },
          { "color": "#F05A36", "position": 1 }
        ]
      },
      "stroke": "#A33A1E",
      "lineWidth": 2,
      "rotation": 3,
      "text": "Native shape",
      "textColor": "#20231F",
      "bold": true,
      "hyperlink": { "url": "https://example.com", "tooltip": "Example" }
    }]
  }]
}
```

Supported shape properties include solid or linear-gradient fill, transparency, stroke width/transparency/dash, arrowheads, rotation, flips, text, font, alignment, and safe URL hyperlinks.

## Speaker Notes

Add plain-text notes to an HTML slide without exposing them on canvas:

```html
<script type="text/plain" data-speaker-notes>
Emphasize the Q2 margin change. Confirm the source before presenting.
</script>
```

Studio exposes the same source through **Speaker notes**. Notes are undoable, persist on Save/reload, appear only in Presenter view, and are removed from Audience, Presentation only, thumbnails, and shared session state. Text containing a literal closing-script sequence is stored with explicit base64 metadata and decoded before display or export.

The presentation object graph also accepts a `notes` string on each slide. When notes exist, the exporter preserves notes slides, moves `notesMasterIdLst` into schema order, adds a dedicated `theme2.xml`, repairs the notes-master relationship, and validates the result externally. The editable report records `speakerNotes`; delivery review must inspect the actual PowerPoint notes pane. When no notes are authored, unused PptxGenJS notes parts are removed.

## Native Tables and Charts

A stable-ID HTML `<table>` is captured as an editable PowerPoint table. Cell text, fill, text color, bold, alignment, `colspan`, and `rowspan` are preserved when the table is exported.

Declare an editable chart with JSON metadata on a positioned preview element:

```html
<div
  data-object-id="quarterly-chart"
  data-pptx-chart='{"chartType":"barStacked","title":"Quarterly","showLegend":true,"series":[{"name":"Actual","labels":["Q1","Q2"],"values":[10,12]},{"name":"Plan","labels":["Q1","Q2"],"values":[8,11]}]}'
  style="position:absolute;left:50%;top:20%;width:42%;height:58%;background:#eef2ff">
</div>
```

Supported categorical chart contracts are bar, horizontal bar, stacked and 100% stacked bar, line, line with markers, stacked line, pie, doughnut, area, stacked and 100% stacked area, radar, and filled radar. The exporter embeds a real editable XLSX workbook. It also removes PptxGenJS's dangling third chart-axis ID and normalizes its workbook filename for ppt-rs compatibility before validation.

## Compatibility Rules

Fourteen names in pinned `ppt-rs` are invalid OOXML preset values. Studio corrects unambiguous aliases and rejects names without a faithful preset. `cone` and `musicNote` remain unsupported until they have explicit custom geometry.

HTML object motion is settled to a static final frame. Supported page transitions map to native PowerPoint transitions. Pixel-grid, pixel-bars, and circle-reveal have no exact base OOXML equivalent and downgrade to fade with report evidence.

Use the smallest fallback region that preserves an unsupported effect. Keep titles, factual copy, numbers, tables, charts, diagrams, logos, and evidence inside stable native-oriented object boundaries. Do not duplicate text between reconstructed objects and clean-plate or regional pixels.

Run the complete gate before delivery:

```bash
pnpm check:pptx-external-compat
```

This gate validates ten raster/editable fixtures, including crop/connector, all-transition, all-native-shape, and native table/chart coverage. It does not validate a user's delivered file. Run `pnpm cli -- pptx validate --input <actual-output.pptx>`, review the actual object inventory, render back, perform a representative edit-save-reopen check, and record named visual review before status can become `passed`.
