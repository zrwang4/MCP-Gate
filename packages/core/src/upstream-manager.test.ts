import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreLogger } from "./logger.ts";
import { ServerRegistry } from "./server-registry.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { UpstreamManager, type UpstreamClient } from "./upstream-manager.ts";
import { RuntimeReconciler } from "./runtime-reconciler.ts";

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

    const reconciler = new RuntimeReconciler(servers, upstreams);
    await reconciler.connectAutoStart();

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





test("upstream status polling does not cancel an in-flight connect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Polling", command: "fake" });

    const tools = new ToolRegistry();
    let releaseConnect: (() => void) | undefined;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {
          await new Promise<void>((resolve) => {
            releaseConnect = resolve;
          });
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

    const connecting = upstreams.connect(config.id);
    await waitFor(() => releaseConnect !== undefined);

    upstreams.list();
    upstreams.list();
    upstreams.list();

    releaseConnect?.();
    const snapshot = await connecting;

    assert.equal(snapshot.status, "running");
    assert.equal(snapshot.toolCount, 1);
    assert.equal(snapshot.lastError, null);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});





test("upstream manager discards a stale tool refresh after disconnect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Refresh", command: "fake" });

    const tools = new ToolRegistry();
    let listToolsCalls = 0;
    let releaseListTools: (() => void) | undefined;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {},
        async disconnect() {},
        async listTools() {
          listToolsCalls += 1;
          if (listToolsCalls === 2) {
            // Gate only the refresh call; the connect-time list must settle
            // for the upstream to reach "running" in the first place.
            await new Promise<void>((resolve) => {
              releaseListTools = resolve;
            });
          }
          return [{ name: "stale_tool" }];
        },
        async callTool() {
          return {
            content: [{ type: "text" as const, text: "ok" }],
          };
        },
      }),
      logger,
    );

    await upstreams.connect(config.id);

    const refreshing = upstreams.refreshTools(config.id);
    await waitFor(() => releaseListTools !== undefined);

    await upstreams.disconnect(config.id);
    releaseListTools?.();

    await assert.rejects(refreshing, /upstream refresh superseded/);

    const snapshot = upstreams.list().find((item) => item.id === config.id);
    assert.equal(snapshot?.status, "stopped");
    assert.equal(snapshot?.toolCount, 0);
    assert.equal(tools.list().length, 0);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("upstream manager retains a client when failed connect cleanup also fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Connect Cleanup", command: "fake" });

    const tools = new ToolRegistry();
    let connectCalls = 0;
    let disconnectCalls = 0;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {
          connectCalls += 1;
          throw new Error("connect failed");
        },
        async disconnect() {
          disconnectCalls += 1;
          if (disconnectCalls === 1) throw new Error("cleanup failed");
        },
        async listTools() {
          return [];
        },
        async callTool() {
          return {
            content: [{ type: "text" as const, text: "ok" }],
          };
        },
      }),
      logger,
    );

    await assert.rejects(upstreams.connect(config.id), /connect failed/);

    const failed = upstreams.list().find((item) => item.id === config.id);
    assert.equal(failed?.status, "error");
    assert.equal(failed?.lastError, "connect failed");

    await assert.rejects(
      upstreams.connect(config.id),
      /must be disconnected successfully before reconnecting/,
    );

    await upstreams.disconnect(config.id);
    const stopped = upstreams.list().find((item) => item.id === config.id);
    assert.equal(stopped?.status, "stopped");
    assert.equal(disconnectCalls, 2);
    assert.equal(connectCalls, 1);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});


test("upstream manager retains a failed disconnect for retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Disconnect", command: "fake" });

    const tools = new ToolRegistry();
    let disconnectCalls = 0;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {},
        async disconnect() {
          disconnectCalls += 1;
          if (disconnectCalls === 1) {
            throw new Error("close failed");
          }
        },
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

    await upstreams.connect(config.id);
    await assert.rejects(upstreams.disconnect(config.id), /close failed/);

    const failed = upstreams.list().find((item) => item.id === config.id);
    assert.equal(failed?.status, "error");
    assert.equal(failed?.lastError, "close failed");
    assert.equal(failed?.toolCount, 1);

    await assert.rejects(
      upstreams.connect(config.id),
      /must be disconnected successfully before reconnecting/,
    );

    await upstreams.disconnect(config.id);

    const stopped = upstreams.list().find((item) => item.id === config.id);
    assert.equal(stopped?.status, "stopped");
    assert.equal(stopped?.lastError, null);
    assert.equal(stopped?.toolCount, 0);
    assert.equal(tools.list().length, 0);
    assert.equal(disconnectCalls, 2);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});





test("upstream manager ignores routine SSE stream recycle errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "SSE", command: "fake" });

    const tools = new ToolRegistry();
    let onError: ((error: Error) => void) | undefined;
    let onNotificationStreamRecycled: (() => void) | undefined;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        setLifecycleHandlers(handlers) {
          onError = handlers.onError;
          onNotificationStreamRecycled = handlers.onNotificationStreamRecycled;
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
      }),
      logger,
    );

    await upstreams.connect(config.id);
    onNotificationStreamRecycled?.();

    const snapshot = upstreams.list().find((item) => item.id === config.id);
    assert.equal(snapshot?.status, "running");
    assert.equal(snapshot?.lastError, null);
    assert.equal(snapshot?.toolCount, 1);
    assert.equal(snapshot?.reconnectAttempt, 0);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("upstream manager records real SSE reconnect failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "SSE Failure", command: "fake" });

    const tools = new ToolRegistry();
    let onError: ((error: Error) => void) | undefined;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        setLifecycleHandlers(handlers) {
          onError = handlers.onError;
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
      }),
      logger,
    );

    await upstreams.connect(config.id);
    onError?.(new Error("Failed to reconnect SSE stream"));

    const snapshot = upstreams.list().find((item) => item.id === config.id);
    assert.equal(snapshot?.status, "running");
    assert.equal(snapshot?.lastError, "Failed to reconnect SSE stream");
    assert.equal(snapshot?.reconnectAttempt, 0);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("upstream manager waits for an in-flight connect when disconnect is requested", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Wait", command: "fake" });

    const tools = new ToolRegistry();
    let releaseConnect: (() => void) | undefined;
    let disconnectCalls = 0;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {
          await new Promise<void>((resolve) => {
            releaseConnect = resolve;
          });
        },
        async disconnect() {
          disconnectCalls += 1;
        },
        async listTools() {
          return [{ name: "stale_tool" }];
        },
        async callTool() {
          return {
            content: [{ type: "text" as const, text: "stale" }],
          };
        },
      }),
      logger,
    );

    const connecting = upstreams.connect(config.id);
    await waitFor(() => releaseConnect !== undefined);

    const disconnecting = upstreams.disconnect(config.id);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const beforeRelease = upstreams.list().find((item) => item.id === config.id);
    assert.equal(beforeRelease?.status, "connecting");

    releaseConnect?.();

    await assert.rejects(connecting, /upstream connect superseded/);
    const stopped = await disconnecting;
    assert.equal(stopped.status, "stopped");
    assert.equal(disconnectCalls, 1);
    assert.equal(tools.list().length, 0);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("upstream manager rejects a concurrent disconnect while one is in progress", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Race", command: "fake" });

    const tools = new ToolRegistry();
    let releaseDisconnect: (() => void) | undefined;
    let disconnects = 0;

    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {},
        async disconnect() {
          disconnects += 1;
          await new Promise<void>((resolve) => {
            releaseDisconnect = resolve;
          });
        },
        async listTools() {
          return [{ name: "stale_tool" }];
        },
        async callTool() {
          return {
            content: [{ type: "text" as const, text: "stale" }],
          };
        },
      }),
      logger,
    );

    await upstreams.connect(config.id);

    const disconnecting = upstreams.disconnect(config.id);
    await waitFor(() => releaseDisconnect !== undefined);
    await assert.rejects(
      upstreams.disconnect(config.id),
      /upstream action already in progress/,
    );

    releaseDisconnect?.();
    const stopped = await disconnecting;

    assert.equal(stopped.status, "stopped");
    assert.equal(disconnects, 1);
    assert.equal(tools.list().length, 0);
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


test("upstream list is read-only and reconcile owns removed runtime cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Orphan", command: "fake" });

    const tools = new ToolRegistry();
    let disconnectCalls = 0;
    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {},
        async disconnect() {
          disconnectCalls += 1;
        },
        async listTools() {
          return [{ name: "ping" }];
        },
        async callTool() {
          return { content: [{ type: "text" as const, text: "pong" }] };
        },
      }),
      logger,
    );

    await upstreams.connect(config.id);
    await servers.remove(config.id);

    assert.equal(disconnectCalls, 0);
    assert.equal(upstreams.list().length, 0);
    assert.equal(disconnectCalls, 0);

    await upstreams.reconcile();

    assert.equal(disconnectCalls, 1);
    assert.equal(upstreams.list().length, 0);
    assert.equal(tools.list().length, 0);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});


test("reconcile disconnects upstreams disabled outside the runtime manager", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Disabled", command: "fake" });

    const tools = new ToolRegistry();
    let disconnectCalls = 0;
    const upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {},
        async disconnect() {
          disconnectCalls += 1;
        },
        async listTools() {
          return [{ name: "ping" }];
        },
        async callTool() {
          return { content: [{ type: "text" as const, text: "pong" }] };
        },
      }),
      logger,
    );

    await upstreams.connect(config.id);
    await servers.updateSettings(config.id, { enabled: false });

    assert.equal(disconnectCalls, 0);
    assert.equal(upstreams.list().find((item) => item.id === config.id)?.status, "running");

    await upstreams.reconcile();

    assert.equal(disconnectCalls, 1);
    assert.equal(upstreams.list().find((item) => item.id === config.id)?.status, "stopped");
    assert.equal(tools.list().length, 0);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});


test("upstream manager applies an exact profile server set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const first = await servers.create({ name: "First", command: "fake" });
    const second = await servers.create({ name: "Second", command: "fake" });

    const tools = new ToolRegistry();
    const upstreams = new UpstreamManager(
      servers,
      tools,
      (config) => ({
        async connect() {},
        async disconnect() {},
        async listTools() {
          return [{ name: `tool_${config.id.slice(0, 4)}` }];
        },
        async callTool() {
          return {
            content: [{ type: "text" as const, text: "ok" }],
          };
        },
      }),
      logger,
    );

    const reconciler = new RuntimeReconciler(servers, upstreams);
    await upstreams.connect(first.id);
    const result = await reconciler.applyExactSet([second.id]);

    assert.deepEqual(result.disconnected, [first.id]);
    assert.deepEqual(result.connected, [second.id]);
    assert.equal(
      upstreams.list().find((item) => item.id === first.id)?.status,
      "stopped",
    );
    assert.equal(
      upstreams.list().find((item) => item.id === second.id)?.status,
      "running",
    );
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});


test("upstream manager opens a circuit after repeated health check failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  let upstreams: UpstreamManager | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Health", command: "fake" });
    const tools = new ToolRegistry();
    let healthChecks = 0;
    let disconnectCalls = 0;

    upstreams = new UpstreamManager(
      servers,
      tools,
      () => ({
        async connect() {},
        async disconnect() { disconnectCalls += 1; },
        async healthCheck() {
          healthChecks += 1;
          throw new Error("health probe failed");
        },
        async listTools() { return [{ name: "ping" }]; },
        async callTool() {
          return { content: [{ type: "text" as const, text: "pong" }] };
        },
      }),
      logger,
      {
        healthCheckIntervalMs: 5,
        healthCheckTimeoutMs: 20,
        circuitFailureThreshold: 2,
        circuitResetMs: 100,
      },
    );

    await upstreams.connect(config.id);
    upstreams.startHealthMonitoring();

    await waitFor(() => {
      const snapshot = upstreams?.list().find((item) => item.id === config.id);
      return (
        healthChecks >= 2 &&
        disconnectCalls === 1 &&
        snapshot?.circuitState === "open" &&
        snapshot?.status === "error"
      );
    }, 500);

    const snapshot = upstreams.list().find((item) => item.id === config.id);
    assert.equal(snapshot?.healthStatus, "unhealthy");
    assert.equal(snapshot?.consecutiveFailureCount, 2);
    assert.equal(snapshot?.toolCount, 0);
    assert.ok(snapshot?.nextRetryAt);
  } finally {
    await upstreams?.stopAll().catch(() => undefined);
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("upstream manager recovers after reconnect failures trip the circuit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-upstream-"));
  let logger: CoreLogger | null = null;
  let upstreams: UpstreamManager | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const servers = new ServerRegistry(join(dir, "servers.json"), logger);
    await servers.init();
    const config = await servers.create({ name: "Breaker", command: "fake" });
    const tools = new ToolRegistry();
    let factoryCalls = 0;
    let available = false;
    let closeHandler: (() => void) | undefined;

    upstreams = new UpstreamManager(
      servers,
      tools,
      () => {
        factoryCalls += 1;
        return {
          setLifecycleHandlers(handlers) {
            if (factoryCalls === 1) closeHandler = handlers.onClose;
          },
          async connect() {
            if (factoryCalls > 1 && !available) throw new Error("downstream unavailable");
          },
          async disconnect() {},
          async listTools() { return [{ name: "ping" }]; },
          async callTool() {
            return { content: [{ type: "text" as const, text: "pong" }] };
          },
        };
      },
      logger,
      {
        reconnectDelaysMs: [5],
        circuitFailureThreshold: 2,
        circuitResetMs: 25,
      },
    );

    await upstreams.connect(config.id);
    closeHandler?.();

    await waitFor(() => {
      const snapshot = upstreams?.list().find((item) => item.id === config.id);
      return snapshot?.circuitState === "open";
    }, 500);

    const open = upstreams.list().find((item) => item.id === config.id);
    assert.equal(open?.consecutiveFailureCount, 2);
    assert.ok(open?.nextRetryAt);

    available = true;
    await waitFor(() => {
      const snapshot = upstreams?.list().find((item) => item.id === config.id);
      return (
        snapshot?.status === "running" &&
        snapshot?.circuitState === "closed"
      );
    }, 500);

    const recovered = upstreams.list().find((item) => item.id === config.id);
    assert.equal(recovered?.healthStatus, "healthy");
    assert.equal(recovered?.consecutiveFailureCount, 0);
    assert.equal(recovered?.reconnectAttempt, 0);
    assert.equal(recovered?.nextRetryAt, null);
  } finally {
    await upstreams?.stopAll().catch(() => undefined);
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
