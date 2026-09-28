import { Agent, setGlobalDispatcher } from "undici";
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

/** Header names are case-insensitive, so per-key lookups must be too. */
function hasHeaderKey(headers: Record<string, string>, key: string): boolean {
  const needle = key.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === needle);
}

export class HttpUpstreamClient implements UpstreamClient {
  #config: HttpServerConfig;
  #client: Client | null = null;
  #transport: StreamableHTTPClientTransport | null = null;
  #secrets: SecretStore;
  /** Connect timeout, in milliseconds. Node's built-in fetch hard-codes 10s. */
  #connectTimeoutMs: number;
  #lifecycleHandlers: UpstreamLifecycleHandlers = {};

  constructor(
    config: HttpServerConfig,
    secrets: SecretStore,
    connectTimeoutMs = 60_000,
  ) {
    this.#config = config;
    this.#secrets = secrets;
    this.#connectTimeoutMs = connectTimeoutMs;
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
        // 'legacy' is the SDK default and the plain initialize handshake every
        // MCP server supports. The 'auto' mode first probes with
        // `server/discover`, and a server that does not answer that (Apifox,
        // among others) makes the probe hang until the full request timeout,
        // so connecting would take a minute instead of milliseconds.
        versionNegotiation: {
          mode: "legacy",
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

    // A configured Authorization header wins over the stored secret, so a caller
    // can override it explicitly rather than having two values fight over one key.
    const headers: Record<string, string> = {
      ...(this.#config.headers ?? {}),
    };
    if (authorization && !hasHeaderKey(headers, "authorization")) {
      headers.Authorization = authorization;
    }

    // Node's built-in fetch hard-codes a 10s connect timeout that cannot be
    // changed per request — `requestInit.dispatcher` is silently rejected by
    // it. An Agent must be installed as the global dispatcher instead, so slow
    // remote endpoints get the headroom connectionTimeoutMs promises. Request
    // timeouts stay with the transport and are bounded separately.
    const requestInit: RequestInit = {};
    if (Object.keys(headers).length > 0) {
      requestInit.headers = headers;
    }
    setGlobalDispatcher(
      new Agent({ connect: { timeout: this.#connectTimeoutMs } }),
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(this.#config.url),
      { requestInit },
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
