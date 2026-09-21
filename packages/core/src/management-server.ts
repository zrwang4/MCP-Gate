import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CoreConfig } from "./config.ts";
import { waitForGateway } from "./health.ts";
import type { CoreLogger, LogLevel } from "./logger.ts";
import type { McpProxyProcess } from "./proxy-process.ts";

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return true;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
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
  #logger: CoreLogger;
  #server: ReturnType<typeof createServer> | null = null;
  #startedAt = new Date().toISOString();

  constructor(config: CoreConfig, proxy: McpProxyProcess, logger: CoreLogger) {
    this.#config = config;
    this.#proxy = proxy;
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
          version: "0.2.0-dev",
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
      const action = actionMatch[1];

      try {
        if (action === "start") {
          await this.#proxy.start(this.#config);
          await waitForGateway(this.#config);
          this.#proxy.markReady();
        } else if (action === "stop") {
          await this.#proxy.stop();
        } else {
          await this.#proxy.stop();
          await this.#proxy.start(this.#config);
          await waitForGateway(this.#config);
          this.#proxy.markReady();
        }
        json(res, 200, { server: this.#proxy.snapshot(this.#config) });
      } catch (error) {
        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
          server: this.#proxy.snapshot(this.#config),
        });
      }
      return;
    }

    json(res, 404, { error: "not found" });
  }
}
