<setup>
<scope>
Ordinary HTML authoring, Studio editing, and CLI planning require only the core workspace tools. Python, ffmpeg, Poppler, LibreOffice, provider credentials, and PowerPoint tooling are optional and should be installed only for workflows that use them.
</scope>

<core_requirements>
- Git.
- Node.js 20 or newer. Node 22 is recommended and recorded in `.nvmrc`.
- pnpm 11.3, matching the root `packageManager` field.
- A current Chromium-compatible browser. Browser automation that can reach `127.0.0.1` is recommended for unattended agent operation.
</core_requirements>

<workspace_install>
```bash
git clone https://github.com/siva-sub/frontend-slides-studio.git
cd frontend-slides-studio
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm cli -- doctor
pnpm smoke:studio
```
If Corepack is unavailable, install the pinned pnpm release with `npm install --global pnpm@11.3.0`.
</workspace_install>

<pi_install>
Pi packages run with full system access. Review the repository before installing it. Install the checked-out local path so Pi does not try to treat this pnpm workspace as a plain npm package:
```bash
cd /absolute/path/to/frontend-slides-studio
pi install "$(pwd)"
```
Use `pi install -l "$(pwd)"` for project-local Pi settings. Run `/reload` in an existing Pi session. Invoke explicitly when needed:
```text
/skill:frontend-slides-studio Create a deck and open it in Studio.
```
`pi list` should show the local package. A fresh Pi process should list `frontend-slides-studio` among its available skills.
</pi_install>

<browser_export>
Install the Playwright Chromium binary for browser quality checks, PDF, raster PPTX, and smoke tests:
```bash
pnpm --filter @slides-studio/export-service exec playwright install chromium
```
On Linux, Playwright may report missing system libraries. Install the packages it names, or use its supported `install-deps chromium` command when administrative access is appropriate.
</browser_export>

<python_tools>
Python 3.10 or newer is required only for motion analysis, visual-master tooling, and optional extraction/inspection scripts.
```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r visual/requirements.txt
python -m pip install python-pptx
```
Activate the environment before starting Pi or the export service when those Python workflows are required. `visual/requirements.txt` installs Pillow and the optional OpenAI client. `python-pptx` supports extraction and inspection; the core TypeScript exporters do not require it.
</python_tools>

<system_tools>
Install only what the requested workflow needs:

| Capability | Tool | Typical Linux package | Typical macOS package |
| --- | --- | --- | --- |
| Motion analysis, video metadata, AVIF/video posters | ffmpeg and ffprobe | `ffmpeg` | `ffmpeg` |
| PDF inspection and render comparisons | Poppler (`pdfinfo`, `pdftoppm`) | `poppler-utils` | `poppler` |
| Editable-PPTX render-back | LibreOffice (`libreoffice` or `soffice`) | `libreoffice` | LibreOffice application |

Example Ubuntu/Debian installation:
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg poppler-utils libreoffice python3 python3-venv
```
Example macOS installation with Homebrew:
```bash
brew install ffmpeg poppler
brew install --cask libreoffice
```
</system_tools>

<provider_configuration>
HTML creation and deterministic local asset jobs require no provider credentials. Provider-backed visual generation is explicit and opt-in. Set credentials in the process environment; the project never searches user repositories for `.env` files.
```bash
export OPENAI_API_KEY="..."
# Optional OpenAI-compatible endpoint:
export OPENAI_BASE_URL="https://example.invalid/v1"
```
Never write credentials into deck HTML, AssetPlan JSON, session-state files, or git.
</provider_configuration>

<export_service_setup>
The export service requires a contained source root and one-time token:
```bash
export SLIDES_STUDIO_SOURCE_ROOT="/absolute/path/containing/decks"
export SLIDES_STUDIO_EXPORT_TOKEN="$(openssl rand -hex 32)"
pnpm dev:export
```
It binds to `http://127.0.0.1:4317` by default. Studio's launch token and the export-service token are different credentials.
</export_service_setup>

<setup_profiles>
- **Studio and share HTML:** core workspace install only.
- **PDF or raster PPTX:** core plus Playwright Chromium.
- **Motion or video media:** core plus Python 3.10, ffmpeg, and ffprobe.
- **Visual-master generation:** core plus Python environment, Pillow, and an explicitly configured provider when using network generation.
- **Editable-PPTX evidence:** core plus Playwright where quality capture is needed and LibreOffice for fresh render-back; Poppler and python-pptx are useful inspection tools.
</setup_profiles>

<verification>
```bash
pnpm cli -- doctor
pnpm check:skill
pnpm smoke:studio
```
Run `pnpm check` for the full workspace. Run `pnpm smoke` only after the optional tools required by every smoke suite are installed.
</verification>
</setup>
