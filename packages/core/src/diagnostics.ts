import { arch, homedir, platform, release } from "node:os";
import type { GatewaySnapshot } from "./gateway-server.ts";
import type { LogEntry } from "./logger.ts";
import { redactSecrets } from "./logger.ts";
import type { McpProfile } from "./profile-store.ts";
import type { McpServerConfig } from "./server-registry.ts";
import type { ToolRoute } from "./tool-registry.ts";
import type { UpstreamSnapshot } from "./upstream-manager.ts";

export interface DiagnosticSnapshotInput {
  coreVersion: string;
  coreStartedAt: string;
  gateway: GatewaySnapshot;
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

export function toDiagnosticServerConfig(server: McpServerConfig) {
  const base = {
    id: server.id,
    name: server.name,
    alias: server.alias,
    transport: server.transport,
    enabled: server.enabled,
    autoStart: server.autoStart,
  };

  if (server.transport === "http") {
    return {
      ...base,
      url: sanitizeHttpUrl(server.url),
      hasAuthorization: Boolean(server.authSecretId),
    };
  }

  return {
    ...base,
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
