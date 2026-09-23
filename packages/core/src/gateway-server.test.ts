import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { GatewayAccessController } from "./gateway-access.ts";
import {
  GatewayServer,
  createGatewayProtocolServer,
} from "./gateway-server.ts";
import { CoreLogger } from "./logger.ts";
import { MemorySecretStore } from "./secret-store.ts";
import { ToolRegistry } from "./tool-registry.ts";
import type { UpstreamManager } from "./upstream-manager.ts";

test("gateway protocol server lists and routes aggregated tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-gateway-"));

  try {
    const logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const tools = new ToolRegistry();
    tools.replaceServerTools("srv-1", "echo", [
      {
        name: "say",
        description: "Echo text",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
        },
      },
    ]);

    const calls: Array<{ name: string; args: unknown }> = [];
    const caller = {
      async callTool(name: string, args: unknown): Promise<CallToolResult> {
        calls.push({ name, args });
        return {
          content: [
            {
              type: "text",
              text: String((args as { text?: unknown }).text ?? ""),
            },
          ],
        };
      },
    };

    const server = createGatewayProtocolServer(tools, caller, logger);
    const client = new Client({
      name: "mcp-gate-test",
      version: "0.1.0",
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ["echo__say"],
    );

    const result = await client.callTool({
      name: "echo__say",
      arguments: { text: "hello" },
    });

    assert.deepEqual(calls, [
      {
        name: "echo__say",
        args: { text: "hello" },
      },
    ]);
    assert.equal(result.content[0]?.type, "text");
    if (result.content[0]?.type === "text") {
      assert.equal(result.content[0].text, "hello");
    }

    await client.close();
    await server.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mcp-proxy hosts the secured gateway and routes aggregated tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-mcp-proxy-"));
  const port = await unusedPort();
  const logger = new CoreLogger(join(dir, "core.jsonl"));
  await logger.init();

  const access = new GatewayAccessController(
    join(dir, "gateway-access.json"),
    new MemorySecretStore(),
    logger,
  );
  await access.init();
  const { apiKey } = await access.rotate();

  const tools = new ToolRegistry();
  tools.replaceServerTools("srv-1", "echo", [
    {
      name: "say",
      description: "Echo text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  ]);

  const gateway = new GatewayServer(
    {
      host: "127.0.0.1",
      port,
      filesystemRoot: dir,
      connectionTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
      sessionIdleTimeoutMs: 30_000,
      managementHost: "127.0.0.1",
      managementPort: port + 1,
      managementToken: "test-management-token",
      logFile: join(dir, "core.jsonl"),
      serverConfigFile: join(dir, "servers.json"),
      toolPolicyFile: join(dir, "tool-policy.json"),
      profileFile: join(dir, "profiles.json"),
      gatewayAccessFile: join(dir, "gateway-access.json"),
      auditFile: join(dir, "audit.jsonl"),
    },
    tools,
    {
      async callTool(name: string, args: unknown): Promise<CallToolResult> {
        assert.equal(name, "echo__say");
        return {
          content: [
            {
              type: "text",
              text: String((args as { text: string }).text),
            },
          ],
        };
      },
    } as unknown as UpstreamManager,
    access,
    logger,
  );

  const client = new Client({
    name: "mcp-proxy-gateway-test",
    version: "1.0.0",
  }, { versionNegotiation: { mode: "auto" } });
  const legacyClient = new Client({
    name: "mcp-proxy-legacy-gateway-test",
    version: "1.0.0",
  });
  try {
    await gateway.start();

    const health = await fetch(`http://127.0.0.1:${port}/ping`);
    assert.equal(await health.text(), "pong");

    const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "unauthorized-test", version: "1" },
        },
      }),
    });
    assert.equal(unauthorized.status, 401);

    const hostileHostStatus = await postInitialize(port, {
      host: "untrusted.example",
      authorization: `Bearer ${apiKey}`,
    });
    assert.equal(hostileHostStatus, 403);

    const hostileOriginStatus = await postInitialize(port, {
      origin: "https://untrusted.example",
      authorization: `Bearer ${apiKey}`,
    });
    assert.equal(hostileOriginStatus, 403);

    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        },
      ),
    );
    assert.match(client.getNegotiatedProtocolVersion() ?? "", /^2026-/);

    await legacyClient.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        },
      ),
    );
    assert.match(legacyClient.getNegotiatedProtocolVersion() ?? "", /^2025-/);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ["echo__say"]);
    assert.deepEqual(
      (await legacyClient.listTools()).tools.map((tool) => tool.name),
      ["echo__say"],
    );
    const result = await client.callTool({
      name: "echo__say",
      arguments: { text: "through mcp-proxy" },
    });
    assert.deepEqual(result.content, [
      { type: "text", text: "through mcp-proxy" },
    ]);

    tools.replaceServerTools("srv-1", "echo", [
      { name: "say", inputSchema: { type: "object" } },
      { name: "status", inputSchema: { type: "object" } },
    ]);
    const refreshed = await client.listTools();
    assert.deepEqual(
      refreshed.tools.map((tool) => tool.name).sort(),
      ["echo__say", "echo__status"],
    );
    assert.deepEqual(
      (await legacyClient.listTools()).tools.map((tool) => tool.name).sort(),
      ["echo__say", "echo__status"],
    );
  } finally {
    await client.close().catch(() => undefined);
    await legacyClient.close().catch(() => undefined);
    await gateway.stop().catch(() => undefined);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/ping`));
    await rm(dir, { recursive: true, force: true });
  }
});

async function postInitialize(
  port: number,
  headers: Record<string, string>,
): Promise<number> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "security-test", version: "1" },
    },
  });

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

async function unusedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to reserve a TCP port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}
