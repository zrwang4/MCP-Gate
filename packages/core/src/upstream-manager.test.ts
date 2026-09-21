import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreLogger } from "./logger.ts";
import { ServerRegistry } from "./server-registry.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { UpstreamManager, type UpstreamClient } from "./upstream-manager.ts";

test("upstream manager connects, caches tools, and routes calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  try {
    const logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({
      name: "GitHub",
      command: "fake",
      args: [],
    });

    const tools = new ToolRegistry();
    const calls: Array<{ name: string; args: unknown }> = [];
    const fakeClient: UpstreamClient = {
      async connect() {},
      async disconnect() {},
      async listTools() {
        return [{ name: "create_issue" }, { name: "list_issues" }];
      },
      async callTool(name, args) {
        calls.push({ name, args });
        return { ok: true };
      },
    };

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => fakeClient,
      logger,
    );

    const snapshot = await upstreams.connect(config.id);
    assert.equal(snapshot.status, "running");
    assert.equal(snapshot.toolCount, 2);

    const result = await upstreams.callTool("github__create_issue", { title: "x" });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [{ name: "create_issue", args: { title: "x" } }]);

    await upstreams.disconnect(config.id);
    assert.equal(tools.list().length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("upstream manager auto-connects autoStart configurations only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  try {
    const logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();

    const auto = await servers.create({
      name: "Auto",
      command: "fake",
    });
    const manual = await servers.create({
      name: "Manual",
      command: "fake",
    });

    await servers.updateSettings(auto.id, { autoStart: true });

    const tools = new ToolRegistry();
    const connected: string[] = [];

    const upstreams = new UpstreamManager(
      servers,
      tools,
      (config) => ({
        async connect() {
          connected.push(config.id);
        },
        async disconnect() {},
        async listTools() {
          return [{ name: "ping" }];
        },
        async callTool() {
          return {
            content: [{ type: "text" as const, text: "pong" }],
          };
        },
      }),
      logger,
    );

    await upstreams.connectAutoStart();

    assert.deepEqual(connected, [auto.id]);
    assert.equal(upstreams.list().find((item) => item.id === auto.id)?.status, "running");
    assert.equal(upstreams.list().find((item) => item.id === manual.id)?.status, "configured");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
