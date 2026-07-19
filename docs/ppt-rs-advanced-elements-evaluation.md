# ppt-rs Advanced Native Element Evaluation

This evaluation covers `yingkitw/ppt-rs` 0.2.22 at commit `2e5a3f812711bfeeb729c5f7e5938c1367c3f480`. It distinguishes a declared Rust model, generated package parts, and a feature that Frontend Slides Studio can safely author and validate.

## Implemented in Frontend Slides Studio

| Capability | Upstream implementation | Studio implementation |
| --- | --- | --- |
| Native tables | `src/generator/table/`, `table_merge.rs`, and table XML tests | Typed table objects, HTML table capture, fills, text styling, column/row sizing, colspan/rowspan, native table export |
| Native charts | `src/generator/charts/` and chart package tests | Typed categorical bar/line/pie/doughnut/area/radar variants, editable embedded XLSX workbook, dangling-axis cleanup, ppt-rs-compatible workbook naming |
| Speaker notes | `notes_xml.rs`, `notes_slide.rs`, notes master validation | Slide `notes` and HTML `data-speaker-notes`, corrected presentation child order, theme2, notes-master relationship, content type, and external validation |
| Shapes and connectors | `shapes.rs`, `shapes_xml.rs`, `connectors.rs` | 178 externally validated presets, compatibility aliases, gradients, text, links, rotation, connectors, and selection-pane names |
| Slide transitions | `slide_content/transition.rs` | Every ppt-rs transition kind, with invalid base `p:reveal` corrected to Office 2010 `p14:reveal`; duration uses `p14:dur` and never the automatic-advance `advTm` attribute |

## Validated When Present, Not Authored

| Capability | Source model | Decision |
| --- | --- | --- |
| Comments | `slide_content/comments.rs` | Requires comment authors, comment parts, per-slide relationships, stable author IDs, and UI/thread semantics. Studio validates package relationships but does not claim comment authoring. |
| Ink annotations | `slide_content/ink_annotations.rs` | Requires typed ink strokes, pressure/timing semantics, InkML parts, and coordinate conversion. Browser pointer drawings cannot be mapped losslessly without a dedicated contract. |
| Embedded fonts | `slide_content/embedded_fonts.rs` | Embedding requires font-license permission, obfuscation rules, subset metadata, and real font binaries. Studio will not copy or embed fonts implicitly. |
| Digital signatures | `slide_content/digital_signature.rs` | A valid signature needs a user-controlled private key, certificate chain, signed-part inventory, canonicalization, and trust UX. Generating placeholder signature XML would be misleading and insecure. |
| Sections | `slide_content/sections.rs` | Sections are package metadata rather than visible slide content. A future contract must preserve IDs through reorder, duplicate, and delete operations before authoring is safe. |
| Slide-show settings | `slide_content/slide_show_settings.rs` | Kiosk/presenter/range settings need explicit delivery intent and stable slide ranges. Studio does not infer them from HTML navigation. |
| Print/handout settings | `print_settings.rs` and handout package rules | Native handouts require a handout master, theme3, page geometry, placeholders, and print policy. PDF remains the current deterministic print deliverable. |
| Presentation settings | `presentation_settings.rs` | Read/write support must be tied to explicit user intent; no defaults are silently copied from ppt-rs. |

## Not Present as a Native ppt-rs Feature

`ppt-rs` implements slide transitions. It does not implement a native PowerPoint object-animation timing tree equivalent to Studio's MotionProgram tracks. Studio therefore settles object motion to a deterministic final state. It does not claim that HTML object animation becomes native PowerPoint animation.

## Acceptance Rule

An advanced element becomes a Studio authoring feature only after it has:

1. a versioned presentation-object or deck contract;
2. source or Studio controls that preserve stable identity;
3. deterministic OOXML generation without raw untrusted XML injection;
4. TypeScript validation and mutation tests;
5. Microsoft Open XML SDK and direct ppt-rs validation with zero errors;
6. zero repair findings;
7. python-pptx inspection where supported;
8. fresh LibreOffice or PowerPoint render-back and manual visual review.

Until all eight conditions pass, the feature stays listed as validated-when-present or unsupported. This prevents declared structs or synthetic XML from being reported as working PowerPoint authoring.
