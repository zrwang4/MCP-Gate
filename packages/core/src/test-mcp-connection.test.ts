import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreLogger } from "./logger.ts";
import { ServerRegistry } from "./server-registry.ts";
import { MemorySecretStore } from "./secret-store.ts";
import {
  testMcpConnection,
  type ConnectionTestClientFactory,
} from "./test-mcp-connection.ts";

test("connection test reuses existing stdio secret without persisting changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-test-connection-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const registry = new ServerRegistry(
      join(dir, "servers.json"),
      logger,
    );
    await registry.init();
    const server = await registry.create({
      name: "Existing",
      command: "fake",
    });
    await registry.updateEnvironment(server.id, {
      env: { MODE: "old" },
      envSecretIds: { API_TOKEN: "stdio-env:existing" },
    });

    const secrets = new MemorySecretStore();
    await secrets.set("stdio-env:existing", "existing-secret");

    let disconnected = false;
    const factory: ConnectionTestClientFactory = (config) => {
      assert.equal(config.transport, "stdio");
      if (config.transport === "stdio") {
        assert.deepEqual(config.env, {
          MODE: "new",
          API_TOKEN: "existing-secret",
        });
      }

      return {
        async connect() {},
        async disconnect() {
          disconnected = true;
        },
        async listTools() {
          return [{ name: "ping" }, { name: "status" }];
        },
        async callTool() {
          return {
            content: [{ type: "text" as const, text: "ok" }],
          };
        },
      };
    };

    const result = await testMcpConnection(
      {
        serverId: server.id,
        transport: "stdio",
        command: "fake",
        args: [],
        env: { MODE: "new" },
        secretEnvKeys: ["API_TOKEN"],
        secretEnv: { API_TOKEN: "" },
      },
      registry,
      secrets,
      logger,
      { factory },
    );

    assert.equal(result.toolCount, 2);
    assert.deepEqual(result.toolNames, ["ping", "status"]);
    assert.equal(disconnected, true);

    const unchanged = registry.get(server.id);
    assert.equal(unchanged?.transport, "stdio");
    if (unchanged?.transport === "stdio") {
      assert.deepEqual(unchanged.env, { MODE: "old" });
      assert.deepEqual(unchanged.envSecretIds, {
        API_TOKEN: "stdio-env:existing",
      });
    }
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("connection test reuses existing HTTP authorization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-test-connection-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const registry = new ServerRegistry(
      join(dir, "servers.json"),
      logger,
    );
    await registry.init();
    const server = await registry.create({
      name: "Remote",
      transport: "http",
      url: "https://example.com/mcp",
      authSecretId: "http-auth:existing",
    });

    const secrets = new MemorySecretStore();
    await secrets.set(
      "http-auth:existing",
      "Bearer existing-secret",
    );

    const factory: ConnectionTestClientFactory = async (
      config,
      temporarySecrets,
    ) => {
      assert.equal(config.transport, "http");
      if (config.transport === "http") {
        assert.ok(config.authSecretId);
        assert.equal(
          await temporarySecrets.get(config.authSecretId ?? ""),
          "Bearer existing-secret",
        );
      }

      return {
        async connect() {},
        async disconnect() {},
        async listTools() {
          return [{ name: "remote_tool" }];
        },
        async callTool() {
          return {
            content: [{ type: "text" as const, text: "ok" }],
          };
        },
      };
    };

    const result = await testMcpConnection(
      {
        serverId: server.id,
        transport: "http",
        url: "https://example.com/mcp",
        authorization: "",
      },
      registry,
      secrets,
      logger,
      { factory },
    );

    assert.equal(result.transport, "http");
    assert.equal(result.toolCount, 1);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("connection test rejects a missing new secret value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-test-connection-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const registry = new ServerRegistry(
      join(dir, "servers.json"),
      logger,
    );
    await registry.init();

    await assert.rejects(
      testMcpConnection(
        {
          transport: "stdio",
          command: "fake",
          secretEnvKeys: ["API_TOKEN"],
          secretEnv: { API_TOKEN: "" },
        },
        registry,
        new MemorySecretStore(),
        logger,
        () => {
          throw new Error("factory should not be called");
        },
      ),
      /secret environment value is required for API_TOKEN/,
    );
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});


test("connection test timeout disconnects the temporary client", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-test-connection-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const registry = new ServerRegistry(
      join(dir, "servers.json"),
      logger,
    );
    await registry.init();

    let disconnected = false;
    const factory: ConnectionTestClientFactory = () => ({
      async connect() {
        await new Promise<void>(() => undefined);
      },
      async disconnect() {
        disconnected = true;
      },
      async listTools() {
        return [];
      },
      async callTool() {
        return {
          content: [{ type: "text" as const, text: "ok" }],
        };
      },
    });

    await assert.rejects(
      testMcpConnection(
        {
          transport: "stdio",
          command: "fake",
        },
        registry,
        new MemorySecretStore(),
        logger,
        {
          factory,
          connectTimeoutMs: 5,
          listToolsTimeoutMs: 5,
        },
      ),
      /MCP connection timed out after 5ms/,
    );

    assert.equal(disconnected, true);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
