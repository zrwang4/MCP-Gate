import {
  copyFileSync, cpSync, existsSync, lstatSync, mkdirSync,
  readdirSync, realpathSync, rmSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

/** Avoid Windows .cmd shims without enabling shell command interpretation. */
export function packageManagerCandidates(pinned, {
  platform = process.platform,
  node = process.execPath,
  npmEntry = process.env.npm_execpath,
} = {}) {
  const candidates = [];
  if (platform === "win32") {
    const entries = [join(dirname(node), "node_modules", "corepack", "dist", "corepack.js")];
    if (npmEntry) entries.push(resolve(dirname(npmEntry), "..", "..", "corepack", "dist", "corepack.js"));
    for (const entry of new Set(entries)) {
      if (existsSync(entry)) candidates.push({
        command: node, prefix: [entry, pinned ? `pnpm@${pinned}` : "pnpm"],
      });
    }
  }
  if (pinned) candidates.push({ command: "corepack", prefix: [`pnpm@${pinned}`] });
  candidates.push({ command: "pnpm", prefix: [] });
  if (!pinned) candidates.push({ command: "corepack", prefix: ["pnpm"] });
  return candidates;
}

export function npmCommand({
  platform = process.platform,
  node = process.execPath,
  npmEntry = process.env.npm_execpath,
} = {}) {
  if (platform !== "win32") return { command: "npm", prefix: [] };
  const entries = [npmEntry, join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js")];
  const entry = entries.find((path) => path && path.endsWith("npm-cli.js") && existsSync(path));
  if (!entry) throw new Error("Cannot locate npm-cli.js on Windows; install npm with Node 22 or run staging through npm run.");
  return { command: node, prefix: [entry] };
}

/** Windows entry-by-entry copying avoids recursive native cp on cloud folders.
 * Only ancestor directories are tracked: separate aliases must both be copied.
 * Broken links, cycles and unreadable files fail staging, never disappear silently.
 */
export function copyRuntimePath(from, to, platform = process.platform) {
  if (platform !== "win32") {
    cpSync(from, to, { recursive: true, dereference: true });
    return;
  }
  function copy(source, target, ancestors) {
    const real = realpathSync(source);
    const info = lstatSync(real);
    if (info.isDirectory()) {
      if (ancestors.has(real)) throw new Error(`Cyclic runtime directory link: ${source} -> ${real}`);
      const branch = new Set(ancestors);
      branch.add(real);
      mkdirSync(target, { recursive: true });
      for (const entry of readdirSync(real)) copy(join(real, entry), join(target, entry), branch);
    } else if (info.isFile()) {
      copyFileSync(real, target);
    } else {
      throw new Error(`Unsupported runtime file: ${source}`);
    }
  }
  copy(from, to, new Set());
}

export function materializeRuntimeSymlinks(rootDir, workspaceRoot, platform = process.platform) {
  const root = realpathSync(rootDir);
  const packages = join(realpathSync(workspaceRoot), "packages");
  let replaced = 0;
  let dropped = 0;
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = realpathSync(full); // Broken required links fail the build.
        if (target === root || full.startsWith(`${target}${sep}`)) {
          throw new Error(`Self-referential runtime symlink: ${full} -> ${target}`);
        }
        if (target === packages || target.startsWith(`${packages}${sep}`)) {
          rmSync(full, { recursive: true, force: true });
          dropped++;
          continue;
        }
        // Store links outside the stage are materialized too; only known
        // workspace self-references above are safe to omit.
        rmSync(full, { recursive: true, force: true });
        copyRuntimePath(target, full, platform);
        replaced++;
      } else if (entry.isDirectory()) {
        visit(full);
      }
    }
  }
  visit(root);
  return { replaced, dropped };
}

/** Run after the FINAL stage, not only the pnpm stage that Tauri overwrites. */
export function verifyRuntimeDependencies(runtimeDir, { stdio = "inherit" } = {}) {
  const probe = `
    import { readFileSync, realpathSync } from 'node:fs';
    import { sep } from 'node:path';
    import { fileURLToPath } from 'node:url';
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const root = realpathSync('.') + sep;
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      try {
        const resolved = import.meta.resolve(name);
        if (!resolved.startsWith('node:') && !realpathSync(fileURLToPath(resolved)).startsWith(root)) {
          throw new Error('dependency resolves outside the bundled runtime: ' + resolved);
        }
        await import(name);
      }
      catch (error) { console.error(name + ': ' + (error.stack ?? error)); process.exitCode = 1; }
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: runtimeDir, stdio, env: process.env,
  });
}
