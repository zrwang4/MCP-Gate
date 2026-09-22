import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const tauriDir = join(root, "apps", "desktop", "src-tauri");
const binariesDir = join(tauriDir, "binaries");
const resourcesDir = join(tauriDir, "resources");
const coreRuntimeDir = join(resourcesDir, "core-runtime");

function run(command, args) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

function capture(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  }).trim();
}

const targetTriple =
  process.env.MCP_GATE_TARGET_TRIPLE ||
  capture("rustc", ["--print", "host-tuple"]);

if (!targetTriple) {
  throw new Error("Unable to determine Rust target triple");
}

mkdirSync(binariesDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });
rmSync(coreRuntimeDir, { recursive: true, force: true });

console.log("[sidecar] building Core TypeScript");
run("pnpm", ["--filter", "@mcp-gate/core", "build"]);

console.log("[sidecar] creating portable production Core directory");
run("pnpm", [
  "--filter",
  "@mcp-gate/core",
  "--prod",
  "deploy",
  "--legacy",
  coreRuntimeDir,
]);

const nodeSidecar = join(
  binariesDir,
  `mcp-gate-node-${targetTriple}${process.platform === "win32" ? ".exe" : ""}`,
);

console.log(`[sidecar] copying Node runtime: ${process.execPath}`);
copyFileSync(process.execPath, nodeSidecar);
if (process.platform !== "win32") {
  chmodSync(nodeSidecar, 0o755);
}

const coreEntry = join(coreRuntimeDir, "dist", "main.js");
const entryStat = statSync(coreEntry);
if (!entryStat.isFile()) {
  throw new Error(`Core entry was not deployed: ${coreEntry}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      targetTriple,
      nodeSidecar,
      coreEntry,
      nodeVersion: process.version,
    },
    null,
    2,
  ),
);
