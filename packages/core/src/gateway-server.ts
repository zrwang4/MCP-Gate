import { createServer, type Server as HttpServer } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  Server,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/server";
import type { CoreConfig } from "./config.ts";
import type { CoreLogger } from "./logger.ts";
import type { ToolRegistry } from "./tool-registry.ts";
import type { UpstreamManager } from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

export type GatewayRuntimeStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export interface GatewaySnapshot {
  endpoint: string;
  healthEndpoint: string;
  status: GatewayRuntimeStatus;
  toolCount: number;
  lastError: string | null;
}

export class GatewayServer {
  #config: CoreConfig;
  #tools: ToolRegistry;
  #upstreams: UpstreamManager;
  #logger: CoreLogger;
  #httpServer: HttpServer | null = null;
  #handler: ReturnType<typeof createMcpHandler> | null = null;
  #status: GatewayRuntimeStatus = "stopped";
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

  snapshot(): GatewaySnapshot {
    return {
      endpoint: `http://${this.#config.host}:${this.#config.port}/mcp`,
      healthEndpoint: `http://${this.#config.host}:${this.#config.port}/ping`,
      status: this.#status,
      toolCount: this.#tools.list().length,
      lastError: this.#lastError,
    };
  }

  async start(): Promise<void> {
    if (this.#httpServer || this.#status === "starting" || this.#status === "running") {
      return;
    }

    this.#status = "starting";
    this.#lastError = null;

    const handler = createMcpHandler(
      () => this.#createProtocolServer(),
      {
        onerror: (error) => {
          this.#logger.error("gateway", error.message);
        },
      },
    );

    const nodeHandler = toNodeHandler(handler);
    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();

    const httpServer = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/ping") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({
          ok: this.#status === "running",
          status: this.#status,
          tools: this.#tools.list().length,
        }));
        return;
      }

      if (url.pathname !== "/mcp") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      if (!validateHost(req, res) || !validateOrigin(req, res)) return;

      void Promise.resolve(nodeHandler(req, res)).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.#logger.error("gateway", message);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "gateway request failed" }));
        } else {
          res.end();
        }
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(this.#config.port, this.#config.host, () => {
          httpServer.off("error", reject);
          resolve();
        });
      });

      this.#handler = handler;
      this.#httpServer = httpServer;
      this.#status = "running";
      this.#logger.info(
        "gateway",
        `listening on http://${this.#config.host}:${this.#config.port}/mcp`,
      );
    } catch (error) {
      await handler.close().catch(() => undefined);
      this.#status = "error";
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#logger.error("gateway", `failed to start: ${this.#lastError}`);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.#httpServer && !this.#handler) {
      if (this.#status !== "error") this.#status = "stopped";
      return;
    }

    this.#status = "stopping";
    const server = this.#httpServer;
    const handler = this.#handler;
    this.#httpServer = null;
    this.#handler = null;

    await handler?.close().catch((error) => {
      this.#logger.warn("gateway", `handler close failed: ${String(error)}`);
    });

    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    this.#status = "stopped";
    this.#logger.info("gateway", "stopped");
  }

  #createProtocolServer(): Server {
    const server = new Server(
      {
        name: "mcp-gate",
        version: CORE_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    server.setRequestHandler("tools/list", async () => ({
      tools: this.#tools.list().map((route) => ({
        name: route.publicName,
        description: route.definition.description,
        inputSchema: normalizeInputSchema(route.definition.inputSchema),
      })),
    }));

    server.setRequestHandler("tools/call", async (request): Promise<CallToolResult> => {
      try {
        return await this.#upstreams.callTool(
          request.params.name,
          request.params.arguments ?? {},
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#logger.warn("gateway", `tool ${request.params.name} failed: ${message}`);
        return {
          content: [
            {
              type: "text",
              text: message,
            },
          ],
          isError: true,
        };
      }
    });

    return server;
  }
}

function normalizeInputSchema(value: unknown): Tool["inputSchema"] {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "object"
  ) {
    return value as Tool["inputSchema"];
  }

  return {
    type: "object",
    properties: {},
  };
}
