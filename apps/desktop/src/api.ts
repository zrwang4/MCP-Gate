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

export async function api<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
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

    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    return body;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

