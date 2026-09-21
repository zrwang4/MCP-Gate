import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface CoreConfig {
  host: string;
  port: number;
  managementHost: string;
  managementPort: number;
  filesystemRoot: string;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  sessionIdleTimeoutMs: number;
  logFile: string;
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
  const root = process.env.MCP_GATE_FILESYSTEM_ROOT;
  if (!root) {
    throw new Error(
      "MCP_GATE_FILESYSTEM_ROOT is required. Point it at a dedicated test directory, not your whole home directory.",
    );
  }

  return {
    host: process.env.MCP_GATE_HOST ?? "127.0.0.1",
    port: readPositiveInt("MCP_GATE_PORT", 24888),
    managementHost: process.env.MCP_GATE_MANAGEMENT_HOST ?? "127.0.0.1",
    managementPort: readPositiveInt("MCP_GATE_MANAGEMENT_PORT", 24889),
    filesystemRoot: resolve(root),
    connectionTimeoutMs: readPositiveInt("MCP_GATE_CONNECTION_TIMEOUT_MS", 60_000),
    requestTimeoutMs: readPositiveInt("MCP_GATE_REQUEST_TIMEOUT_MS", 300_000),
    sessionIdleTimeoutMs: readPositiveInt("MCP_GATE_SESSION_IDLE_TIMEOUT_MS", 30 * 60_000),
    logFile:
      process.env.MCP_GATE_LOG_FILE ??
      join(homedir(), "Library", "Logs", "MCP Gate", "core.jsonl"),
  };
}
