import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, readdirSync, rmSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyRuntimePath, materializeRuntimeSymlinks, packageManagerCandidates, npmCommand, verifyRuntimeDependencies } from "./runtime-staging.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-gate-staging-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function link(t, target, path, type = "file") {
  try { symlinkSync(target, path, type); return true; }
  catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.skip("Windows file symlinks require Developer Mode or elevated privileges");
      return false;
    }
    throw error;
  }
}

test("Windows copier preserves multiple file aliases to the same target", (t) => {
  const root = fixture(t), source = join(root, "source"), output = join(root, "output");
  mkdirSync(source);
  const actual = join(root, "shared.txt"); writeFileSync(actual, "shared");
  if (!link(t, actual, join(source, "a")) || !link(t, actual, join(source, "b"))) return;
  copyRuntimePath(source, output, "win32");
  assert.deepEqual(readdirSync(output).sort(), ["a", "b"]);
  for (const name of ["a", "b"]) {
    assert.equal(readFileSync(join(output, name), "utf8"), "shared");
    assert.equal(lstatSync(join(output, name)).isSymbolicLink(), false);
  }
});

test("Windows copier preserves sibling directory aliases", (t) => {
  const root = fixture(t), source = join(root, "source"), shared = join(root, "shared");
  mkdirSync(source); mkdirSync(shared); writeFileSync(join(shared, "file"), "contents");
  if (!link(t, shared, join(source, "a"), "junction") || !link(t, shared, join(source, "b"), "junction")) return;
  const output = join(root, "output"); copyRuntimePath(source, output, "win32");
  assert.equal(readFileSync(join(output, "a", "file"), "utf8"), "contents");
  assert.equal(readFileSync(join(output, "b", "file"), "utf8"), "contents");
});

test("Windows copier fails on ancestor cycles instead of silently dropping files", (t) => {
  const root = fixture(t), source = join(root, "source"); mkdirSync(source);
  if (!link(t, source, join(source, "back"), "junction")) return;
  assert.throws(() => copyRuntimePath(source, join(root, "output"), "win32"), /Cyclic runtime/);
});

test("Windows copier fails on dangling required links", (t) => {
  const root = fixture(t), source = join(root, "source"); mkdirSync(source);
  if (!link(t, join(root, "missing"), join(source, "required"))) return;
  assert.throws(() => copyRuntimePath(source, join(root, "output"), "win32"), /ENOENT/);
});

test("Unix copying retains normal dereferenced file contents", (t) => {
  const root = fixture(t), source = join(root, "file"), output = join(root, "copy");
  writeFileSync(source, "node-runtime"); copyRuntimePath(source, output, "darwin");
  assert.equal(readFileSync(output, "utf8"), "node-runtime");
});

test("stage materializes external store aliases but omits workspace self references", (t) => {
  const root = fixture(t), stage = join(root, "stage"), workspace = join(root, "repo");
  mkdirSync(stage); mkdirSync(join(workspace, "packages", "core"), { recursive: true });
  const store = join(root, "store"); mkdirSync(store); writeFileSync(join(store, "file"), "dependency");
  if (!link(t, store, join(stage, "dep-a"), "junction") || !link(t, store, join(stage, "dep-b"), "junction")) return;
  if (!link(t, join(workspace, "packages", "core"), join(stage, "workspace"), "junction")) return;
  assert.deepEqual(materializeRuntimeSymlinks(stage, workspace, "win32"), { replaced: 2, dropped: 1 });
  assert.deepEqual(readdirSync(stage).sort(), ["dep-a", "dep-b"]);
  assert.equal(readFileSync(join(stage, "dep-b", "file"), "utf8"), "dependency");
});

test("materialization rejects broken dependencies before reporting success", (t) => {
  const root = fixture(t), stage = join(root, "stage"); mkdirSync(stage);
  if (!link(t, join(root, "missing"), join(stage, "dep"))) return;
  assert.throws(() => materializeRuntimeSymlinks(stage, root, "win32"), /ENOENT/);
});

test("Windows invokes pinned corepack via Node without a shell", (t) => {
  const root = fixture(t), node = join(root, "Node With Spaces", "node.exe");
  const entry = join(root, "Node With Spaces", "node_modules", "corepack", "dist", "corepack.js");
  mkdirSync(join(entry, ".."), { recursive: true }); writeFileSync(entry, "");
  assert.deepEqual(packageManagerCandidates("10.17.1", { platform: "win32", node, npmEntry: undefined })[0], {
    command: node, prefix: [entry, "pnpm@10.17.1"],
  });
});

test("Unix package manager candidates retain original order", () => {
  assert.deepEqual(packageManagerCandidates("10.17.1", { platform: "darwin" }), [
    { command: "corepack", prefix: ["pnpm@10.17.1"] }, { command: "pnpm", prefix: [] },
  ]);
  assert.deepEqual(npmCommand({ platform: "darwin" }), { command: "npm", prefix: [] });
});

test("Windows npm invocation uses a JS entry and rejects a missing npm installation", (t) => {
  const root = fixture(t), node = join(root, "node.exe"), entry = join(root, "npm-cli.js");
  writeFileSync(entry, "");
  assert.deepEqual(npmCommand({ platform: "win32", node, npmEntry: entry }), { command: node, prefix: [entry] });
  assert.throws(() => npmCommand({ platform: "win32", node, npmEntry: "" }), /Cannot locate npm-cli.js/);
});

test("final runtime verification imports declared production dependencies", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { "staging-test-dep": "1.0.0" } }));
  mkdirSync(join(root, "node_modules", "staging-test-dep"), { recursive: true });
  writeFileSync(join(root, "node_modules", "staging-test-dep", "package.json"), JSON.stringify({ name: "staging-test-dep", main: "index.js" }));
  writeFileSync(join(root, "node_modules", "staging-test-dep", "index.js"), "module.exports = {};");
  assert.doesNotThrow(() => verifyRuntimeDependencies(root));
});

test("verification rejects dependencies borrowed from a parent workspace", (t) => {
  const root = fixture(t), stage = join(root, "stage"); mkdirSync(stage);
  writeFileSync(join(stage, "package.json"), JSON.stringify({ dependencies: { "staging-test-dep": "1.0.0" } }));
  const dependency = join(root, "node_modules", "staging-test-dep"); mkdirSync(dependency, { recursive: true });
  writeFileSync(join(dependency, "package.json"), JSON.stringify({ name: "staging-test-dep", main: "index.js" }));
  writeFileSync(join(dependency, "index.js"), "module.exports = {};");
  assert.throws(() => verifyRuntimeDependencies(stage, { stdio: "pipe" }), /outside the bundled runtime/);
});
