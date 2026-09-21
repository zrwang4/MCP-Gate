import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { HttpServerConfig } from "./server-registry.ts";
import type { McpToolDefinition } from "./tool-registry.ts";
import type { UpstreamClient } from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

export class HttpUpstreamClient implements UpstreamClient {
  #config: HttpServerConfig;
  #client: Client | null = null;
  #transport: StreamableHTTPClientTransport | null = null;

  constructor(config: HttpServerConfig) {
    this.#config = config;
  }

  async connect(): Promise<void> {
    if (this.#client) return;

    const client = new Client(
      {
        name: "mcp-gate",
        version: CORE_VERSION,
      },
      {
        versionNegotiation: {
          mode: "auto",
        },
      },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(this.#config.url),
    );

    await client.connect(transport);
    this.#client = client;
    this.#transport = transport;
  }

  async disconnect(): Promise<void> {
    const client = this.#client;
    const transport = this.#transport;
    this.#client = null;
    this.#transport = null;

    if (transport) {
      await transport.terminateSession().catch(() => undefined);
    }
    if (client) {
      await client.close();
    }
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.#requireClient().listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: unknown) {
    if (
      args !== undefined &&
      args !== null &&
      (typeof args !== "object" || Array.isArray(args))
    ) {
      throw new Error("tool arguments must be an object");
    }

    return this.#requireClient().callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
  }

  #requireClient(): Client {
    if (!this.#client) throw new Error("HTTP upstream is not connected");
    return this.#client;
  }
}
