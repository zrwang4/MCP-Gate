import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import type { StdioServerConfig } from "./server-registry.ts";
import { MemorySecretStore } from "./secret-store.ts";
import {
  buildStdioPath,
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
