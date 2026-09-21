import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type CallToolResult } from "@modelcontextprotocol/server";
import { createGatewayProtocolServer } from "./gateway-server.ts";
import { CoreLogger } from "./logger.ts";
import { ToolRegistry } from "./tool-registry.ts";

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

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

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
