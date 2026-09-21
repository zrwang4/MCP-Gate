import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { StdioServerConfig } from "./server-registry.ts";
import type { McpToolDefinition } from "./tool-registry.ts";
import type {
  UpstreamClient,
  UpstreamLifecycleHandlers,
} from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

export class StdioUpstreamClient implements UpstreamClient {
  #config: StdioServerConfig;
  #client: Client | null = null;
  #transport: StdioClientTransport | null = null;
  #lifecycleHandlers: UpstreamLifecycleHandlers = {};

  constructor(config: StdioServerConfig) {
    this.#config = config;
  }

  setLifecycleHandlers(handlers: UpstreamLifecycleHandlers): void {
    this.#lifecycleHandlers = handlers;
    if (this.#client) this.#bindLifecycle(this.#client);
  }

  async connect(): Promise<void> {
    if (this.#client) return;

    const client = new Client({
      name: "mcp-gate",
      version: CORE_VERSION,
    });

    this.#bindLifecycle(client);

    const transport = new StdioClientTransport({
      command: this.#config.command,
      args: this.#config.args,
      cwd: this.#config.cwd,
    });

    await client.connect(transport);
    this.#client = client;
    this.#transport = transport;
  }

  async disconnect(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    this.#transport = null;
    if (client) {
      await client.close();
    }
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const client = this.#requireClient();
    const result = await client.listTools();

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    const client = this.#requireClient();

    if (
      args !== undefined &&
      args !== null &&
      (typeof args !== "object" || Array.isArray(args))
    ) {
      throw new Error("tool arguments must be an object");
    }

    return client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
  }

  #bindLifecycle(client: Client): void {
    client.onclose = () => {
      this.#lifecycleHandlers.onClose?.();
    };
    client.onerror = (error) => {
      this.#lifecycleHandlers.onError?.(error);
    };
  }

  #requireClient(): Client {
    if (!this.#client) throw new Error("stdio upstream is not connected");
    return this.#client;
  }
}
