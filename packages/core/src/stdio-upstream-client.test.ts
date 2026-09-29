import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StdioServerConfig } from "./server-registry.ts";
import { MemorySecretStore } from "./secret-store.ts";
import {
  buildStdioPath,
  describeStdioSpawnFailure,
  resolveStdioEnvironment,
} from "./stdio-upstream-client.ts";

function config(): StdioServerConfig {
  return {
    id: "server-1",
    name: "Env MCP",
    alias: "env-mcp",
    transport: "stdio",
    command: "fake",
    args: [],
    enabled: true,
    autoStart: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    env: {
      MODE: "production",
    },
    envSecretIds: {
      API_TOKEN: "stdio-env:token",
    },
  };
}

test("stdio environment resolves plain and secret values", async () => {
  const secrets = new MemorySecretStore();
  await secrets.set("stdio-env:token", "super-secret");

  const env = await resolveStdioEnvironment(config(), secrets);
  assert.equal(env?.MODE, "production");
  assert.equal(env?.API_TOKEN, "super-secret");
  assert.ok(env?.PATH?.includes(process.env.PATH?.split(":")[0] ?? ""));
});

test("stdio PATH adds the newest nvm Node bin when launched without a shell PATH", async (t) => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = await mkdtemp(join(tmpdir(), "mcp-gate-nvm-path-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, ".nvm/versions/node/v20.10.0/bin"), {
    recursive: true,
  });
  await mkdir(join(home, ".nvm/versions/node/v22.12.0/bin"), {
    recursive: true,
  });

  const path = buildStdioPath("/configured/bin", home, "darwin", "/usr/bin");
  const entries = path.split(":");
  assert.equal(entries[0], "/configured/bin");
  assert.equal(entries[1], "/usr/bin");
  assert.equal(
    entries[entries.length - 2],
    join(home, ".nvm/versions/node/v22.12.0/bin"),
  );
  assert.equal(
    entries[entries.length - 1],
    join(home, ".nvm/versions/node/v20.10.0/bin"),
  );
});

test("stdio environment fails when a referenced secret is missing", async () => {
  const secrets = new MemorySecretStore();

  await assert.rejects(
    resolveStdioEnvironment(config(), secrets),
    /API_TOKEN is missing from secure storage/,
  );
});

test("withTimeout resolves when the operation wins the race", async () => {
  const { withTimeout } = await import("./stdio-upstream-client.ts");
  const value = await withTimeout(() => Promise.resolve("done"), 1_000, "too slow");
  assert.equal(value, "done");
});

test("withTimeout rejects with the timeout message when the operation never settles", async () => {
  const { withTimeout } = await import("./stdio-upstream-client.ts");
  await assert.rejects(
    withTimeout(() => new Promise<string>(() => {}), 30, "handshake stuck"),
    /handshake stuck/,
  );
  // Give the never-settling promise a tick to prove nothing crashed.
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("withTimeout surfaces the operation error when it fails before the timeout", async () => {
  const { withTimeout } = await import("./stdio-upstream-client.ts");
  await assert.rejects(
    withTimeout(() => Promise.reject(new Error("spawn failed")), 1_000, "unused"),
    /spawn failed/,
  );
});

test("stdio connect fails fast when the spawned process never completes the handshake", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { StdioUpstreamClient } = await import("./stdio-upstream-client.ts");

  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-stdio-hang-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A process that reads stdin forever and never answers the initialize
  // request: exactly the shape that used to pin the mutation queue for the
  // SDK's full default timeout.
  const script = join(dir, "hang.js");
  await writeFile(script, "process.stdin.resume();\nsetInterval(() => {}, 1 << 30);\n");

  const hangConfig: StdioServerConfig = {
    ...config(),
    env: undefined,
    envSecretIds: undefined,
    command: process.execPath,
    args: [script],
  };
  const client = new StdioUpstreamClient(
    hangConfig,
    new MemorySecretStore(),
    500,
  );

  const startedAt = Date.now();
  await assert.rejects(client.connect(), /stdio handshake timed out after 500ms/);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 5_000, `connect should fail near 500ms, took ${elapsed}ms`);

  // The failed connect must release the client reference so a later
  // disconnect/reconnect is possible.
  await client.disconnect();
});

test("stdio connect succeeds well inside the timeout for a healthy server", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { StdioUpstreamClient } = await import("./stdio-upstream-client.ts");

  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-stdio-ok-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, "ok.js");

  // Asserting that a process which exits immediately produces a connect
  // error (not a hang): the timeout path must not swallow real failures.
  await writeFile(script, "process.exit(0);\n");
  const exitConfig: StdioServerConfig = {
    ...config(),
    env: undefined,
    envSecretIds: undefined,
    command: process.execPath,
    args: [script],
  };
  const client = new StdioUpstreamClient(
    exitConfig,
    new MemorySecretStore(),
    5_000,
  );
  await assert.rejects(client.connect(), /(timed out|closed|exited|EPIPE)/i);
});

test("describeStdioSpawnFailure blames a missing working directory over the command", () => {
  const hint = describeStdioSpawnFailure(
    new Error("spawn node ENOENT"),
    { name: "Env MCP", command: "node", cwd: "/nonexistent/mcp-gate-cwd" },
  );
  assert.match(hint ?? "", /working directory does not exist/);
  assert.match(hint ?? "", /\/nonexistent\/mcp-gate-cwd/);
});

test("describeStdioSpawnFailure blames the command when the cwd is fine", () => {
  const hint = describeStdioSpawnFailure(
    new Error("spawn definitely-missing-cmd-xyz ENOENT"),
    { name: "Env MCP", command: "definitely-missing-cmd-xyz", cwd: tmpdir() },
  );
  assert.match(hint ?? "", /command not found: definitely-missing-cmd-xyz/);
});

test("describeStdioSpawnFailure returns null for non-spawn errors and healthy setups", () => {
  assert.equal(
    describeStdioSpawnFailure(new Error("ECONNRESET"), {
      name: "X",
      command: "node",
    }),
    null,
  );
  // node exists and the cwd is real: the raw error should stand.
  assert.equal(
    describeStdioSpawnFailure(new Error("spawn node ENOENT"), {
      name: "X",
      command: process.execPath,
      cwd: tmpdir(),
    }),
    null,
  );
});

test("describeStdioSpawnFailure explains EACCES as permission denied", () => {
  const hint = describeStdioSpawnFailure(
    new Error("spawn /restricted/tool EACCES"),
    { name: "X", command: "/restricted/tool" },
  );
  assert.match(
    hint ?? "",
    /permission denied while launching: \/restricted\/tool/,
  );
});

test("stdio connect reports a clear error when cwd does not exist", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { StdioUpstreamClient } = await import("./stdio-upstream-client.ts");

  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-stdio-cwd-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, "ok.js");
  await writeFile(script, "process.exit(0);\n");

  // The command exists; only the cwd is broken. The raw spawn error would
  // blame "node", so the enriched message must point at the directory.
  const badCwdConfig: StdioServerConfig = {
    ...config(),
    env: undefined,
    envSecretIds: undefined,
    command: process.execPath,
    args: [script],
    cwd: join(dir, "does-not-exist"),
  };
  const client = new StdioUpstreamClient(
    badCwdConfig,
    new MemorySecretStore(),
    5_000,
  );
  await assert.rejects(
    client.connect(),
    /working directory does not exist or is not a directory/,
  );
  await client.disconnect();
});

test("stdio connect reports a clear error when the command is missing", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { StdioUpstreamClient } = await import("./stdio-upstream-client.ts");

  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-stdio-missing-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const missingCommandConfig: StdioServerConfig = {
    ...config(),
    env: undefined,
    envSecretIds: undefined,
    command: "mcp-gate-definitely-missing-cmd",
    args: [],
    cwd: dir,
  };
  const client = new StdioUpstreamClient(
    missingCommandConfig,
    new MemorySecretStore(),
    5_000,
  );
  await assert.rejects(
    client.connect(),
    /command not found: mcp-gate-definitely-missing-cmd/,
  );
  await client.disconnect();
});
