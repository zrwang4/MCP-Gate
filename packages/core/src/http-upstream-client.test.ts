import assert from "node:assert/strict";
import test from "node:test";
import {
  HttpAgentPool,
  HttpUpstreamClient,
  isRoutineSseRecycleError,
} from "./http-upstream-client.ts";

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("condition not met within " + timeoutMs + "ms");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("HTTP Agent pool reuses agents while leases are active and evicts idle agents", async () => {
  const pool = new HttpAgentPool();

  const first = pool.acquire(10_000);
  const second = pool.acquire(10_000);
  assert.strictEqual(first.agent, second.agent);

  const shared = first.agent;
  await first.release();

  const third = pool.acquire(10_000);
  // `second` still holds a lease, so the shared agent must be reused.
  assert.strictEqual(third.agent, shared);

  await second.release();
  await third.release();

  const fourth = pool.acquire(10_000);
  // Every lease was released, so the idle agent must have been evicted.
  assert.notStrictEqual(fourth.agent, shared);

  await fourth.release();
});

test("HTTP Agent pool keeps different timeout values isolated", async () => {
  const pool = new HttpAgentPool();

  const short = pool.acquire(5_000);
  const long = pool.acquire(60_000);

  assert.notStrictEqual(short.agent, long.agent);

  await short.release();
  await long.release();
});


test("HTTP adapter classifies routine SSE recycle errors", () => {
  assert.equal(
    isRoutineSseRecycleError(new Error("SSE stream disconnected: idle notification stream recycled")),
    true,
  );
  assert.equal(
    isRoutineSseRecycleError(new Error("Failed to reconnect SSE stream")),
    false,
  );
  assert.equal(
    isRoutineSseRecycleError(new Error("pipe closed")),
    false,
  );
});


test("HTTP upstream client connects to a real local MCP server and survives SSE recycle", async () => {
  const { createServer } = await import("node:http");
  const { randomUUID } = await import("node:crypto");
  const { McpServer } = await import("@modelcontextprotocol/server");
  const { NodeStreamableHTTPServerTransport } = await import("@modelcontextprotocol/node");
  const { z } = await import("zod");

  const server = new McpServer({
    name: "local-http-test-server",
    version: "1.0.0",
  });
  server.registerTool(
    "ping",
    {
      description: "Ping",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text" as const, text: "pong" }],
    }),
  );

  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  let headerObserved = false;
  const httpServer = createServer((req, res) => {
    if (req.headers["x-test-header"] === "mcp-gate") {
      headerObserved = true;
    }
    void transport.handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  let getRequests = 0;
  httpServer.prependListener("request", (req) => {
    if (req.method === "GET") getRequests += 1;
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start local MCP server");
  }

  const config = {
    id: randomUUID(),
    name: "Local HTTP",
    alias: "local-http",
    transport: "http" as const,
    url: `http://127.0.0.1:${address.port}/mcp`,
    headers: { "X-Test-Header": "mcp-gate" },
    enabled: true,
    autoStart: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const secrets = {
    async get() {
      return null;
    },
    async set() {},
    async delete() {
      return true;
    },
  } as never;

  const client = new HttpUpstreamClient(config, secrets, 5_000);
  let recycled = 0;
  client.setLifecycleHandlers({
    onNotificationStreamRecycled: () => {
      recycled += 1;
    },
  });

  try {
    await client.connect();

    assert.deepEqual(
      (await client.listTools()).map((tool) => tool.name),
      ["ping"],
    );

    const result = await client.callTool("ping", {});
    assert.equal(result.content[0]?.type, "text");
    if (result.content[0]?.type === "text") {
      assert.equal(result.content[0].text, "pong");
    }

    assert.ok(getRequests >= 1, "expected the client to establish an SSE GET");
    assert.equal(headerObserved, true, "expected configured headers on HTTP requests");

    transport.closeStandaloneSSEStream();

    await waitFor(
      () => getRequests >= 2,
      5_000,
    );

    assert.ok(recycled >= 0);

    assert.deepEqual(
      (await client.listTools()).map((tool) => tool.name),
      ["ping"],
    );
  } finally {
    await client.disconnect().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }
});
