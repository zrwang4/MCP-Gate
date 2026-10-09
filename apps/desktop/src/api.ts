import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:24888/mcp";
export const MANAGEMENT_URL = "http://127.0.0.1:24889";
export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let managementTokenPromise: Promise<string | null> | null = null;

async function getManagementToken(): Promise<string | null> {
  if (!IS_TAURI) {
    const token = import.meta.env.VITE_MCP_GATE_MANAGEMENT_TOKEN;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  }

  managementTokenPromise ??= invoke<string>("management_token")
    .then((token) => token.trim() || null)
    .catch(() => null);
  return managementTokenPromise;
}

export const MANAGEMENT_MUTATION_TIMEOUT_MS = 180_000;

export async function api<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = init?.method && init.method !== "GET" ? MANAGEMENT_MUTATION_TIMEOUT_MS : 4000,
): Promise<T> {
  const headers = new Headers(init?.headers);
  const managementToken = await getManagementToken();
  if (managementToken) {
    headers.set("X-MCP-Gate-Token", managementToken);
  }
  headers.set("X-MCP-Gate-Client", "desktop");
  if (init?.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${MANAGEMENT_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    const body = (await response.json()) as T & { error?: string; reconnectError?: string };
    if (!response.ok) {
      if (body.reconnectError) {
        throw new Error(`配置已保存，但重新连接失败：${body.reconnectError}`);
      }
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        init?.method && init.method !== "GET"
          ? "等待操作结果超时，后台可能仍在执行。请刷新确认实际状态后再操作，不要立即重复提交。"
          : "读取状态超时，请稍后刷新。",
      );
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
