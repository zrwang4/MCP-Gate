import assert from "node:assert/strict";
import test from "node:test";
import type { StdioServerConfig } from "./server-registry.ts";
import { MemorySecretStore } from "./secret-store.ts";
import { resolveStdioEnvironment } from "./stdio-upstream-client.ts";

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
  assert.deepEqual(env, {
    MODE: "production",
    API_TOKEN: "super-secret",
  });
});

test("stdio environment fails when a referenced secret is missing", async () => {
  const secrets = new MemorySecretStore();

  await assert.rejects(
    resolveStdioEnvironment(config(), secrets),
    /API_TOKEN is missing from secure storage/,
  );
});
