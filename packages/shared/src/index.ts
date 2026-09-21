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
