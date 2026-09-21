import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface CoreConfig {
  host: string;
  port: number;
  filesystemRoot: string;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  sessionIdleTimeoutMs: number;
  managementHost: string;
  managementPort: number;
  managementToken: string | null;
  logFile: string;
  serverConfigFile: string;
  toolPolicyFile: string;
  profileFile: string;
  gatewayAccessFile: string;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }

  return value;
}

export function loadConfig(): CoreConfig {
  const appSupportDir = join(homedir(), "Library", "Application Support", "MCP Gate");
  const root = process.env.MCP_GATE_FILESYSTEM_ROOT ?? join(appSupportDir, "filesystem");

  return {
    host: process.env.MCP_GATE_HOST ?? "127.0.0.1",
    port: readPositiveInt("MCP_GATE_PORT", 24888),
    filesystemRoot: resolve(root),
    connectionTimeoutMs: readPositiveInt("MCP_GATE_CONNECTION_TIMEOUT_MS", 60_000),
    requestTimeoutMs: readPositiveInt("MCP_GATE_REQUEST_TIMEOUT_MS", 300_000),
    sessionIdleTimeoutMs: readPositiveInt("MCP_GATE_SESSION_IDLE_TIMEOUT_MS", 30 * 60_000),
    managementHost: process.env.MCP_GATE_MANAGEMENT_HOST ?? "127.0.0.1",
    managementPort: readPositiveInt("MCP_GATE_MANAGEMENT_PORT", 24889),
    managementToken:
      process.env.MCP_GATE_MANAGEMENT_TOKEN?.trim() || null,
    logFile:
      process.env.MCP_GATE_LOG_FILE ??
      join(homedir(), "Library", "Logs", "MCP Gate", "core.jsonl"),
    serverConfigFile:
      process.env.MCP_GATE_SERVER_CONFIG_FILE ??
      join(appSupportDir, "servers.json"),
    toolPolicyFile:
      process.env.MCP_GATE_TOOL_POLICY_FILE ??
      join(appSupportDir, "tool-policy.json"),
    profileFile:
      process.env.MCP_GATE_PROFILE_FILE ??
      join(appSupportDir, "profiles.json"),
    gatewayAccessFile:
      process.env.MCP_GATE_GATEWAY_ACCESS_FILE ??
      join(appSupportDir, "gateway-access.json"),
  };
}
