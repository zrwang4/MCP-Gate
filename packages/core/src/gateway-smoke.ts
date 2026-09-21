import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const url =
  process.env.MCP_GATE_URL ??
  "http://127.0.0.1:24888/mcp";

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

  console.log(
    JSON.stringify(
      {
        ok: true,
        url,
        toolCount: result.tools.length,
        tools: result.tools.map((tool) => tool.name),
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
