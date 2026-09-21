import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const url =
  process.env.MCP_GATE_URL ??
  "http://127.0.0.1:24888/mcp";
const callToolName = process.env.MCP_GATE_SMOKE_TOOL?.trim() || null;
const rawArgs = process.env.MCP_GATE_SMOKE_ARGS ?? "{}";

const client = new Client(
  {
    name: "mcp-gate-http-smoke",
    version: "0.1.0",
  },
  {
    versionNegotiation: {
      mode: "auto",
    },
  },
);

try {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  const result = await client.listTools();

  let callResult: unknown = undefined;
  if (callToolName) {
    const args = JSON.parse(rawArgs) as unknown;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("MCP_GATE_SMOKE_ARGS must be a JSON object");
    }

    if (!result.tools.some((tool) => tool.name === callToolName)) {
      throw new Error(`tool not found in tools/list: ${callToolName}`);
    }

    callResult = await client.callTool({
      name: callToolName,
      arguments: args as Record<string, unknown>,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        url,
        toolCount: result.tools.length,
        tools: result.tools.map((tool) => tool.name),
        ...(callToolName ? { calledTool: callToolName, callResult } : {}),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        url,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
