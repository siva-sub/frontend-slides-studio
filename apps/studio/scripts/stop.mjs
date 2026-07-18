#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const valueAfter = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const requested = valueAfter("--state");
const port = valueAfter("--port");
const statePath = requested
  ? resolve(process.env.INIT_CWD || process.cwd(), requested)
  : resolve(repositoryRoot, ".slides-studio", `studio-${port || 4173}.json`);

if (!existsSync(statePath)) {
  console.log(`No Studio session state found: ${statePath}`);
  process.exit(0);
}

const state = JSON.parse(readFileSync(statePath, "utf8"));
const pid = Number(state.pid);
const command = processCommand(pid);
if (!Number.isInteger(pid) || pid <= 0 || !/(?:vite[/.]|vite\.js)/.test(command) || !command.includes(String(state.port))) {
  console.error(`Refusing to stop PID ${state.pid ?? "unknown"}; it is not the recorded Vite Studio process.`);
  process.exit(1);
}

try { process.kill(pid, "SIGTERM"); } catch (error) {
  if (error?.code !== "ESRCH") throw error;
}
rmSync(statePath, { force: true });
console.log(`Stopped Studio PID ${pid} on port ${state.port}.`);

function processCommand(targetPid) {
  if (!Number.isInteger(targetPid) || targetPid <= 0) return "";
  try { return execFileSync("ps", ["-p", String(targetPid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}
