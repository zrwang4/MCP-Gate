export type GatewayStatus = "starting" | "running" | "stopped" | "error";

export interface GatewayInfo {
  status: GatewayStatus;
  endpoint: string;
  healthEndpoint: string;
}
