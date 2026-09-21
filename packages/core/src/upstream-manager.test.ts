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
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
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
        return {
          content: [{ type: "text" as const, text: "ok" }],
        };
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
    assert.deepEqual(result, {
      content: [{ type: "text", text: "ok" }],
    });
    assert.deepEqual(calls, [{ name: "create_issue", args: { title: "x" } }]);

    await upstreams.disconnect(config.id);
    assert.equal(tools.list().length, 0);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});


test("upstream manager auto-connects autoStart configurations only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
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
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});


test("upstream manager reconnects an unexpectedly closed upstream", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({
      name: "Flaky",
      command: "fake",
    });

    const tools = new ToolRegistry();
    let factoryCalls = 0;
    let activeHandlers: {
      onClose?: () => void;
      onError?: (error: Error) => void;
    } = {};

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => {
        factoryCalls += 1;
        return {
          setLifecycleHandlers(handlers) {
            activeHandlers = handlers;
          },
          async connect() {},
          async disconnect() {},
          async listTools() {
            return [{ name: "ping" }];
          },
          async callTool() {
            return {
              content: [{ type: "text" as const, text: "pong" }],
            };
          },
        };
      },
      logger,
      { reconnectDelaysMs: [5, 10] },
    );

    await upstreams.connect(config.id);
    assert.equal(factoryCalls, 1);
    assert.equal(tools.list().length, 1);

    activeHandlers.onError?.(new Error("pipe closed"));
    activeHandlers.onClose?.();

    const dropped = upstreams.list().find((item) => item.id === config.id);
    assert.equal(dropped?.status, "error");
    assert.equal(dropped?.toolCount, 0);
    assert.equal(dropped?.reconnectAttempt, 1);
    assert.ok(dropped?.nextRetryAt);
    assert.equal(tools.list().length, 0);

    await waitFor(() => {
      const current = upstreams.list().find((item) => item.id === config.id);
      return factoryCalls >= 2 && current?.status === "running";
    });

    const recovered = upstreams.list().find((item) => item.id === config.id);
    assert.equal(recovered?.reconnectAttempt, 0);
    assert.equal(recovered?.nextRetryAt, null);
    assert.equal(recovered?.lastError, null);
    assert.equal(tools.list().length, 1);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("manual disconnect does not schedule automatic reconnect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({
      name: "Manual",
      command: "fake",
    });

    const tools = new ToolRegistry();
    let factoryCalls = 0;
    let closeHandler: (() => void) | undefined;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => {
        factoryCalls += 1;
        return {
          setLifecycleHandlers(handlers) {
            closeHandler = handlers.onClose;
          },
          async connect() {},
          async disconnect() {
            closeHandler?.();
          },
          async listTools() {
            return [{ name: "ping" }];
          },
          async callTool() {
            return {
              content: [{ type: "text" as const, text: "pong" }],
            };
          },
        };
      },
      logger,
      { reconnectDelaysMs: [5] },
    );

    await upstreams.connect(config.id);
    await upstreams.disconnect(config.id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(factoryCalls, 1);
    const snapshot = upstreams.list().find((item) => item.id === config.id);
    assert.equal(snapshot?.status, "stopped");
    assert.equal(snapshot?.reconnectAttempt, 0);
    assert.equal(snapshot?.nextRetryAt, null);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not met before timeout");
}
