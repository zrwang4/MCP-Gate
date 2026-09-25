import {
  DEFAULT_ALLOWED_HEADERS,
  startHTTPServer,
  type SSEServer,
} from "mcp-proxy";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/server";

export interface McpProxyGatewayOptions {
  host: string;
  port: number;
  sessionIdleTimeoutMs: number;
  createServer(request: IncomingMessage): Promise<McpServer>;
  authenticate(request: IncomingMessage): Promise<unknown>;
  onConnect?(server: McpServer): Promise<void>;
  onClose?(server: McpServer): Promise<void>;
  onUnhandledRequest?(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void>;
  isOriginAllowed(origin: string): boolean;
}

/**
 * Owns the mcp-proxy HTTP/protocol runtime boundary. MCP Gate supplies the
 * product-specific MCP server factory, access policy, and tool aggregation.
 */
export class McpProxyGateway {
  #runtime: SSEServer | null = null;

  async start(options: McpProxyGatewayOptions): Promise<void> {
    if (this.#runtime) return;

    this.#runtime = await startHTTPServer({
      host: options.host,
      port: options.port,
      streamEndpoint: "/mcp",
      sseEndpoint: "/sse",
      modern: true,
      sessionIdleTimeout: options.sessionIdleTimeoutMs,
      authenticate: options.authenticate,
      createServer: options.createServer,
      onConnect: options.onConnect,
      onClose: options.onClose,
      onUnhandledRequest: options.onUnhandledRequest,
      cors: {
        origin: options.isOriginAllowed,
        allowedHeaders: DEFAULT_ALLOWED_HEADERS,
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
        exposedHeaders: ["Mcp-Session-Id"],
      },
    });
  }

  notifyToolsChanged(): void {
    this.#runtime?.notify.toolsChanged();
  }

  async stop(): Promise<void> {
    const runtime = this.#runtime;
    this.#runtime = null;
    if (runtime) await runtime.close();
  }
}
