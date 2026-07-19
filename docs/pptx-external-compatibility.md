# External PPTX Compatibility Gate

Frontend Slides Studio validates generated PPTX packages internally and can run a separate external acceptance gate against Microsoft Open XML SDK diagnostics through OfficeCLI and against `ppt-rs` package rules.

This is **ISO/IEC 29500 Transitional package compatibility validation, not formal certification**. Editable output still requires fresh render-back and named visual review before its report can become `passed`.

## Pinned validators

The gate verifies clean source checkouts before accepting evidence:

| Validator | Version | Commit |
| --- | --- | --- |
| [iOfficeAI/OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) | 1.0.138 | `274f7e3ebf54631e8696df36d2f51bbba1db41d8` |
| [yingkitw/ppt-rs](https://github.com/yingkitw/ppt-rs) | 0.2.22 | `2e5a3f812711bfeeb729c5f7e5938c1367c3f480` |

## Setup

Install or provide:

- OfficeCLI 1.0.138 on `PATH`;
- clean validator checkouts at `/home/siva/Projects/OfficeCLI` and `/home/siva/Projects/ppt-rs`, or override them with `OFFICECLI_ROOT` and `PPT_RS_ROOT`;
- Rust/Cargo;
- Python 3 with `python-pptx` and Pillow;
- LibreOffice;
- Poppler utilities (`pdfinfo` and `pdftoppm`);
- Playwright Chromium used by the export service.

Example:

```bash
git clone https://github.com/iOfficeAI/OfficeCLI /home/siva/Projects/OfficeCLI
git -C /home/siva/Projects/OfficeCLI checkout 274f7e3ebf54631e8696df36d2f51bbba1db41d8

git clone https://github.com/yingkitw/ppt-rs /home/siva/Projects/ppt-rs
git -C /home/siva/Projects/ppt-rs checkout 2e5a3f812711bfeeb729c5f7e5938c1367c3f480

python3 -m pip install python-pptx Pillow
```

Follow OfficeCLI's own installation instructions so `officecli --version` reports `1.0.138`.

## Run

```bash
pnpm check:pptx-external-compat
```

The default machine-readable report is:

```text
.slides-studio/pptx-external-compat/report.json
```

Override the report root when needed:

```bash
PPTX_EXTERNAL_REPORT_ROOT=/tmp/pptx-compat \
PPT_RS_ROOT=/path/to/ppt-rs \
OFFICECLI_ROOT=/path/to/OfficeCLI \
pnpm check:pptx-external-compat
```

## Artifact matrix

The gate generates and checks seven presentations:

1. raster PPTX from 1280×720 HTML;
2. raster PPTX from 1920×1080 HTML;
3. editable PPTX with stable-ID native text and shapes;
4. editable PPTX with un-ID'd CSS decoration preserved in a clean plate;
5. editable PPTX with no stable object IDs and a nonblank full-slide fallback;
6. multi-slide editable PPTX;
7. editable PPTX with cropped and rotated media plus segmented native connectors.

For every artifact it records a SHA-256 digest and runs:

- `officecli validate --json` using Microsoft Open XML SDK validation;
- `officecli view ... issues --json`, outline parsing, and screenshot render;
- `pptcli validate --json`;
- a compiled harness calling `ppt_rs::validate_package_bytes()` directly;
- `ppt_rs::oxml::PptxRepair::validate()` with zero repair issues required;
- `python-pptx` open, slide-count, 16:9, text, and native-object-name checks;
- independent LibreOffice PDF render-back and nonblank page checks;
- crop, rotation, connector, clean-plate, and no-ID fallback evidence checks where applicable.

The command fails on any Open XML SDK schema error, any `ppt-rs` Error-severity finding, any repair finding, missing expected object or visual evidence, blank rendering, page-count mismatch, or non-16:9 output.

## Upstream `ppt-rs` suite health

At the pinned commit, the complete non-MCP suite runs with `cli` and `web2ppt` features and passes **1,106 tests, 0 failed, 0 ignored**:

```bash
cargo test --workspace --all-targets --features cli,web2ppt
```

The unmodified command requested for every feature currently fails before running tests because the pinned source imports `rmcp::model::Content` while its locked `rmcp` 2.2.0 exposes `ContentBlock`:

```bash
cargo test --workspace --all-targets --all-features
```

This is an upstream checkout defect, not a Studio artifact failure. It is retained in reporting rather than suppressed or misrepresented as a passing unmodified suite. The Studio artifact gate uses the default-feature direct validation API and the `cli` feature, neither of which depends on the broken MCP module.
