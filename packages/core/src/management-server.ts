import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  isManagementRequestAuthorized,
  MANAGEMENT_TOKEN_HEADER,
} from "./management-auth.ts";
import {
  json,
  readJsonBody,
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
import { handleBackup } from "./management-route-backup.ts";
import { CORE_VERSION } from "./version.ts";
import {
  normalizeSessionIdleTimeout,
  saveSessionIdleTimeout,
  sessionSettingsSnapshot,
} from "./session-settings.ts";

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
  handleBackup,
];

export class ManagementServer {
  #context: ManagementContext;
  #server: ReturnType<typeof createServer> | null = null;

  constructor(context: ManagementContext) {
    this.#context = context;
  }

  async start(): Promise<void> {
    if (this.#server) return;

    const server = createServer((req, res) => {
      void this.#handle(req, res).catch((error) => {
        this.#context.logger.error(
          "management",
          error instanceof Error ? error.message : String(error),
        );
        if (!res.headersSent) json(res, 500, { error: "internal error" });
        else res.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(
        this.#context.config.managementPort,
        this.#context.config.managementHost,
        () => {
          server.off("error", reject);
          resolve();
        },
      );
    });

    this.#server = server;
    this.#context.logger.info(
      "management",
      `API listening on http://${this.#context.config.managementHost}:${this.#context.config.managementPort}`,
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

    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );

    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (!isManagementRequestAuthorized(req.headers, this.#context.config.managementToken)) {
      this.#context.logger.warn(
        "management",
        `management access denied: ${req.method ?? "UNKNOWN"} ${url.pathname}`,
      );
      json(res, 403, {
        error: this.#context.config.managementToken
          ? `missing or invalid ${MANAGEMENT_TOKEN_HEADER}`
          : "missing desktop client header",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      json(res, 200, {
        core: {
          version: CORE_VERSION,
          startedAt: this.#context.startedAt,
          logFile: this.#context.logger.filePath,
          sessionIdleTimeoutMs: this.#context.config.sessionIdleTimeoutMs,
        },
        gateway: this.#context.gateway.snapshot(),
        management: {
          endpoint: `http://${this.#context.config.managementHost}:${this.#context.config.managementPort}`,
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/session-settings") {
      json(res, 200, {
        settings: sessionSettingsSnapshot(
          this.#context.config.sessionIdleTimeoutMs,
        ),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/session-settings") {
      try {
        const body = (await readJsonBody(req)) as {
          idleTimeoutMs?: unknown;
        };
        const idleTimeoutMs = normalizeSessionIdleTimeout(body.idleTimeoutMs);
        await this.#context.mutations.run(async () => {
          await saveSessionIdleTimeout(
            this.#context.config.sessionSettingsFile,
            idleTimeoutMs,
            this.#context.logger,
          );
          // Keep the in-memory config in step with the file so subsequent
          // GETs (and /api/status) reflect the new value immediately instead
          // of serving the stale startup value until a restart.
          this.#context.config.sessionIdleTimeoutMs = idleTimeoutMs;
          this.#context.logger.info(
            "session",
            `MCP session idle timeout changed to ${Math.round(idleTimeoutMs / 60_000)} minute(s); restart required for existing gateway sessions`,
          );
        });
        json(res, 200, {
          settings: sessionSettingsSnapshot(idleTimeoutMs),
          restartRequired: true,
        });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    for (const route of ROUTES) {
      if (await route(req, res, url, this.#context)) return;
    }

    json(res, 404, { error: "not found" });
  }
}
