#!/usr/bin/env node
// Stages the bundled Core runtime for desktop packaging:
//   src-tauri/resources/core-runtime/
//     node            # real node binary, found by CoreSupervisor
//     dist/**         # compiled core (tsc -p tsconfig.build.json)
//     package.json    # so ESM resolution works inside the bundle
//     node_modules/** # production deps only (includes optional @github/keytar)

import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { copyRuntimePath, npmCommand, materializeRuntimeSymlinks, verifyRuntimeDependencies } from "./runtime-staging.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const coreDir = join(repoRoot, "packages", "core");
const staging = join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "resources",
  "core-runtime",
);

function fail(message) {
  console.error(`[prepare-desktop-runtime] ${message}`);
  process.exit(1);
}

function copyPath(from, to) {
  if (!existsSync(from)) fail(`missing source: ${from}`);
  copyRuntimePath(from, to);
}

function sizeOf(path) {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    const info = statSync(current);
    if (info.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else {
      total += info.size;
    }
  }
  return total;
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "dist"), { recursive: true });

if (!existsSync(join(coreDir, "dist", "main.js"))) {
  fail(
    "packages/core/dist/main.js not found; run `npm run build -w @mcp-gate/core` first",
  );
}

copyPath(join(coreDir, "dist"), join(staging, "dist"));
copyPath(join(coreDir, "package.json"), join(staging, "package.json"));
const nodeResourceName = process.platform === "win32" ? "node.exe" : "node";
copyPath(process.execPath, join(staging, nodeResourceName));
if (process.platform !== "win32") chmodSync(join(staging, nodeResourceName), 0o755);

const npm = npmCommand();
execFileSync(
  npm.command,
  [
    ...npm.prefix,
    "install",
    "--omit=dev",
    "--no-audit",
    "--no-funding",
    "--loglevel=error",
  ],
  { cwd: staging, stdio: "inherit" },
);

materializeRuntimeSymlinks(staging, repoRoot);
verifyRuntimeDependencies(staging);

if (process.platform === "darwin" && !existsSync(join(staging, "node_modules", "@github", "keytar"))) {
  console.warn(
    "[prepare-desktop-runtime] warning: @github/keytar missing; Keychain-backed secrets will be unavailable in the bundled app",
  );
}

const totalBytes = sizeOf(staging);
console.log(
  `[prepare-desktop-runtime] staged core-runtime (${(totalBytes / 1024 / 1024).toFixed(1)} MB) at ${staging}`,
);
