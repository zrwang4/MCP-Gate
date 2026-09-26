import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AuditLogger } from "./audit-logger.ts";
import type { CoreConfig } from "./config.ts";
import type { CoreLogger } from "./logger.ts";
import {
  isManagementRequestAuthorized,
  MANAGEMENT_TOKEN_HEADER,
} from "./management-auth.ts";
import {
  json,
  type ManagementContext,
  type RouteHandler,
} from "./management-context.ts";
import { handleGatewayAccess } from "./management-route-gateway-access.ts";
import { handleDiagnostics } from "./management-route-diagnostics.ts";
import { handleProfiles } from "./management-route-profiles.ts";
import { handleImport } from "./management-route-import.ts";
import { handleServers } from "./management-route-servers.ts";
import { handleTools } from "./management-route-tools.ts";
import { handleLogs } from "./management-route-logs.ts";
import type { GatewayAccessController } from "./gateway-access.ts";
import type { GatewayServer } from "./gateway-server.ts";
import type { ServerRegistry } from "./server-registry.ts";
import type { ProfileStore } from "./profile-store.ts";
import type { SecretStore } from "./secret-store.ts";
import type { ToolPolicyStore } from "./tool-policy-store.ts";
import type { ToolRegistry } from "./tool-registry.ts";
import type { UpstreamManager } from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

function setCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.has(origin)) return false;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-MCP-Gate-Client, X-MCP-Gate-Token",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  return true;
}

const ROUTES: RouteHandler[] = [
  handleGatewayAccess,
  handleDiagnostics,
  handleProfiles,
  handleImport,
  handleServers,
  handleTools,
  handleLogs,
];

export class ManagementServer {
  #config: CoreConfig;
  #gateway: GatewayServer;
  #gatewayAccess: GatewayAccessController;
  #registry: ServerRegistry;
  #profiles: ProfileStore;
  #upstreams: UpstreamManager;
  #tools: ToolRegistry;
  #toolPolicy: ToolPolicyStore;
  #secrets: SecretStore;
  #audit: AuditLogger;
  #logger: CoreLogger;
  #server: ReturnType<typeof createServer> | null = null;
  #startedAt = new Date().toISOString();

  constructor(
    config: CoreConfig,
    gateway: GatewayServer,
    gatewayAccess: GatewayAccessController,
    registry: ServerRegistry,
    profiles: ProfileStore,
    upstreams: UpstreamManager,
    tools: ToolRegistry,
    toolPolicy: ToolPolicyStore,
    secrets: SecretStore,
    audit: AuditLogger,
    logger: CoreLogger,
  ) {
    this.#config = config;
    this.#gateway = gateway;
    this.#gatewayAccess = gatewayAccess;
    this.#registry = registry;
    this.#profiles = profiles;
    this.#upstreams = upstreams;
    this.#tools = tools;
    this.#toolPolicy = toolPolicy;
    this.#secrets = secrets;
    this.#audit = audit;
    this.#logger = logger;
  }

  async start(): Promise<void> {
    if (this.#server) return;

    const server = createServer((req, res) => {
      void this.#handle(req, res).catch((error) => {
        this.#logger.error("management", error instanceof Error ? error.message : String(error));
        if (!res.headersSent) json(res, 500, { error: "internal error" });
        else res.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.#config.managementPort, this.#config.managementHost, () => {
        server.off("error", reject);
        resolve();
      });
    });

    this.#server = server;
    this.#logger.info(
      "management",
      `API listening on http://${this.#config.managementHost}:${this.#config.managementPort}`,
    );
  }

  async stop(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    this.#server = null;
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!setCors(req, res)) {
      json(res, 403, { error: "origin not allowed" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (!isManagementRequestAuthorized(req.headers, this.#config.managementToken)) {
      this.#logger.warn(
        "management",
        `management access denied: ${req.method ?? "UNKNOWN"} ${url.pathname}`,
      );
      json(res, 403, {
        error: this.#config.managementToken
          ? `missing or invalid ${MANAGEMENT_TOKEN_HEADER}`
          : "missing desktop client header",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      json(res, 200, {
        core: {
          version: CORE_VERSION,
          startedAt: this.#startedAt,
          logFile: this.#logger.filePath,
        },
        gateway: this.#gateway.snapshot(),
        management: {
          endpoint: `http://${this.#config.managementHost}:${this.#config.managementPort}`,
        },
      });
      return;
    }

    const ctx: ManagementContext = {
      config: this.#config,
      gateway: this.#gateway,
      gatewayAccess: this.#gatewayAccess,
      registry: this.#registry,
      profiles: this.#profiles,
      upstreams: this.#upstreams,
      tools: this.#tools,
      toolPolicy: this.#toolPolicy,
      secrets: this.#secrets,
      audit: this.#audit,
      logger: this.#logger,
      startedAt: this.#startedAt,
    };

    for (const route of ROUTES) {
      if (await route(req, res, url, ctx)) return;
    }

    json(res, 404, { error: "not found" });
  }
}
