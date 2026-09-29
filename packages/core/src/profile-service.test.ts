import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { CoreLogger } from "./logger.ts";
import { ProfileStore } from "./profile-store.ts";
import { ServerRegistry } from "./server-registry.ts";
import { ToolPolicyStore } from "./tool-policy-store.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { UpstreamManager } from "./upstream-manager.ts";
import { RuntimeReconciler } from "./runtime-reconciler.ts";
import { MutationQueue } from "./mutation-queue.ts";
import { ProfileService } from "./profile-service.ts";

test("profile service restores active runtime after profile delete persistence failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-profile-service-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const registry = new ServerRegistry(join(dir, "servers.json"), logger);
    await registry.init();

    const profileFile = join(dir, "state", "profiles.json");
    await mkdir(join(dir, "state"), { recursive: true });
    const profiles = new ProfileStore(profileFile, logger);
    await profiles.init();

    const policy = new ToolPolicyStore(join(dir, "tool-policy.json"), logger);
    await policy.init();
    const tools = new ToolRegistry(policy);

    const server = await registry.create({
      name: "Profile Member",
      transport: "stdio",
      command: "fake",
      args: [],
    });

    let connectCalls = 0;
    let disconnectCalls = 0;
    const mutations = new MutationQueue();

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
    const service = new ProfileService(
      profiles,
      registry,
      reconciler,
      mutations,
    );

    const profile = await service.create("Active", [server.id]);
    await service.activate(profile.id);
    assert.equal(profiles.activeProfileId, profile.id);
    assert.equal(connectCalls, 1);

    const stateDir = join(dir, "state");
    await rm(stateDir, { recursive: true, force: true });
    await writeFile(stateDir, "not-a-directory");

    await assert.rejects(
      service.remove(profile.id),
      /ENOTDIR|not a directory|open|rename/i,
    );

    assert.equal(profiles.activeProfileId, profile.id);
    assert.equal(disconnectCalls, 1);
    assert.equal(connectCalls, 2);
    assert.equal(
      upstreams.list().find((item) => item.id === server.id)?.status,
      "running",
    );
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
