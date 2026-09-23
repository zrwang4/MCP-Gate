import { type IncomingMessage } from "node:http";
import { hostname, networkInterfaces } from "node:os";
import {
  fromJsonSchema,
  McpServer,
  type CallToolResult,
  type RegisteredTool,
} from "@modelcontextprotocol/server";
import type { CoreConfig } from "./config.ts";
import type { GatewayAccessController } from "./gateway-access.ts";
import type { CoreLogger } from "./logger.ts";
import { McpProxyGateway } from "./mcp-proxy-gateway.ts";
import type { ToolRegistry, ToolRoute } from "./tool-registry.ts";
import type { UpstreamManager } from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

export interface GatewayToolCaller {
  callTool(publicName: string, args: unknown): Promise<CallToolResult>;
}

const gatewayToolRegistrations = new WeakMap<
  McpServer,
  Map<string, RegisteredTool>
>();

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

  gatewayToolRegistrations.set(server, new Map());
  syncGatewayTools(server, tools, caller);

  return server;
}

function syncGatewayTools(
  server: McpServer,
  tools: ToolRegistry,
  caller: GatewayToolCaller,
): void {
  const registrations = gatewayToolRegistrations.get(server) ?? new Map();
  for (const registration of registrations.values()) registration.remove();
  registrations.clear();

  for (const route of tools.list()) {
    registrations.set(route.publicName, registerTool(server, route, caller));
  }

  gatewayToolRegistrations.set(server, registrations);
}

export class GatewayServer {
  #config: CoreConfig;
  #tools: ToolRegistry;
  #upstreams: UpstreamManager;
  #access: GatewayAccessController;
  #logger: CoreLogger;
  #proxy = new McpProxyGateway();
  #protocolServers = new Set<McpServer>();
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
    if (this.#status === "running") return;
    this.#status = "starting";
    this.#lastError = null;

    const access = this.#access.snapshot();
    const lanEnabled =
      access.lanEnabled && access.enabled && access.ready;
    const bindHost = lanEnabled ? "0.0.0.0" : this.#config.host;
    const allowedHostnames = lanEnabled
      ? discoverAllowedGatewayHostnames()
      : [];
    try {
      await this.#proxy.start({
        host: bindHost,
        port: this.#config.port,
        sessionIdleTimeoutMs: this.#config.sessionIdleTimeoutMs,
        createServer: async () => {
          const server = this.#buildMcpServer();
          this.#protocolServers.add(server);
          return server;
        },
        authenticate: async (req) =>
          this.#authorizeRequest(req, lanEnabled, allowedHostnames),
        onConnect: async (server) => {
          this.#protocolServers.add(server);
        },
        onClose: async (server) => {
          this.#protocolServers.delete(server);
        },
        onUnhandledRequest: async (req, res) => {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "not found" }));
        },
        isOriginAllowed: (origin) =>
          isAllowedOrigin(origin, lanEnabled, allowedHostnames),
      });

      this.#boundHost = bindHost;
      this.#unsubscribeToolChanges = this.#tools.onChanged(() => {
        for (const server of this.#protocolServers) {
          syncGatewayTools(server, this.#tools, this.#upstreams);
        }
        this.#proxy.notifyToolsChanged();
      });
      this.#status = "running";
      this.#logger.info(
        "gateway",
        `listening on ${bindHost}:${this.#config.port}/mcp${lanEnabled ? `; allowed hosts=${allowedHostnames.join(",")}` : ""}`,
      );
    } catch (error) {
      this.#status = "error";
      this.#lastError = error instanceof Error ? error.message : String(error);
      await this.#proxy.stop().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#status !== "stopped") this.#status = "stopping";

    const unsubscribeToolChanges = this.#unsubscribeToolChanges;
    this.#unsubscribeToolChanges = null;
    unsubscribeToolChanges?.();

    this.#boundHost = null;
    this.#protocolServers.clear();
    await this.#proxy.stop();

    this.#status = "stopped";
    this.#lastError = null;
  }

  #authorizeRequest(
    req: IncomingMessage,
    lanEnabled: boolean,
    allowedHostnames: string[],
  ): { authenticated: true } {
    const host = hostFromHeader(req.headers.host);
    const permittedHosts = lanEnabled
      ? [...allowedHostnames, "localhost", "127.0.0.1", "[::1]"]
      : ["localhost", "127.0.0.1", "[::1]"];

    if (!host || !permittedHosts.includes(host)) {
      throw new Response(JSON.stringify({ error: "host not allowed" }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, lanEnabled, allowedHostnames)) {
      throw new Response(JSON.stringify({ error: "origin not allowed" }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    const access = this.#access.authorize(req.headers.authorization);
    if (!access.allowed) {
      throw new Response(JSON.stringify({ error: access.error }), {
        status: access.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...(access.status === 401
            ? { "WWW-Authenticate": 'Bearer realm="MCP Gate"' }
            : {}),
        },
      });
    }

    return { authenticated: true };
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
): RegisteredTool {
  return server.registerTool(
    route.publicName,
    {
      description: route.definition.description,
      inputSchema: schemaFromRoute(route),
    },
    async (args) => caller.callTool(route.publicName, args),
  );
}

function hostFromHeader(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedOrigin(
  value: string,
  lanEnabled: boolean,
  allowedHostnames: string[],
): boolean {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return false;
  }

  const host = origin.hostname.toLowerCase();
  if (
    (origin.protocol === "tauri:" && host === "localhost") ||
    ["localhost", "127.0.0.1", "[::1]", "tauri.localhost"].includes(host)
  ) {
    return true;
  }

  return lanEnabled && allowedHostnames.includes(host);
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
