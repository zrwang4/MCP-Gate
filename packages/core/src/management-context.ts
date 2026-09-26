import type { AuditLogger } from "./audit-logger.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreConfig } from "./config.ts";
import type { CoreLogger } from "./logger.ts";
import type { GatewayAccessController } from "./gateway-access.ts";
import type { GatewayServer } from "./gateway-server.ts";
import type {
  HttpServerConfig,
  McpServerConfig,
  ServerRegistry,
} from "./server-registry.ts";
import type { ProfileStore } from "./profile-store.ts";
import type { SecretStore } from "./secret-store.ts";
import type { ToolPolicyStore } from "./tool-policy-store.ts";
import type { ToolRegistry } from "./tool-registry.ts";
import type { UpstreamManager } from "./upstream-manager.ts";

export interface ManagementContext {
  config: CoreConfig;
  gateway: GatewayServer;
  gatewayAccess: GatewayAccessController;
  registry: ServerRegistry;
  profiles: ProfileStore;
  upstreams: UpstreamManager;
  tools: ToolRegistry;
  toolPolicy: ToolPolicyStore;
  secrets: SecretStore;
  audit: AuditLogger;
  logger: CoreLogger;
  startedAt: string;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ManagementContext,
) => Promise<boolean>;

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readJsonBody(
  req: IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<unknown> {
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

export function requireDesktopClient(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (req.headers["x-mcp-gate-client"] !== "desktop") {
    json(res, 403, { error: "missing desktop client header" });
    return false;
  }
  return true;
}

export function toPublicServerConfig(server: McpServerConfig): Record<string, unknown> {
  if (server.transport === "stdio") {
    const { envSecretIds, ...publicConfig } = server;
    return {
      ...publicConfig,
      secretEnvKeys: Object.keys(envSecretIds ?? {}).sort(),
    };
  }

  const { authSecretId, ...publicConfig } = server as HttpServerConfig;
  return {
    ...publicConfig,
    hasAuthorization: Boolean(authSecretId),
  };
}
