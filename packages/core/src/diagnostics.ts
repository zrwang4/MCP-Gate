import { arch, homedir, platform, release } from "node:os";
import type { LogEntry } from "./logger.ts";
import { redactSecrets } from "./logger.ts";
import type { McpProfile } from "./profile-store.ts";
import type { McpServerConfig } from "./server-registry.ts";
import type { ToolRoute } from "./tool-registry.ts";
import type { UpstreamSnapshot } from "./upstream-manager.ts";

export interface DiagnosticGatewaySnapshot {
  endpoint: string;
  healthEndpoint: string;
  status: string;
  toolCount: number;
  lastError: string | null;
  authRequired?: boolean;
  authReady?: boolean;
  authError?: string | null;
  lanEnabled?: boolean;
  lanEndpoints?: string[];
}

export interface DiagnosticSnapshotInput {
  coreVersion: string;
  coreStartedAt: string;
  gateway: DiagnosticGatewaySnapshot;
  activeProfileId: string | null;
  profiles: McpProfile[];
  servers: McpServerConfig[];
  upstreams: UpstreamSnapshot[];
  tools: ToolRoute[];
  logs: LogEntry[];
  generatedAt?: string;
}

export function buildDiagnosticSnapshot(input: DiagnosticSnapshotInput) {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    runtime: {
      coreVersion: input.coreVersion,
      coreStartedAt: input.coreStartedAt,
      nodeVersion: process.version,
      platform: platform(),
      arch: arch(),
      osRelease: release(),
    },
    gateway: {
      endpoint: sanitizeHttpUrl(input.gateway.endpoint),
      healthEndpoint: sanitizeHttpUrl(input.gateway.healthEndpoint),
      status: input.gateway.status,
      toolCount: input.gateway.toolCount,
      lastError: sanitizeText(input.gateway.lastError),
      authRequired: Boolean(input.gateway.authRequired),
      authReady: input.gateway.authReady ?? true,
      authError: sanitizeText(input.gateway.authError ?? null),
      lanEnabled: Boolean(input.gateway.lanEnabled),
      lanEndpoints: [...(input.gateway.lanEndpoints ?? [])],
    },
    profiles: {
      activeProfileId: input.activeProfileId,
      items: input.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        serverIds: [...profile.serverIds],
      })),
    },
    servers: input.servers.map(toDiagnosticServerConfig),
    upstreams: input.upstreams.map((upstream) => ({
      id: upstream.id,
      name: upstream.name,
      alias: upstream.alias,
      transport: upstream.transport,
      status: upstream.status,
      toolCount: upstream.toolCount,
      lastError: sanitizeText(upstream.lastError),
      reconnectAttempt: upstream.reconnectAttempt,
      nextRetryAt: upstream.nextRetryAt,
    })),
    tools: input.tools.map((tool) => ({
      publicName: tool.publicName,
      serverId: tool.serverId,
      serverAlias: tool.serverAlias,
      originalName: tool.originalName,
      enabled: tool.enabled,
    })),
    recentWarningsAndErrors: input.logs
      .filter((entry) => entry.level === "warn" || entry.level === "error")
      .slice(-100)
      .map((entry) => ({
        timestamp: entry.timestamp,
        level: entry.level,
        source: entry.source,
        message: redactSecrets(entry.message),
      })),
  };
}

export interface DiagnosticServerBase {
  id: string;
  name: string;
  alias: string;
  enabled: boolean;
  autoStart: boolean;
}

export interface DiagnosticHttpServerConfig extends DiagnosticServerBase {
  transport: "http";
  url: string;
  hasAuthorization: boolean;
}

export interface DiagnosticStdioServerConfig extends DiagnosticServerBase {
  transport: "stdio";
  command: string;
  argCount: number;
  cwd: string | null;
  envKeys: string[];
  secretEnvKeys: string[];
}

export type DiagnosticServerConfig =
  | DiagnosticHttpServerConfig
  | DiagnosticStdioServerConfig;

export function toDiagnosticServerConfig(
  server: McpServerConfig,
): DiagnosticServerConfig {
  const base: DiagnosticServerBase = {
    id: server.id,
    name: server.name,
    alias: server.alias,
    enabled: server.enabled,
    autoStart: server.autoStart,
  };

  if (server.transport === "http") {
    return {
      ...base,
      transport: "http",
      url: sanitizeHttpUrl(server.url),
      hasAuthorization: Boolean(server.authSecretId),
    };
  }

  return {
    ...base,
    transport: "stdio",
    command: sanitizePath(server.command),
    argCount: server.args.length,
    cwd: server.cwd ? sanitizePath(server.cwd) : null,
    envKeys: Object.keys(server.env ?? {}).sort(),
    secretEnvKeys: Object.keys(server.envSecretIds ?? {}).sort(),
  };
}

export function sanitizeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return sanitizeText(value) ?? "";
  }
}

export function sanitizePath(value: string): string {
  const home = homedir();
  if (value === home) return "~";
  if (value.startsWith(`${home}/`)) {
    return `~${value.slice(home.length)}`;
  }
  return redactSecrets(value);
}

function sanitizeText(value: string | null): string | null {
  return value ? redactSecrets(value) : value;
}
