export type GatewayStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export interface GatewayInfo {
  status: GatewayStatus;
  endpoint: string;
  healthEndpoint: string;
}

export interface ManagedServerInfo {
  id: string;
  name: string;
  transport: "stdio" | "http";
  status: GatewayStatus;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
  root?: string;
}

export interface CoreLogEntry {
  seq: number;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
}

export interface CoreStatus {
  core: {
    version: string;
    startedAt: string;
    logFile: string;
  };
  gateway: GatewayInfo;
}

interface ServerConfigBase {
  id: string;
  name: string;
  alias: string;
  enabled: boolean;
  autoStart: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StdioServerConfig extends ServerConfigBase {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
}

export interface HttpServerConfig extends ServerConfigBase {
  transport: "http";
  url: string;
  hasAuthorization: boolean;
}

export type McpServerConfig = StdioServerConfig | HttpServerConfig;

export type UpstreamStatus =
  | "configured"
  | "connecting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export interface UpstreamInfo {
  id: string;
  name: string;
  alias: string;
  transport: "stdio" | "http";
  status: UpstreamStatus;
  toolCount: number;
  lastError: string | null;
}

export interface ToolRouteInfo {
  publicName: string;
  serverId: string;
  serverAlias: string;
  originalName: string;
  enabled: boolean;
}

export interface ToolPolicyInfo {
  serverId: string;
  originalName: string;
  enabled: boolean;
}
