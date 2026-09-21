import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CoreConfig } from "./config.ts";
import type { CoreLogger, LogLevel } from "./logger.ts";
import type { McpProxyProcess } from "./proxy-process.ts";
import type { ServerRegistry } from "./server-registry.ts";
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
  #proxy: McpProxyProcess;
  #registry: ServerRegistry;
  #upstreams: UpstreamManager;
  #tools: ToolRegistry;
  #logger: CoreLogger;
  #server: ReturnType<typeof createServer> | null = null;
  #startedAt = new Date().toISOString();
  #actionInFlight = false;

  constructor(
    config: CoreConfig,
    proxy: McpProxyProcess,
    registry: ServerRegistry,
    upstreams: UpstreamManager,
    tools: ToolRegistry,
    logger: CoreLogger,
  ) {
    this.#config = config;
    this.#proxy = proxy;
    this.#registry = registry;
    this.#upstreams = upstreams;
    this.#tools = tools;
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
      const server = this.#proxy.snapshot(this.#config);
      json(res, 200, {
        core: {
          version: CORE_VERSION,
          startedAt: this.#startedAt,
          logFile: this.#logger.filePath,
        },
        gateway: {
          endpoint: `http://${this.#config.host}:${this.#config.port}/mcp`,
          healthEndpoint: `http://${this.#config.host}:${this.#config.port}/ping`,
          status: server.status,
        },
        management: {
          endpoint: `http://${this.#config.managementHost}:${this.#config.managementPort}`,
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/servers") {
      json(res, 200, { servers: [this.#proxy.snapshot(this.#config)] });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/server-configs") {
      json(res, 200, { servers: this.#registry.list() });
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
      try {
        const body = await readJsonBody(req) as {
          name?: unknown;
          command?: unknown;
          args?: unknown;
          cwd?: unknown;
        };
        const server = await this.#registry.create({
          name: body.name as string,
          command: body.command as string,
          args: Array.isArray(body.args) ? body.args as string[] : [],
          cwd: typeof body.cwd === "string" ? body.cwd : undefined,
        });
        this.#upstreams.syncConfigs();
        json(res, 201, { server });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const configDeleteMatch = url.pathname.match(/^\/api\/server-configs\/([0-9a-f-]+)$/i);
    if (req.method === "DELETE" && configDeleteMatch) {
      if (!requireDesktopClient(req, res)) return;
      await this.#upstreams.disconnect(configDeleteMatch[1]).catch(() => undefined);
      const removed = await this.#registry.remove(configDeleteMatch[1]);
      this.#upstreams.syncConfigs();
      if (!removed) {
        json(res, 404, { error: "server configuration not found" });
        return;
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

    const actionMatch = url.pathname.match(/^\/api\/servers\/filesystem-poc\/(start|stop|restart)$/);
    if (req.method === "POST" && actionMatch) {
      if (!requireDesktopClient(req, res)) return;
      if (this.#actionInFlight) {
        json(res, 409, { error: "another server action is already in progress" });
        return;
      }

      this.#actionInFlight = true;
      const action = actionMatch[1];

      try {
        if (action === "start") {
          await this.#proxy.start(this.#config);
        } else if (action === "stop") {
          await this.#proxy.stop();
        } else {
          await this.#proxy.stop();
          await this.#proxy.start(this.#config);
        }
        json(res, 200, { server: this.#proxy.snapshot(this.#config) });
      } catch (error) {
        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
          server: this.#proxy.snapshot(this.#config),
        });
      } finally {
        this.#actionInFlight = false;
      }
      return;
    }

    json(res, 404, { error: "not found" });
  }
}
