import { Chrome, Folder, Github, Globe, Server } from "lucide-react";
import type { CoreRuntimeStatus, ServerConfigInfo, ServerStatus, UpstreamInfo } from "../types";
import { IS_TAURI } from "../api";

export function upstreamStatusLabel(status: UpstreamInfo["status"]): string {
  switch (status) {
    case "configured":
      return "已配置";
    case "connecting":
      return "连接中";
    case "running":
      return "运行中";
    case "stopping":
      return "断开中";
    case "error":
      return "异常";
    default:
      return "已断开";
  }
}

export function statusLabel(status: ServerStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "stopping":
      return "停止中";
    case "error":
      return "异常";
    default:
      return "已停止";
  }
}

export function coreRuntimeLabel(status: CoreRuntimeStatus | null): string {
  if (!IS_TAURI) return "Web 模式";
  if (!status) return "检测中";
  if (status.managed) {
    if (status.launchMode === "managed-bundled-node") {
      return "内置 Core Runtime";
    }
    return status.launchMode === "managed-executable"
      ? "桌面托管 Sidecar"
      : "桌面托管 Node";
  }
  if (status.reachable) return "外部 Core";
  return "未运行";
}

export function environmentToText(values: Record<string, string> | undefined): string {
  return Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function secretEnvironmentToText(keys: string[] | undefined): string {
  return [...(keys ?? [])]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=`)
    .join("\n");
}

export function parseEnvironmentText(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`环境变量格式错误：${line}`);
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`环境变量名无效：${key}`);
    }
    result[key] = value;
  }

  return result;
}

export function headersToText(values: Record<string, string> | undefined): string {
  return environmentToText(values);
}

/**
 * HTTP header names are RFC 7230 tokens, which allow the hyphens that env-var
 * names forbid (`X-Apifox-Api-Version`). A CR or LF is refused because it would
 * let a saved value inject extra request headers.
 */
export function parseHeadersText(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Header 格式错误：${line}`);
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key)) {
      throw new Error(`Header 名称无效：${key}`);
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`Header ${key} 的值包含换行符`);
    }
    result[key] = value;
  }

  return result;
}

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatTime(value: string | null): string {
  if (!value) return "—";
  return timeFormatter.format(new Date(value));
}

export function serverIconFor(server: ServerConfigInfo) {
  const haystack = [
    server.name,
    server.alias,
    server.command ?? "",
    server.url ?? "",
    (server.args ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (/(chrome|chromium|browser|devtools|puppeteer|playwright)/.test(haystack)) return Chrome;
  if (/(github|gitlab)/.test(haystack)) return Github;
  if (/(filesystem|file|folder|disk)/.test(haystack)) return Folder;
  if (/(http|https):\/\//.test(haystack)) return Globe;
  return Server;
}

