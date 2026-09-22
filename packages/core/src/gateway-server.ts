import { createServer, type Server as HttpServer } from "node:http";
import { hostname, networkInterfaces } from "node:os";
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import type { CoreConfig } from "./config.ts";
import type { GatewayAccessController } from "./gateway-access.ts";
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
  #access: GatewayAccessController;
  #logger: CoreLogger;
  #server: HttpServer | null = null;
  #handler: ReturnType<typeof createMcpHandler> | null = null;
  #unsubscribeToolChanges: (() => void) | null = null;
  #status: "starting" | "running" | "stopping" | "stopped" | "error" = "stopped";
  #lastError: string | null = null;
  #boundHost: string | null = null;

  constructor(
    config: CoreConfig,
    tools: ToolRegistry,
    upstreams: UpstreamManager,
    access: GatewayAccessController,
    logger: CoreLogger,
  ) {
    this.#config = config;
    this.#tools = tools;
    this.#upstreams = upstreams;
    this.#access = access;
    this.#logger = logger;
  }

  snapshot() {
    const access = this.#access.snapshot();
    const lanEnabled = this.#boundHost === "0.0.0.0";

    return {
      endpoint: `http://${this.#config.host}:${this.#config.port}/mcp`,
      healthEndpoint: `http://${this.#config.host}:${this.#config.port}/ping`,
      status: this.#status,
      toolCount: this.#tools.list().length,
      lastError: this.#lastError,
      authRequired: access.enabled,
      authReady: access.ready,
      authError: access.lastError,
      lanEnabled,
      lanEndpoints: lanEnabled
        ? discoverLanIPv4Addresses().map(
            (address) => `http://${address}:${this.#config.port}/mcp`,
          )
        : [],
    };
  }

  async start(): Promise<void> {
    if (this.#server) return;
    this.#status = "starting";
    this.#lastError = null;

    const handler = createMcpHandler(() => this.#buildMcpServer());
    const nodeHandler = toNodeHandler(handler);
    const access = this.#access.snapshot();
    const lanEnabled =
      access.lanEnabled && access.enabled && access.ready;
    const bindHost = lanEnabled ? "0.0.0.0" : this.#config.host;
    const allowedHostnames = lanEnabled
      ? discoverAllowedGatewayHostnames()
      : [];
    const validateHost = lanEnabled
      ? hostHeaderValidation(allowedHostnames)
      : localhostHostValidation();
    const validateOrigin = lanEnabled
      ? originValidation(allowedHostnames)
      : localhostOriginValidation();

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

      const access = this.#access.authorize(req.headers.authorization);
      if (!access.allowed) {
        res.statusCode = access.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        if (access.status === 401) {
          res.setHeader("WWW-Authenticate", 'Bearer realm="MCP Gate"');
        }
        res.end(JSON.stringify({ error: access.error }));
        return;
      }

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
        server.listen(this.#config.port, bindHost, () => {
          server.off("error", reject);
          resolve();
        });
      });

      this.#server = server;
      this.#handler = handler;
      this.#boundHost = bindHost;
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
        `listening on ${bindHost}:${this.#config.port}/mcp${lanEnabled ? `; allowed hosts=${allowedHostnames.join(",")}` : ""}`,
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
    this.#boundHost = null;

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


export function discoverLanIPv4Addresses(): string[] {
  const addresses = new Set<string>();

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        entry.address !== "0.0.0.0"
      ) {
        addresses.add(entry.address);
      }
    }
  }

  return [...addresses].sort();
}

export function discoverAllowedGatewayHostnames(): string[] {
  const allowed = new Set<string>([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "0.0.0.0",
  ]);

  const machine = hostname().trim().toLowerCase();
  if (machine) {
    allowed.add(machine);
    if (!machine.endsWith(".local")) {
      allowed.add(`${machine}.local`);
    }
  }

  for (const address of discoverLanIPv4Addresses()) {
    allowed.add(address);
  }

  return [...allowed].sort();
}
