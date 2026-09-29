import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { StdioServerConfig } from "./server-registry.ts";
import type { SecretStore } from "./secret-store.ts";
import type { McpToolDefinition } from "./tool-registry.ts";
import type {
  UpstreamClient,
  UpstreamLifecycleHandlers,
} from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

/** Default handshake budget for a stdio upstream (npx cold starts land here). */
export const DEFAULT_STDIO_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Reject a promise after `timeoutMs`. The underlying operation keeps running —
 * a stdio handshake cannot be cancelled — so its eventual failure is attached
 * a no-op handler: if the timeout wins the race, the late rejection must not
 * surface as an unhandledRejection.
 */
export function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const original = operation();
  original.catch(() => undefined);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    original.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class StdioUpstreamClient implements UpstreamClient {  #config: StdioServerConfig;
  #secrets: SecretStore;
  #connectTimeoutMs: number;
  #client: Client | null = null;
  #transport: StdioClientTransport | null = null;
  #lifecycleHandlers: UpstreamLifecycleHandlers = {};

  constructor(
    config: StdioServerConfig,
    secrets: SecretStore,
    connectTimeoutMs = DEFAULT_STDIO_CONNECT_TIMEOUT_MS,
  ) {
    this.#config = config;
    this.#secrets = secrets;
    this.#connectTimeoutMs = connectTimeoutMs;
  }

  setLifecycleHandlers(handlers: UpstreamLifecycleHandlers): void {
    this.#lifecycleHandlers = handlers;
    if (this.#client) this.#bindLifecycle(this.#client);
  }

  async connect(): Promise<void> {
    if (this.#client) return;

    const client = new Client({
      name: "mcp-gate",
      version: CORE_VERSION,
    });

    this.#bindLifecycle(client);

    const env = await resolveStdioEnvironment(this.#config, this.#secrets);
    const transport = new StdioClientTransport({
      command: this.#config.command,
      args: this.#config.args,
      cwd: this.#config.cwd,
      ...(env ? { env } : {}),
    });

    this.#client = client;
    this.#transport = transport;

    try {
      await withTimeout(
        () => client.connect(transport),
        this.#connectTimeoutMs,
        `stdio handshake timed out after ${this.#connectTimeoutMs}ms (${this.#config.command})`,
      );
    } catch (error) {
      try {
        await client.close();
        this.#client = null;
        this.#transport = null;
      } catch {
        // Keep ownership when cleanup fails so a later disconnect can retry
        // closing the same client/transport instead of orphaning the process.
        this.#client = client;
        this.#transport = transport;
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.#client;

    if (client) {
      await client.close();
    }

    // Preserve the client reference when close fails so a later disconnect
    // can retry the actual transport shutdown.
    this.#client = null;
    this.#transport = null;
  }

  async healthCheck(timeoutMs: number): Promise<void> {
    await this.#requireClient().listTools(undefined, {
      cacheMode: "bypass",
      timeout: timeoutMs,
    });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const client = this.#requireClient();
    const result = await client.listTools();

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    const client = this.#requireClient();

    if (
      args !== undefined &&
      args !== null &&
      (typeof args !== "object" || Array.isArray(args))
    ) {
      throw new Error("tool arguments must be an object");
    }

    return client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
  }

  #bindLifecycle(client: Client): void {
    client.onclose = () => {
      this.#lifecycleHandlers.onClose?.();
    };
    client.onerror = (error) => {
      this.#lifecycleHandlers.onError?.(error);
    };
  }

  #requireClient(): Client {
    if (!this.#client) throw new Error("stdio upstream is not connected");
    return this.#client;
  }
}

export async function resolveStdioEnvironment(
  config: StdioServerConfig,
  secrets: SecretStore,
): Promise<Record<string, string> | undefined> {
  const result: Record<string, string> = {
    ...(config.env ?? {}),
  };

  for (const [key, secretId] of Object.entries(config.envSecretIds ?? {})) {
    const value = await secrets.get(secretId);
    if (value === null) {
      throw new Error(
        `environment secret ${key} is missing from secure storage`,
      );
    }
    result[key] = value;
  }

  result.PATH = buildStdioPath(result.PATH);
  return Object.keys(result).length > 0 ? result : undefined;
}

export function buildStdioPath(
  configuredPath = "",
  home = homedir(),
  platform = process.platform,
  inheritedPath = process.env.PATH ?? "",
): string {
  const additions = [
    join(home, ".local", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "mise", "shims"),
    join(home, ".bun", "bin"),
  ];

  if (platform === "darwin") {
    additions.push("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin");
  }

  const nvmNodeBins = listNvmNodeBins(home);
  const entries = [
    ...configuredPath.split(delimiter),
    ...inheritedPath.split(delimiter),
    ...additions,
    ...nvmNodeBins,
  ].filter(Boolean);

  return [...new Set(entries)].join(delimiter);
}

function listNvmNodeBins(home: string): string[] {
  const nodeVersionsDirectory = join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(nodeVersionsDirectory)
      .filter((version) => version.startsWith("v"))
      .sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true }),
      )
      .map((version) => join(nodeVersionsDirectory, version, "bin"));
  } catch {
    return [];
  }
}
