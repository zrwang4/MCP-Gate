import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageManagerCandidates, materializeRuntimeSymlinks, verifyRuntimeDependencies } from "./runtime-staging.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const tauriDir = join(root, "apps", "desktop", "src-tauri");
const binariesDir = join(tauriDir, "binaries");
const resourcesDir = join(tauriDir, "resources");
const coreRuntimeDir = join(resourcesDir, "core-runtime");

const REQUIRED_NODE_MAJOR = 22;

function assertSupportedNode() {
  const [major] = process.versions.node.split(".").map(Number);
  if (!Number.isFinite(major) || major < REQUIRED_NODE_MAJOR) {
    throw new Error(
      `Node >= ${REQUIRED_NODE_MAJOR}.0.0 is required to stage the bundled Core runtime, ` +
        `but this script runs on ${process.version}. ` +
        `The shipped sidecar is a copy of process.execPath, so an older Node would produce ` +
        `an app whose Core can never start.`,
    );
  }
}

/**
 * pnpm is the canonical package manager for this repo (`packageManager` in
 * package.json). It is needed because `pnpm deploy` has no npm equivalent, so it
 * cannot simply be swapped for `npm -w`.
 *
 * `pnpm deploy --legacy` is the flag the script relies on, and it was dropped by
 * pnpm after 10.x. A bare `pnpm` on PATH may therefore be far older than the
 * pinned version and reject the flag outright, so candidates are tried in order
 * of trust — the pinned version via corepack first, then whatever PATH offers —
 * and each one must actually support `deploy --legacy` before it is accepted.
 * Relying on `--version` alone is not enough: an ancient pnpm still prints a
 * version happily and then fails later, after half the staging has run.
 */
function resolvePackageManager() {
  const pinned = readPinnedPackageManager();
  const candidates = packageManagerCandidates(pinned);

  for (const candidate of candidates) {
    if (supportsLegacyDeploy(candidate)) return candidate;
  }

  throw new Error(
    `no usable pnpm was found. This repo pins ${pinned ?? "a pnpm version"} in ` +
      "package.json; install it, or run `corepack enable`, and try again.",
  );
}

function readPinnedPackageManager() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const match = /^pnpm@(.+)$/.exec(pkg.packageManager ?? "");
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function supportsLegacyDeploy({ command, prefix }) {
  try {
    const help = execFileSync(command, [...prefix, "deploy", "--help"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return typeof help === "string" && help.includes("--legacy");
  } catch {
    return false;
  }
}

function run(command, args, extraEnv) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
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

assertSupportedNode();

const packageManager = resolvePackageManager();

mkdirSync(binariesDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });
rmSync(coreRuntimeDir, { recursive: true, force: true });

console.log("[sidecar] building Core TypeScript");
run(packageManager.command, [
  ...packageManager.prefix,
  "--filter",
  "@mcp-gate/core",
  "build",
]);

console.log("[sidecar] creating portable production Core directory");
// `node-linker=hoisted` makes pnpm produce an npm-style flat node_modules with
// real directories. The default symlink layout is unusable in a bundle: Tauri
// copies resources without following symlinks, so every top-level dependency
// would be missing and the Core would die on its first import.
run(
  packageManager.command,
  [
    ...packageManager.prefix,
    "--filter",
    "@mcp-gate/core",
    "--prod",
    "deploy",
    "--legacy",
    coreRuntimeDir,
  ],
  {
    npm_config_node_linker: "hoisted",
    ...(process.platform === "win32" ? { npm_config_package_import_method: "copy" } : {}),
  },
);

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
if (!existsSync(coreEntry)) {
  throw new Error(`Core entry was not deployed: ${coreEntry}`);
}
const entryStat = statSync(coreEntry);
if (!entryStat.isFile()) {
  throw new Error(`Core entry is not a file: ${coreEntry}`);
}

const dereferenced = materializeRuntimeSymlinks(coreRuntimeDir, root);
console.log(
  `[sidecar] materialised ${dereferenced.replaced} symlink(s)` +
    `${dereferenced.dropped > 0 ? `, dropped ${dereferenced.dropped} external` : ""}`,
);

verifyRuntimeDependencies(coreRuntimeDir);

console.log(
  JSON.stringify(
    {
      ok: true,
      targetTriple,
      nodeSidecar,
      coreEntry,
      nodeVersion: process.version,
      materialisedSymlinks: dereferenced.replaced,
      droppedExternalSymlinks: dereferenced.dropped,
    },
    null,
    2,
  ),
);
