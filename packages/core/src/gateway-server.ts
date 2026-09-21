import { createServer, type Server as HttpServer } from "node:http";
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import type { CoreConfig } from "./config.ts";
import type { CoreLogger } from "./logger.ts";
import type { ToolRegistry, ToolRoute } from "./tool-registry.ts";
import type { UpstreamManager } from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

export interface GatewayToolCaller {
  callTool(publicName: string, args: unknown): Promise<CallToolResult>;
}

export function createGatewayProtocolServer(
  tools: ToolRegistry,
  caller: GatewayToolCaller,
  _logger?: CoreLogger,
): McpServer {
  const server = new McpServer(
    {
      name: "mcp-gate",
      version: CORE_VERSION,
    },
    {
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
    },
  );

  for (const route of tools.list()) {
    registerTool(server, route, caller);
  }

  return server;
}

export class GatewayServer {
  #config: CoreConfig;
  #tools: ToolRegistry;
  #upstreams: UpstreamManager;
  #logger: CoreLogger;
  #server: HttpServer | null = null;
  #handler: ReturnType<typeof createMcpHandler> | null = null;
  #unsubscribeToolChanges: (() => void) | null = null;
  #status: "starting" | "running" | "stopping" | "stopped" | "error" = "stopped";
  #lastError: string | null = null;

  constructor(
    config: CoreConfig,
    tools: ToolRegistry,
    upstreams: UpstreamManager,
    logger: CoreLogger,
  ) {
    this.#config = config;
    this.#tools = tools;
    this.#upstreams = upstreams;
    this.#logger = logger;
  }

  snapshot() {
    return {
      endpoint: `http://${this.#config.host}:${this.#config.port}/mcp`,
      healthEndpoint: `http://${this.#config.host}:${this.#config.port}/ping`,
      status: this.#status,
      toolCount: this.#tools.list().length,
      lastError: this.#lastError,
    };
  }

  async start(): Promise<void> {
    if (this.#server) return;
    this.#status = "starting";
    this.#lastError = null;

    const handler = createMcpHandler(() => this.#buildMcpServer());
    const nodeHandler = toNodeHandler(handler);
    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (url.pathname === "/ping") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ ok: true, version: CORE_VERSION }));
        return;
      }

      if (url.pathname !== "/mcp") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      if (!validateHost(req, res) || !validateOrigin(req, res)) return;

      Promise.resolve(nodeHandler(req, res)).catch((error) => {
        this.#logger.error(
          "gateway",
          error instanceof Error ? error.message : String(error),
        );
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "gateway request failed" }));
        } else if (!res.writableEnded) {
          res.end();
        }
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.#config.port, this.#config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });

      this.#server = server;
      this.#handler = handler;
      this.#unsubscribeToolChanges = this.#tools.onChanged(() => {
        Promise.resolve(handler.notify.toolsChanged()).catch((error) => {
          this.#logger.warn(
            "gateway",
            `failed to publish tools/list_changed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      });
      this.#status = "running";
      this.#logger.info(
        "gateway",
        `listening on http://${this.#config.host}:${this.#config.port}/mcp`,
      );
    } catch (error) {
      this.#status = "error";
      this.#lastError = error instanceof Error ? error.message : String(error);
      await handler.close().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#status !== "stopped") this.#status = "stopping";

    const unsubscribeToolChanges = this.#unsubscribeToolChanges;
    this.#unsubscribeToolChanges = null;
    unsubscribeToolChanges?.();

    const server = this.#server;
    this.#server = null;

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    const handler = this.#handler;
    this.#handler = null;
    if (handler) {
      await handler.close().catch(() => undefined);
    }

    this.#status = "stopped";
    this.#lastError = null;
  }

  #buildMcpServer(): McpServer {
    return createGatewayProtocolServer(
      this.#tools,
      this.#upstreams,
      this.#logger,
    );
  }
}

function registerTool(
  server: McpServer,
  route: ToolRoute,
  caller: GatewayToolCaller,
): void {
  server.registerTool(
    route.publicName,
    {
      description: route.definition.description,
      inputSchema: schemaFromRoute(route),
    },
    async (args) => caller.callTool(route.publicName, args),
  );
}

function schemaFromRoute(route: ToolRoute) {
  const schema = route.definition.inputSchema;
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    try {
      return fromJsonSchema(schema as Record<string, unknown>);
    } catch {
      // Fall back to a permissive object when an upstream sends a malformed schema.
    }
  }

  return fromJsonSchema({
    type: "object",
    additionalProperties: true,
  });
}
