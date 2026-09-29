import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoreLogger } from "./logger.ts";
import { ServerRegistry } from "./server-registry.ts";
import { ProfileStore } from "./profile-store.ts";
import { ToolPolicyStore } from "./tool-policy-store.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { SecretStore } from "./secret-store.ts";
import { UpstreamManager } from "./upstream-manager.ts";
import { ServerService } from "./server-service.ts";
import { MutationQueue } from "./mutation-queue.ts";
import { RuntimeReconciler } from "./runtime-reconciler.ts";

class MemorySecrets implements SecretStore {
  #values = new Map<string, string>();

  async get(id: string): Promise<string | null> {
    return this.#values.get(id) ?? null;
  }

  async set(id: string, value: string): Promise<void> {
    this.#values.set(id, value);
  }

  async delete(id: string): Promise<boolean> {
    this.#values.delete(id);
    return true;
  }
}

test("server service restores a running upstream after settings persistence failure", async () => {
  const dir = join(tmpdir(), "mcp-gate-server-service-test-" + crypto.randomUUID());
  await mkdir(dir, { recursive: true });

  const logger = new CoreLogger(join(dir, "core.jsonl"));
  await logger.init();

  const registry = new ServerRegistry(join(dir, "state", "servers.json"), logger);
  await registry.init();

  const profiles = new ProfileStore(join(dir, "profiles.json"), logger);
  await profiles.init();

  const policy = new ToolPolicyStore(join(dir, "tool-policy.json"), logger);
  await policy.init();

  const tools = new ToolRegistry(policy);
  const secrets = new MemorySecrets();
  const mutations = new MutationQueue();

  let connectCalls = 0;
  let disconnectCalls = 0;

  const upstreams = new UpstreamManager(
    registry,
    tools,
    () => ({
      async connect() {
        connectCalls += 1;
      },
      async disconnect() {
        disconnectCalls += 1;
      },
      async listTools() {
        return [];
      },
      async callTool() {
        return { content: [] };
      },
    }),
    logger,
    { mutations },
  );

  const reconciler = new RuntimeReconciler(registry, upstreams);
  const service = new ServerService(
    registry,
    profiles,
    upstreams,
    policy,
    secrets,
    logger,
    mutations,
    reconciler,
  );

  const server = await registry.create({
    name: "Settings Failure",
    transport: "stdio",
    command: "fake",
    args: [],
  });

  await upstreams.connect(server.id);
  assert.equal(connectCalls, 1);

  const stateDir = join(dir, "state");
  await rm(stateDir, { recursive: true, force: true });
  await writeFile(stateDir, "not-a-directory");

  await assert.rejects(
    service.updateSettings(server.id, { enabled: false }),
    /ENOTDIR|not a directory|open|rename/i,
  );

  assert.equal(disconnectCalls, 1);
  assert.equal(connectCalls, 2);
  assert.equal(registry.get(server.id)?.enabled, true);
  assert.equal(
    upstreams.list().find((item) => item.id === server.id)?.status,
    "running",
  );

  await logger.flush();
  await rm(dir, { recursive: true, force: true });
});
