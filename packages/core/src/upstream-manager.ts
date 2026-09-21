import type { CallToolResult } from "@modelcontextprotocol/client";
import type { CoreLogger } from "./logger.ts";
import type { McpServerConfig, ServerRegistry } from "./server-registry.ts";
import type { McpToolDefinition, ToolRegistry } from "./tool-registry.ts";

const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export type UpstreamStatus =
  | "configured"
  | "connecting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export interface UpstreamLifecycleHandlers {
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export interface UpstreamClient {
  setLifecycleHandlers?(handlers: UpstreamLifecycleHandlers): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: unknown): Promise<CallToolResult>;
}

export type UpstreamFactory = (
  config: McpServerConfig,
) => Promise<UpstreamClient> | UpstreamClient;

export interface UpstreamSnapshot {
  id: string;
  name: string;
  alias: string;
  transport: "stdio" | "http";
  status: UpstreamStatus;
  toolCount: number;
  lastError: string | null;
  reconnectAttempt: number;
  nextRetryAt: string | null;
}

export interface UpstreamManagerOptions {
  reconnectDelaysMs?: readonly number[];
}

interface Runtime {
  config: McpServerConfig;
  status: UpstreamStatus;
  client: UpstreamClient | null;
  toolCount: number;
  lastError: string | null;
  desiredConnected: boolean;
  reconnectAttempt: number;
  nextRetryAt: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
}

export class UpstreamManager {
  #registry: ServerRegistry;
  #tools: ToolRegistry;
  #factory: UpstreamFactory;
  #logger: CoreLogger;
  #reconnectDelaysMs: readonly number[];
  #runtimes = new Map<string, Runtime>();
  #busy = new Set<string>();

  constructor(
    registry: ServerRegistry,
    tools: ToolRegistry,
    factory: UpstreamFactory,
    logger: CoreLogger,
    options: UpstreamManagerOptions = {},
  ) {
    this.#registry = registry;
    this.#tools = tools;
    this.#factory = factory;
    this.#logger = logger;
    this.#reconnectDelaysMs =
      options.reconnectDelaysMs && options.reconnectDelaysMs.length > 0
        ? options.reconnectDelaysMs
        : DEFAULT_RECONNECT_DELAYS_MS;
  }

  syncConfigs(): void {
    const configs = this.#registry.list();
    const activeIds = new Set(configs.map((config) => config.id));

    for (const config of configs) {
      const runtime = this.#runtimes.get(config.id);
      if (runtime) {
        runtime.config = config;
        if (!config.enabled) {
          runtime.desiredConnected = false;
          this.#cancelReconnect(runtime, true);
        }
      } else {
        this.#runtimes.set(config.id, {
          config,
          status: "configured",
          client: null,
          toolCount: 0,
          lastError: null,
          desiredConnected: false,
          reconnectAttempt: 0,
          nextRetryAt: null,
          reconnectTimer: null,
          generation: 0,
        });
      }
    }

    for (const [id, runtime] of this.#runtimes) {
      if (!activeIds.has(id)) {
        runtime.desiredConnected = false;
        runtime.generation += 1;
        this.#cancelReconnect(runtime, true);
        if (runtime.client) {
          void runtime.client.disconnect().catch(() => undefined);
        }
        this.#tools.removeServer(id);
        this.#runtimes.delete(id);
      }
    }
  }

  list(): UpstreamSnapshot[] {
    this.syncConfigs();
    return [...this.#runtimes.values()]
      .map((runtime) => this.#snapshot(runtime))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async connect(id: string): Promise<UpstreamSnapshot> {
    this.syncConfigs();
    const runtime = this.#requireRuntime(id);
    runtime.desiredConnected = true;
    this.#cancelReconnect(runtime, true);
    return this.#connectRuntime(runtime, false);
  }

  async disconnect(id: string): Promise<UpstreamSnapshot> {
    this.syncConfigs();
    const runtime = this.#requireRuntime(id);
    if (this.#busy.has(id)) throw new Error("upstream action already in progress");

    runtime.desiredConnected = false;
    runtime.generation += 1;
    this.#cancelReconnect(runtime, true);

    this.#busy.add(id);
    runtime.status = "stopping";

    const client = runtime.client;
    runtime.client = null;
    runtime.toolCount = 0;
    this.#tools.removeServer(id);

    try {
      if (client) {
        await client.disconnect();
      }
      runtime.status = "stopped";
      runtime.lastError = null;
      this.#logger.info("upstream", `disconnected ${runtime.config.name}`);
      return this.#snapshot(runtime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.status = "error";
      runtime.lastError = message;
      this.#logger.warn(
        "upstream",
        `disconnect failed for ${runtime.config.name}: ${message}`,
      );
      throw error;
    } finally {
      this.#busy.delete(id);
    }
  }

  async refreshTools(id: string): Promise<UpstreamSnapshot> {
    const runtime = this.#requireRuntime(id);
    if (runtime.status !== "running" || !runtime.client) {
      throw new Error("upstream is not running");
    }

    const tools = await runtime.client.listTools();
    const routes = this.#tools.replaceServerTools(
      runtime.config.id,
      runtime.config.alias,
      tools,
    );
    runtime.toolCount = routes.length;
    return this.#snapshot(runtime);
  }

  async callTool(publicName: string, args: unknown): Promise<CallToolResult> {
    const route = this.#tools.resolve(publicName);
    if (!route) throw new Error("tool not found");
    if (!route.enabled) throw new Error("tool is disabled");

    const runtime = this.#requireRuntime(route.serverId);
    if (runtime.status !== "running" || !runtime.client) {
      throw new Error("upstream is not running");
    }

    return runtime.client.callTool(route.originalName, args);
  }

  async connectAutoStart(): Promise<void> {
    this.syncConfigs();
    const ids = this.#registry
      .list()
      .filter((config) => config.enabled && config.autoStart)
      .map((config) => config.id);

    const results = await Promise.allSettled(
      ids.map((id) => this.connect(id)),
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.#logger.warn(
          "upstream",
          `auto-start failed for ${ids[index]}: ${String(result.reason)}`,
        );
      }
    });
  }

  async stopAll(): Promise<void> {
    const ids = [...this.#runtimes.keys()];
    for (const id of ids) {
      try {
        await this.disconnect(id);
      } catch {
        // Best effort during shutdown.
      }
    }
  }

  async #connectRuntime(
    runtime: Runtime,
    reconnecting: boolean,
  ): Promise<UpstreamSnapshot> {
    const id = runtime.config.id;

    if (runtime.status === "running") return this.#snapshot(runtime);
    if (this.#busy.has(id)) throw new Error("upstream action already in progress");
    if (!runtime.config.enabled) throw new Error("upstream is disabled");

    this.#busy.add(id);
    runtime.status = "connecting";
    runtime.nextRetryAt = null;
    if (!reconnecting) runtime.lastError = null;

    const generation = runtime.generation + 1;
    runtime.generation = generation;
    let retryAfterFailure = false;

    try {
      const client = await this.#factory(runtime.config);
      runtime.client = client;

      client.setLifecycleHandlers?.({
        onError: (error) => {
          this.#handleClientError(id, generation, error);
        },
        onClose: () => {
          this.#handleClientClose(id, generation);
        },
      });

      await client.connect();
      const tools = await client.listTools();
      const routes = this.#tools.replaceServerTools(
        runtime.config.id,
        runtime.config.alias,
        tools,
      );

      runtime.toolCount = routes.length;
      runtime.status = "running";
      runtime.lastError = null;
      runtime.reconnectAttempt = 0;
      runtime.nextRetryAt = null;

      this.#logger.info(
        "upstream",
        `${reconnecting ? "reconnected" : "connected"} ${runtime.config.name} with ${routes.length} tool(s)`,
      );
      return this.#snapshot(runtime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.lastError = message;
      runtime.status = "error";
      runtime.toolCount = 0;
      this.#tools.removeServer(id);

      const client = runtime.client;
      runtime.client = null;
      if (client) {
        await client.disconnect().catch(() => undefined);
      }

      retryAfterFailure =
        reconnecting &&
        runtime.desiredConnected &&
        runtime.config.enabled &&
        runtime.generation === generation;

      this.#logger.error(
        "upstream",
        `${reconnecting ? "reconnect failed" : "connect failed"} for ${runtime.config.name}: ${message}`,
      );
      throw error;
    } finally {
      this.#busy.delete(id);
      if (retryAfterFailure) {
        this.#scheduleReconnect(runtime);
      }
    }
  }

  #handleClientError(id: string, generation: number, error: Error): void {
    const runtime = this.#runtimes.get(id);
    if (!runtime || runtime.generation !== generation) return;
    if (runtime.status !== "running" || !runtime.desiredConnected) return;

    runtime.lastError = error.message;
    this.#logger.warn(
      "upstream",
      `transport error from ${runtime.config.name}: ${error.message}`,
    );
  }

  #handleClientClose(id: string, generation: number): void {
    const runtime = this.#runtimes.get(id);
    if (!runtime || runtime.generation !== generation) return;
    if (this.#busy.has(id)) return;
    if (runtime.status !== "running" || !runtime.desiredConnected) return;

    runtime.client = null;
    runtime.status = "error";
    runtime.toolCount = 0;
    runtime.lastError ??= "connection closed unexpectedly";
    this.#tools.removeServer(id);

    this.#logger.warn(
      "upstream",
      `connection lost: ${runtime.config.name}; automatic reconnect scheduled`,
    );
    this.#scheduleReconnect(runtime);
  }

  #scheduleReconnect(runtime: Runtime): void {
    if (
      runtime.reconnectTimer ||
      !runtime.desiredConnected ||
      !runtime.config.enabled
    ) {
      return;
    }

    runtime.reconnectAttempt += 1;
    const delay =
      this.#reconnectDelaysMs[
        Math.min(
          runtime.reconnectAttempt - 1,
          this.#reconnectDelaysMs.length - 1,
        )
      ] ?? this.#reconnectDelaysMs[this.#reconnectDelaysMs.length - 1] ?? 30_000;

    runtime.nextRetryAt = new Date(Date.now() + delay).toISOString();

    this.#logger.info(
      "upstream",
      `retry #${runtime.reconnectAttempt} for ${runtime.config.name} in ${delay}ms`,
    );

    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null;
      runtime.nextRetryAt = null;

      if (!runtime.desiredConnected || !runtime.config.enabled) return;

      void this.#connectRuntime(runtime, true).catch(() => undefined);
    }, delay);

    const timer = runtime.reconnectTimer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    };
    timer.unref?.();
  }

  #cancelReconnect(runtime: Runtime, resetAttempt: boolean): void {
    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }
    runtime.nextRetryAt = null;
    if (resetAttempt) runtime.reconnectAttempt = 0;
  }

  #requireRuntime(id: string): Runtime {
    const runtime = this.#runtimes.get(id);
    if (!runtime) throw new Error("upstream not found");
    return runtime;
  }

  #snapshot(runtime: Runtime): UpstreamSnapshot {
    return {
      id: runtime.config.id,
      name: runtime.config.name,
      alias: runtime.config.alias,
      transport: runtime.config.transport,
      status: runtime.status,
      toolCount: runtime.toolCount,
      lastError: runtime.lastError,
      reconnectAttempt: runtime.reconnectAttempt,
      nextRetryAt: runtime.nextRetryAt,
    };
  }
}
