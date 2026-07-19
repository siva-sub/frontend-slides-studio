# ppt-rs TypeScript Adaptation Matrix

This document maps `yingkitw/ppt-rs` 0.2.22 at commit `2e5a3f812711bfeeb729c5f7e5938c1367c3f480` to Frontend Slides Studio. The source is Apache-2.0. Adaptations retain notices and exact provenance.

The goal is broad native PowerPoint coverage without replacing Studio's DOM-first HTML authoring model. `ppt-rs` remains an external oracle. Frontend Slides Studio ports applicable invariants and implements them in TypeScript.

## Important Source Findings

`ppt-rs` defines 124 distinct preset names in `src/generator/shapes.rs`. OfficeCLI accepted 110 of them in a generated 124-shape probe. Fourteen names failed the Microsoft Open XML SDK enumeration: `flowChartData`, `flowChartOffPageConnector`, `curvedLeftRightArrow`, `curvedUpDownArrow`, `pentArrow`, `isoTrapezoid`, `cone`, `cylinder`, `musicNote`, `seal`, `seal4`, `seal8`, `seal16`, and `seal32`. The TypeScript port must not reproduce invalid OOXML. It exposes the full schema-valid native catalog and explicit compatibility aliases or unsupported findings for these names.

The source defines nine transition enum values in `src/generator/slide_content/transition.rs`: none, cut, fade, push, wipe, split, reveal, cover, and zoom. None and cut emit no XML. The remaining seven emit native `<p:transition>` children. The library does not implement native object-animation timelines. Studio preserves its richer HTML transitions and can map supported slide transitions to native PowerPoint XML while reporting any downgrade.

The HTML importer in `src/import/html.rs` tokenizes HTML into headings, bullets, tables, code blocks, image placeholders, and notes. That model intentionally flattens page structure. Studio retains arbitrary positioned DOM and therefore ports parser safety, entity, style, image, and round-trip invariants rather than the flattening behavior.

## Top-Level Integration Test Matrix

| Upstream test | Count | Studio disposition |
| --- | ---: | --- |
| `advanced_features_test.rs` | 2 | Direct: connectors and gradients become native shape/export tests. |
| `api_export_test.rs` | 14 | Conditional: export API contracts map to Studio CLI/service tests; PDF-to-PPTX and image-export APIs remain out of scope. |
| `chart_generation_test.rs` | 1 | Conditional: validate native chart packages when Studio emits chart objects. |
| `chart_test.rs` | 1 | Conditional: chart object and embedded workbook validation. |
| `compatibility_test.rs` | 6 | Direct: ZIP, content types, presentation, slides, and complete compatibility gate. |
| `compression_test.rs` | 11 | Oracle-only: package compression does not define Studio output semantics. Media deduplication and valid ZIP output remain direct checks. |
| `export_html_test.rs` | 2 | Direct: author/share HTML preservation and sanitized export. |
| `export_markdown_test.rs` | 10 | Non-applicable: Studio does not treat Markdown as a delivery format. |
| `image_enhancement_test.rs` | 6 | Direct: crop plus conditional image effects; unsupported effects must remain explicit fallbacks. |
| `image_url_test.rs` | 1 | Non-applicable network behavior: Studio stages deck-local media and does not fetch arbitrary image URLs during ordinary builds. |
| `image_xml_test.rs` | 38 | Direct: media content types, relationships, IDs, dimensions, positions, escaping, aspect ratio, and format handling. |
| `import_html_test.rs` | 85 | Direct where DOM-safe: entities, Unicode, nested styles, tables, images, skipped scripts/styles, comments, void tags, and malformed input. Structural heading-to-bullet flattening is non-applicable. |
| `import_merge_test.rs` | 1 | Conditional: page/deck merge remains a future Studio operation. |
| `integration_tests.rs` | 11 | Direct: empty/multi-slide packages, required files, metadata, layout wiring, and validation failures. |
| `layouts_packaging_test.rs` | 16 | Direct: layout/master relationship integrity and mixed-layout packaging. Template cloning is conditional. |
| `mcp_integration_test.rs` | 21 | Non-applicable: Studio does not embed the ppt-rs MCP server. The pinned source currently fails all-feature compilation against locked rmcp 2.2.0. |
| `memory_profile_test.rs` | 6 | Oracle-only: Rust eager/lazy memory behavior does not apply. Studio retains large-deck browser and export smoke coverage. |
| `new_capabilities_test.rs` | 23 | Direct or conditional: images, table merges, themes, settings, and package helper invariants. |
| `new_features_test.rs` | 19 | Direct for HTML entities/styles/tables/images/links; Markdown task lists and Mermaid conversion remain separate from PPTX compatibility. |
| `output_quality_test.rs` | 22 | Direct: ZIP, required parts, XML, text, Unicode, escapes, tables, size, and multi-slide preservation. |
| `package_validation_test.rs` | 8 | Direct: complete TypeScript rule port plus mutation tests. |
| `powerpoint_compat_test.rs` | 22 | Direct: relationship order, slide IDs, master text styles, full themes, properties, layouts, notes, handouts, charts, and variant matrix. Feature-specific rules run only when those parts exist. |
| `pptx_advanced_elements_test.rs` | 33 | Direct for supported images, tables, and charts; generator-only builders become object-graph tests. |
| `pptx_elements_test.rs` | 31 | Direct: native text, Unicode, escapes, size, bold, slides, and content preservation. |
| `repair_compare_test.rs` | 1 | Direct detection: valid Studio output must produce zero repair findings. Studio does not silently repair generated output. |
| `round_trip_html_test.rs` | 5 | Direct: positioned HTML survives Studio normalization and HTML build round trips. |
| `round_trip_markdown_test.rs` | 2 | Non-applicable. |
| `table_xml_test.rs` | 17 | Conditional native table support plus direct XML-validation fixtures. |
| `theme_customization_test.rs` | 4 | Direct: full theme package and custom theme validation. |
| `validation_test.rs` | 6 | Direct: required parts, XML well-formedness, input checks, and stable diagnostics. |
| `visual_polish_test.rs` | 1 | Direct: native transitions, rotation, hyperlinks, text, tables, and shapes. |

The non-MCP upstream command passes 1,106 tests with zero failures and zero ignored tests. The all-features command does not reach test execution because of the documented rmcp API compile defect.

## Source Unit-Test Families

The 701 source-unit tests cover these groups:

- package generation, relationships, content types, properties, masters, layouts, themes, notes, and handouts;
- native shapes, connectors, gradients, hyperlinks, rotations, and text formatting;
- images, media, crops, effects, deduplication, audio/video metadata, and relationships;
- tables, merged cells, charts, embedded workbooks, comments, ink, fonts, signatures, sections, slideshow settings, and print settings;
- HTML tokenization, entity decoding, inline style inheritance, tables, images, security exclusions, and content limits;
- XML namespaces, escaping, parsing, editing, validation, and repair detection;
- CLI, Markdown, Mermaid, web fetching, compression, templates, and performance.

The TypeScript port treats the first six groups as direct or conditional PowerPoint coverage. CLI syntax, Markdown conversion, web fetching, Rust memory behavior, and MCP transport are not part of the PPTX object model.

## Porting Rules

1. A copied Apache-2.0 test or constant must retain its license notice and exact provenance.
2. Every native shape must use a schema-valid OOXML preset or an explicit custom geometry. Invalid upstream preset names cannot pass through unchanged.
3. A feature-specific rule is conditional. A deck without charts, notes, handouts, comments, ink, fonts, or signatures does not need those parts.
4. The validator reports findings and never suppresses OfficeCLI or ppt-rs errors.
5. Repair logic detects defects. It does not mutate a generated artifact inside the acceptance gate.
6. Native slide transitions and HTML runtime transitions are separate capabilities. Reports record any mapping or downgrade.
7. Native object animation remains unsupported until the exporter emits valid PowerPoint timing XML and independent validators accept it.
8. Studio HTML remains authoritative. Imported HTML is sanitized and normalized without forcing it into ppt-rs heading-and-bullet semantics.

## Implementation Status

| Area | Implemented scope | Evidence |
| --- | --- | --- |
| TypeScript OOXML validator | ZIP CRC, strict XML without DTDs, content types, relationships, PresentationML namespace, presentation, master/layout/theme, slides, shape IDs/names/presets/extents, transitions, charts, notes, and handouts | `packages/pptx-compat/test/validator.test.ts` mutation tests and direct use in every export |
| Native shape catalog | 178 Microsoft Open XML SDK-validated presets, four legacy Studio aliases, and explicit ppt-rs compatibility mappings | Fifteen-slide gallery passes the complete nine-artifact external gate |
| Native transitions | none, cut, fade, push, wipe, split, reveal, cover, and zoom; Studio transitions map with downgrade evidence, duration uses `p14:dur`, and automatic advance is never inferred | Eight-slide transition artifact passes OfficeCLI, ppt-rs, repair, python-pptx, OfficeCLI rendering, and LibreOffice |
| HTML/XML invariants | Entities, Unicode, escaping, nested style, lists, links, tables, code, images, blockquotes, malformed HTML recovery, stable-ID round trips, semantic share HTML, and executable-attribute removal | `pptRsHtmlCompatibility.test.ts`, export tests, strict XML mutation tests, and Studio/export smoke |
| Native tables, charts, and notes | Stable-ID HTML table capture, typed table/chart objects, categorical bar/line/pie/doughnut/area/radar variants, merged cells, native chart XML, embedded XLSX workbooks, and schema-correct speaker notes with theme2 | Unit tests, browser capture smoke, TypeScript validation, and the ten-artifact external gate |
| Invocation | CLI discovery/resolution/validation, Studio native-shape insertion, HTML `data-pptx-*` metadata, and presentation-object graph fields | CLI, Studio unit, browser smoke, editable smoke, and external gallery tests |

Handout layouts, comments, ink, embedded fonts, digital signatures, sections, slideshow settings, and object-animation timing XML are not claimed as Studio authoring features. Their package parts are validated when present. They require dedicated authoring contracts and independently validated artifacts before they can be reported as ported.
