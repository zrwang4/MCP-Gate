import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { HttpServerConfig } from "./server-registry.ts";
import type { SecretStore } from "./secret-store.ts";
import type { McpToolDefinition } from "./tool-registry.ts";
import type {
  UpstreamClient,
  UpstreamLifecycleHandlers,
} from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

export class HttpUpstreamClient implements UpstreamClient {
  #config: HttpServerConfig;
  #client: Client | null = null;
  #transport: StreamableHTTPClientTransport | null = null;
  #secrets: SecretStore;
  #lifecycleHandlers: UpstreamLifecycleHandlers = {};

  constructor(config: HttpServerConfig, secrets: SecretStore) {
    this.#config = config;
    this.#secrets = secrets;
  }

  setLifecycleHandlers(handlers: UpstreamLifecycleHandlers): void {
    this.#lifecycleHandlers = handlers;
    if (this.#client) this.#bindLifecycle(this.#client);
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
    this.#bindLifecycle(client);

    const authorization = this.#config.authSecretId
      ? await this.#secrets.get(this.#config.authSecretId)
      : null;

    if (this.#config.authSecretId && !authorization) {
      throw new Error("HTTP authorization secret is missing from Keychain");
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(this.#config.url),
      authorization
        ? {
            requestInit: {
              headers: {
                Authorization: authorization,
              },
            },
          }
        : undefined,
    );

    this.#client = client;
    this.#transport = transport;

    try {
      await client.connect(transport);
    } catch (error) {
      this.#client = null;
      this.#transport = null;
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => transport.close().catch(() => undefined));
      throw error;
    }
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

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
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

  #bindLifecycle(client: Client): void {
    client.onclose = () => {
      this.#lifecycleHandlers.onClose?.();
    };
    client.onerror = (error) => {
      this.#lifecycleHandlers.onError?.(error);
    };
  }

  #requireClient(): Client {
    if (!this.#client) throw new Error("HTTP upstream is not connected");
    return this.#client;
  }
}
