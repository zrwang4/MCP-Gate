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

export interface StdioServerConfig {
  id: string;
  name: string;
  alias: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  enabled: boolean;
  autoStart: boolean;
  createdAt: string;
  updatedAt: string;
}

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
