export type ServerStatus = "starting" | "running" | "stopping" | "stopped" | "error";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface UpstreamInfo {
  id: string;
  name: string;
  alias: string;
  transport: "stdio" | "http";
  status: "configured" | "connecting" | "running" | "stopping" | "stopped" | "error";
  toolCount: number;
  lastError: string | null;
  reconnectAttempt: number;
  nextRetryAt: string | null;
  healthStatus?: "unknown" | "healthy" | "unhealthy";
  lastHealthCheckAt?: string | null;
  consecutiveFailureCount?: number;
  circuitState?: "closed" | "open" | "half-open";
  circuitOpenedAt?: string | null;
}

export interface ServerConfigInfo {
  id: string;
  name: string;
  alias: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  secretEnvKeys?: string[];
  url?: string;
  headers?: Record<string, string>;
  hasAuthorization?: boolean;
  enabled: boolean;
  autoStart: boolean;
}

export interface ProfileInfo {
  id: string;
  name: string;
  serverIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProfileApplyFailure {
  serverId: string;
  error: string;
}

export interface ProfileApplyResult {
  connected: string[];
  disconnected: string[];
  alreadyRunning: string[];
  failed: ProfileApplyFailure[];
}

export interface McpImportSourceInfo {
  id: string;
  label: string;
  displayPath: string;
  exists: boolean;
  size: number | null;
  modifiedAt: string | null;
}

export interface McpImportIssue {
  sourceName?: string;
  message: string;
}

export interface McpImportPreviewCandidate {
  sourceName: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  plainEnvKeys: string[];
  secretEnvKeys: string[];
  headerKeys: string[];
  hasAuthorization: boolean;
  warnings: string[];
}

export interface McpImportPreview {
  candidates: McpImportPreviewCandidate[];
  issues: McpImportIssue[];
}

export interface McpImportApplyResult {
  imported: Array<{
    sourceName: string;
    serverId: string;
    name: string;
  }>;
  skipped: Array<{
    sourceName: string;
    reason: string;
  }>;
  failed: Array<{
    sourceName: string;
    error: string;
  }>;
  issues: McpImportIssue[];
}

export interface ToolInfo {
  publicName: string;
  serverId: string;
  serverAlias: string;
  originalName: string;
  enabled: boolean;
  definition: {
    name: string;
    description?: string;
    inputSchema?: unknown;
  };
}

export interface LogEntry {
  seq: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface AuditEntry {
  seq: number;
  timestamp: string;
  source: "gateway" | "tester";
  publicName: string;
  serverId: string;
  serverAlias: string;
  originalName: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface CoreRuntimeStatus {
  reachable: boolean;
  managed: boolean;
  pid: number | null;
  launchMode:
    | "none"
    | "external"
    | "managed-node"
    | "managed-bundled-node"
    | "managed-executable";
}

export interface UpdateMetadata {
  version: string;
  currentVersion: string;
  notes: string | null;
  pubDate: string | null;
}

export type UpdateDownloadEvent =
  | { event: "Started"; data: { contentLength: number | null } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export interface ConnectionTestResult {
  transport: "stdio" | "http";
  toolCount: number;
  toolNames: string[];
  durationMs: number;
}

export type ConnectionTestState =
  | { status: "success"; result: ConnectionTestResult }
  | { status: "error"; error: string };

export interface StatusResponse {
  core: {
    version: string;
    startedAt: string;
    logFile: string;
    sessionIdleTimeoutMs: number;
  };
  gateway: {
    endpoint: string;
    healthEndpoint: string;
    status: ServerStatus;
    toolCount: number;
    lastError: string | null;
    authRequired?: boolean;
    authReady?: boolean;
    authError?: string | null;
    lanEnabled?: boolean;
    lanEndpoints?: string[];
  };
}

