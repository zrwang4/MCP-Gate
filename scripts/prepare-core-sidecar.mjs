import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
  const candidates = [
    // `corepack pnpm@<version>` resolves the pinned release without requiring
    // `corepack enable` or a shim on PATH.
    ...(pinned ? [{ command: "corepack", prefix: [`pnpm@${pinned}`] }] : []),
    { command: "pnpm", prefix: [] },
    ...(pinned ? [] : [{ command: "corepack", prefix: ["pnpm"] }]),
  ];

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
  { npm_config_node_linker: "hoisted" },
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

const dereferenced = dereferenceSymlinks(coreRuntimeDir);
console.log(
  `[sidecar] materialised ${dereferenced.replaced} symlink(s)` +
    `${dereferenced.dropped > 0 ? `, dropped ${dereferenced.dropped} external` : ""}`,
);

verifyResolvableDependencies();

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

/**
 * `pnpm deploy` produces a symlink-based `node_modules`
 * (`node_modules/zod -> .pnpm/zod@…/…`, `node_modules/@mcp-gate/core -> <repo>/packages/core`).
 *
 * Two problems for a shipped app:
 *  - Tauri copies bundle resources without following symlinks, so every top-level
 *    dependency ends up missing and the Core dies on its first import.
 *  - a signed app must never contain links pointing outside its own bundle.
 *
 * Links that resolve outside the staged tree are the workspace self-reference
 * that `pnpm deploy` always creates; they are dead weight once packaged, so they
 * are dropped. Everything inside the tree is materialised as real files.
 */
function dereferenceSymlinks(rootDir) {
  let replaced = 0;
  let dropped = 0;

  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync(full);
        } catch {
          // Broken link: nothing to materialise, and it must not ship.
          rmSync(full, { recursive: true, force: true });
          dropped += 1;
          continue;
        }

        if (target === rootDir || full.startsWith(`${target}${sep}`)) {
          throw new Error(
            `refusing to materialise a self-referential symlink: ${full} -> ${target}`,
          );
        }

        if (!target.startsWith(`${rootDir}${sep}`)) {
          // Workspace self-reference (`@mcp-gate/core` -> ../../packages/core);
          // it cannot survive packaging and the real code is already in dist/.
          rmSync(full, { recursive: true, force: true });
          dropped += 1;
          continue;
        }

        rmSync(full, { recursive: true, force: true });
        cpSync(target, full, { recursive: true, dereference: true });
        replaced += 1;
        if (statSync(full).isDirectory()) visit(full);
        continue;
      }

      if (entry.isDirectory()) visit(full);
    }
  };

  visit(rootDir);
  return { replaced, dropped };
}

/**
 * The whole point of staging is a self-contained runtime. Fail the build here
 * instead of shipping an app whose Core dies on its first import.
 */
function verifyResolvableDependencies() {
  const probe = [
    "const out = [];",
    'for (const name of ["@modelcontextprotocol/server", "@modelcontextprotocol/node", "@modelcontextprotocol/client", "zod"]) {',
    "  try { await import(name); out.push(`${name}:ok`); }",
    "  catch (error) { out.push(`${name}:FAIL:${error.code ?? error.message}`); }",
    "}",
    "console.log(out.join(' '));",
  ].join("\n");

  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", probe],
    { cwd: coreRuntimeDir, encoding: "utf8", env: process.env },
  );

  const failures = output
    .trim()
    .split(/\s+/)
    .filter((line) => line.includes(":FAIL:"));

  if (failures.length > 0) {
    throw new Error(
      `staged Core runtime cannot resolve its dependencies: ${failures.join(", ")}`,
    );
  }
}
