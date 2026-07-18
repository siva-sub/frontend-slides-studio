#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { basename, extname, resolve } from "node:path";
import { spawn } from "node:child_process";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const callerCwd = process.env.INIT_CWD || process.cwd();
const valueAfter = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const positional = process.argv.slice(2).find((value, index, all) => !value.startsWith("--") && (index === 0 || !all[index - 1]?.startsWith("--")));
const input = valueAfter("--input") || positional;
const requestedPort = Number(valueAfter("--port") || process.env.SLIDES_STUDIO_STUDIO_PORT || 4173);
const jsonOutput = process.argv.includes("--json");
const maxSourceBytes = Number(process.env.SLIDES_STUDIO_MAX_SOURCE_BYTES || 20 * 1024 * 1024);

if (!input) fail("Usage: pnpm studio:open -- --input /absolute/path/to/deck.html [--port 4173] [--json]");
const requestedPath = resolve(callerCwd, input);
if (!existsSync(requestedPath)) fail(`Studio source does not exist: ${requestedPath}`);
const sourcePath = realpathSync(requestedPath);
const sourceStat = statSync(sourcePath);
if (!sourceStat.isFile()) fail(`Studio source is not a regular file: ${sourcePath}`);
if (![".html", ".htm"].includes(extname(sourcePath).toLowerCase())) fail("Studio source must be an HTML file.");
if (sourceStat.size > maxSourceBytes) fail(`Studio source exceeds ${maxSourceBytes} bytes.`);
if (!Number.isInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65535) fail("--port must be an integer from 1 to 65535.");

const port = await availablePort(requestedPort, 100);
const token = randomBytes(24).toString("base64url");
const stateDir = resolve(repositoryRoot, ".slides-studio");
mkdirSync(stateDir, { recursive: true });
const logPath = resolve(stateDir, `studio-${port}.log`);
const statePath = resolve(stateDir, `studio-${port}.json`);
const log = openSync(logPath, "a");
const viteBin = resolve(packageRoot, "node_modules/vite/bin/vite.js");
if (!existsSync(viteBin)) fail("Vite is not installed. Run pnpm install from the Frontend Slides Studio repository root.");

const child = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: packageRoot,
  detached: true,
  env: {
    ...process.env,
    SLIDES_STUDIO_INITIAL_DECK: sourcePath,
    SLIDES_STUDIO_SESSION_TOKEN: token,
    SLIDES_STUDIO_STUDIO_PORT: String(port),
    SLIDES_STUDIO_MAX_SOURCE_BYTES: String(maxSourceBytes),
  },
  stdio: ["ignore", log, log],
});
child.unref();
closeSync(log);

const baseUrl = `http://127.0.0.1:${port}`;
try {
  await waitForReady(baseUrl, token, child.pid, 20_000);
} catch (error) {
  try { process.kill(child.pid, "SIGTERM"); } catch {}
  const detail = readFileSync(logPath, "utf8").split("\n").slice(-20).join("\n");
  fail(`${error instanceof Error ? error.message : String(error)}\n${detail}`);
}

const url = `${baseUrl}/?session=${encodeURIComponent(token)}`;
const state = { schemaVersion: 1, pid: child.pid, port, url, sourcePath, fileName: basename(sourcePath), logPath, startedAt: new Date().toISOString() };
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
if (jsonOutput) console.log(JSON.stringify({ ...state, statePath }));
else {
  console.log(`Studio URL: ${url}`);
  console.log(`Source: ${sourcePath}`);
  console.log(`PID: ${child.pid}`);
  console.log(`Log: ${logPath}`);
  console.log(`Stop: pnpm studio:stop -- --state ${statePath}`);
}

function fail(message) { console.error(message); process.exit(1); }

function availablePort(start, scan) {
  return new Promise((resolvePort, reject) => {
    const tryPort = (port) => {
      if (port >= start + scan || port > 65535) return reject(new Error(`No available Studio port found from ${start}.`));
      const server = net.createServer();
      server.once("error", () => tryPort(port + 1));
      server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(port)));
    };
    tryPort(start);
  });
}

async function waitForReady(base, sessionToken, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      const response = await fetch(`${base}/api/studio-session?token=${encodeURIComponent(sessionToken)}`, {
        headers: { origin: base, "x-slides-studio-session": sessionToken },
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Studio did not become ready within ${timeoutMs}ms.`);
}
