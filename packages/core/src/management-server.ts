import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CoreConfig } from "./config.ts";
import type { CoreLogger, LogLevel } from "./logger.ts";
import type { GatewayServer } from "./gateway-server.ts";
import type { HttpServerConfig, McpServerConfig, ServerRegistry } from "./server-registry.ts";
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-MCP-Gate-Client");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  return true;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function requireDesktopClient(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.headers["x-mcp-gate-client"] !== "desktop") {
    json(res, 403, { error: "missing desktop client header" });
    return false;
  }
  return true;
}

export class ManagementServer {
  #config: CoreConfig;
  #gateway: GatewayServer;
  #registry: ServerRegistry;
  #upstreams: UpstreamManager;
  #tools: ToolRegistry;
  #toolPolicy: ToolPolicyStore;
  #secrets: SecretStore;
  #logger: CoreLogger;
  #server: ReturnType<typeof createServer> | null = null;
  #startedAt = new Date().toISOString();

  constructor(
    config: CoreConfig,
    gateway: GatewayServer,
    registry: ServerRegistry,
    upstreams: UpstreamManager,
    tools: ToolRegistry,
    toolPolicy: ToolPolicyStore,
    secrets: SecretStore,
    logger: CoreLogger,
  ) {
    this.#config = config;
    this.#gateway = gateway;
    this.#registry = registry;
    this.#upstreams = upstreams;
    this.#tools = tools;
    this.#toolPolicy = toolPolicy;
    this.#secrets = secrets;
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

    if (req.method === "GET" && url.pathname === "/api/status") {
      const gateway = this.#gateway.snapshot();
      json(res, 200, {
        core: {
          version: CORE_VERSION,
          startedAt: this.#startedAt,
          logFile: this.#logger.filePath,
        },
        gateway,
        management: {
          endpoint: `http://${this.#config.managementHost}:${this.#config.managementPort}`,
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/servers") {
      json(res, 200, { servers: [] });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/server-configs") {
      json(res, 200, {
        servers: this.#registry.list().map(toPublicServerConfig),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/upstreams") {
      json(res, 200, { upstreams: this.#upstreams.list() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tools") {
      json(res, 200, { tools: this.#tools.list({ includeDisabled: true }) });
      return;
    }

    const toolCallMatch = url.pathname.match(
      /^\/api\/tools\/([A-Za-z0-9_-]+)\/call$/,
    );
    if (req.method === "POST" && toolCallMatch) {
      if (!requireDesktopClient(req, res)) return;

      const [, publicName] = toolCallMatch;
      try {
        const body = await readJsonBody(req) as { arguments?: unknown };
        const args = body.arguments ?? {};
        if (!args || typeof args !== "object" || Array.isArray(args)) {
          json(res, 400, { error: "arguments must be a JSON object" });
          return;
        }

        const result = await this.#upstreams.callTool(publicName, args);
        this.#logger.info("tools", `test call completed: ${publicName}`);
        json(res, 200, { result });
      } catch (error) {
        this.#logger.warn(
          "tools",
          `test call failed: ${publicName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const toolActionMatch = url.pathname.match(
      /^\/api\/tools\/([A-Za-z0-9_-]+)\/(enable|disable)$/,
    );
    if (req.method === "POST" && toolActionMatch) {
      if (!requireDesktopClient(req, res)) return;

      const [, publicName, action] = toolActionMatch;
      const tool = this.#tools.resolve(publicName);
      if (!tool) {
        json(res, 404, { error: "tool not found" });
        return;
      }

      const enabled = action === "enable";
      await this.#toolPolicy.setEnabled(
        tool.serverId,
        tool.originalName,
        enabled,
      );
      const changed = this.#tools.setEnabled(publicName, enabled);
      if (!changed) {
        json(res, 404, { error: "tool not found" });
        return;
      }

      const updatedTool = this.#tools.resolve(publicName);
      this.#logger.info(
        "tools",
        `${action === "enable" ? "enabled" : "disabled"} ${publicName}`,
      );
      json(res, 200, { tool: updatedTool });
      return;
    }


    const upstreamActionMatch = url.pathname.match(
      /^\/api\/upstreams\/([0-9a-f-]+)\/(connect|disconnect|refresh-tools)$/i,
    );
    if (req.method === "POST" && upstreamActionMatch) {
      if (!requireDesktopClient(req, res)) return;
      const [, upstreamId, action] = upstreamActionMatch;

      try {
        const upstream =
          action === "connect"
            ? await this.#upstreams.connect(upstreamId)
            : action === "disconnect"
              ? await this.#upstreams.disconnect(upstreamId)
              : await this.#upstreams.refreshTools(upstreamId);

        json(res, 200, { upstream });
      } catch (error) {
        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }


    if (req.method === "POST" && url.pathname === "/api/server-configs") {
      if (!requireDesktopClient(req, res)) return;

      let createdSecretId: string | null = null;
      try {
        const body = await readJsonBody(req) as {
          name?: unknown;
          transport?: unknown;
          command?: unknown;
          args?: unknown;
          cwd?: unknown;
          url?: unknown;
          authorization?: unknown;
        };

        const transport = body.transport === "http" ? "http" : "stdio";
        const authorization = normalizeOptionalAuthorization(body.authorization);

        if (transport === "http" && authorization) {
          createdSecretId = `http-auth:${randomUUID()}`;
          await this.#secrets.set(createdSecretId, authorization);
        }

        const server = await this.#registry.create({
          name: body.name as string,
          transport,
          command: typeof body.command === "string" ? body.command : undefined,
          args: Array.isArray(body.args) ? body.args as string[] : [],
          cwd: typeof body.cwd === "string" ? body.cwd : undefined,
          url: typeof body.url === "string" ? body.url : undefined,
          authSecretId: createdSecretId ?? undefined,
        });
        this.#upstreams.syncConfigs();
        json(res, 201, { server: toPublicServerConfig(server) });
      } catch (error) {
        if (createdSecretId) {
          await this.#secrets.delete(createdSecretId).catch(() => false);
        }
        json(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const configEditMatch = url.pathname.match(
      /^\/api\/server-configs\/([0-9a-f-]+)$/i,
    );
    if (req.method === "POST" && configEditMatch) {
      if (!requireDesktopClient(req, res)) return;

      const serverId = configEditMatch[1];
      const existing = this.#registry.get(serverId);
      if (!existing) {
        json(res, 404, { error: "server configuration not found" });
        return;
      }

      let createdSecretId: string | null = null;
      let secretToDeleteAfterSuccess: string | null =
        existing.transport === "http" ? existing.authSecretId ?? null : null;

      try {
        const body = await readJsonBody(req) as {
          name?: unknown;
          transport?: unknown;
          command?: unknown;
          args?: unknown;
          cwd?: unknown;
          url?: unknown;
          authorization?: unknown;
          clearAuthorization?: unknown;
        };

        await this.#upstreams.disconnect(serverId).catch(() => undefined);

        const transport =
          body.transport === "http"
            ? "http"
            : body.transport === "stdio"
              ? "stdio"
              : existing.transport;

        const authorization = normalizeOptionalAuthorization(body.authorization);
        const clearAuthorization = body.clearAuthorization === true;

        let authSecretId: string | null | undefined;

        if (transport === "http") {
          if (authorization) {
            createdSecretId = `http-auth:${randomUUID()}`;
            await this.#secrets.set(createdSecretId, authorization);
            authSecretId = createdSecretId;
          } else if (clearAuthorization) {
            authSecretId = null;
          } else if (existing.transport === "http") {
            authSecretId = existing.authSecretId;
            secretToDeleteAfterSuccess = null;
          }
        } else {
          authSecretId = null;
        }

        const updated = await this.#registry.update(serverId, {
          name: body.name as string,
          transport,
          command: typeof body.command === "string" ? body.command : undefined,
          args: Array.isArray(body.args) ? body.args as string[] : [],
          cwd: typeof body.cwd === "string" ? body.cwd : undefined,
          url: typeof body.url === "string" ? body.url : undefined,
          authSecretId,
        });

        if (!updated) {
          throw new Error("server configuration not found");
        }

        if (
          secretToDeleteAfterSuccess &&
          secretToDeleteAfterSuccess !== createdSecretId
        ) {
          await this.#secrets
            .delete(secretToDeleteAfterSuccess)
            .catch(() => false);
        }

        this.#upstreams.syncConfigs();
        json(res, 200, { server: toPublicServerConfig(updated) });
      } catch (error) {
        if (createdSecretId) {
          await this.#secrets.delete(createdSecretId).catch(() => false);
        }
        json(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const configSettingsMatch = url.pathname.match(
      /^\/api\/server-configs\/([0-9a-f-]+)\/settings$/i,
    );
    if (req.method === "POST" && configSettingsMatch) {
      if (!requireDesktopClient(req, res)) return;

      try {
        const body = await readJsonBody(req) as {
          enabled?: unknown;
          autoStart?: unknown;
        };

        const updated = await this.#registry.updateSettings(
          configSettingsMatch[1],
          {
            enabled:
              body.enabled === undefined
                ? undefined
                : body.enabled as boolean,
            autoStart:
              body.autoStart === undefined
                ? undefined
                : body.autoStart as boolean,
          },
        );

        if (!updated) {
          json(res, 404, { error: "server configuration not found" });
          return;
        }

        this.#upstreams.syncConfigs();

        if (!updated.enabled) {
          await this.#upstreams
            .disconnect(updated.id)
            .catch(() => undefined);
        }

        json(res, 200, { server: toPublicServerConfig(updated) });
      } catch (error) {
        json(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const configDeleteMatch = url.pathname.match(/^\/api\/server-configs\/([0-9a-f-]+)$/i);
    if (req.method === "DELETE" && configDeleteMatch) {
      if (!requireDesktopClient(req, res)) return;
      const serverId = configDeleteMatch[1];
      const existing = this.#registry.get(serverId);
      await this.#upstreams.disconnect(serverId).catch(() => undefined);
      const removed = await this.#registry.remove(serverId);
      await this.#toolPolicy.removeServer(serverId);
      this.#upstreams.syncConfigs();
      if (!removed) {
        json(res, 404, { error: "server configuration not found" });
        return;
      }

      if (existing?.transport === "http" && existing.authSecretId) {
        await this.#secrets.delete(existing.authSecretId).catch(() => false);
      }

      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      const after = Number(url.searchParams.get("after") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "200");
      const rawLevel = url.searchParams.get("level") as LogLevel | null;
      const level = rawLevel && ["debug", "info", "warn", "error"].includes(rawLevel)
        ? rawLevel
        : undefined;
      json(res, 200, {
        entries: this.#logger.list({
          after: Number.isFinite(after) ? after : 0,
          limit: Number.isFinite(limit) ? limit : 200,
          level,
        }),
      });
      return;
    }

    json(res, 404, { error: "not found" });
  }
}

function normalizeOptionalAuthorization(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("authorization must be a string");
  }

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 8192) {
    throw new Error("authorization is too long");
  }
  return trimmed;
}

function toPublicServerConfig(server: McpServerConfig): Record<string, unknown> {
  if (server.transport !== "http") {
    return { ...server };
  }

  const { authSecretId, ...publicConfig } = server as HttpServerConfig;
  return {
    ...publicConfig,
    hasAuthorization: Boolean(authSecretId),
  };
}
