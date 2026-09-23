import assert from "node:assert/strict";
import test from "node:test";
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
