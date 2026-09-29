import type { CallToolResult } from "@modelcontextprotocol/client";
import type { AuditLogger, AuditSource } from "./audit-logger.ts";
import type { CoreLogger } from "./logger.ts";
import type { McpServerConfig, ServerRegistry } from "./server-registry.ts";
import type { McpToolDefinition, ToolRegistry } from "./tool-registry.ts";
import type { MutationQueue } from "./mutation-queue.ts";

const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_RESET_MS = 30_000;

export type UpstreamStatus =
  | "configured"
  | "connecting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export type UpstreamHealthStatus = "unknown" | "healthy" | "unhealthy";
export type UpstreamCircuitState = "closed" | "open" | "half-open";

export interface UpstreamLifecycleHandlers {
  onClose?: () => void;
  onError?: (error: Error) => void;
  onNotificationStreamRecycled?: () => void;
}

export interface UpstreamClient {
  setLifecycleHandlers?(handlers: UpstreamLifecycleHandlers): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: unknown): Promise<CallToolResult>;
  healthCheck?(timeoutMs: number): Promise<void>;
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
  healthStatus: UpstreamHealthStatus;
  lastHealthCheckAt: string | null;
  consecutiveFailureCount: number;
  circuitState: UpstreamCircuitState;
  circuitOpenedAt: string | null;
}

export interface UpstreamManagerOptions {
  reconnectDelaysMs?: readonly number[];
  audit?: AuditLogger;
  mutations?: MutationQueue;
  healthCheckIntervalMs?: number;
  healthCheckTimeoutMs?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
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

interface Runtime {
  config: McpServerConfig;
  status: UpstreamStatus;
  client: UpstreamClient | null;
  toolCount: number;
  lastError: string | null;
  desiredConnected: boolean;
  reconnectAttempt: number;
  nextRetryAt: string | null;
  healthStatus: UpstreamHealthStatus;
  lastHealthCheckAt: string | null;
  consecutiveFailureCount: number;
  circuitState: UpstreamCircuitState;
  circuitOpenedAt: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
}

export class UpstreamManager {
  #registry: ServerRegistry;
  #tools: ToolRegistry;
  #factory: UpstreamFactory;
  #logger: CoreLogger;
  #audit: AuditLogger | null;
  #reconnectDelaysMs: readonly number[];
  #healthCheckIntervalMs: number;
  #healthCheckTimeoutMs: number;
  #circuitFailureThreshold: number;
  #circuitResetMs: number;
  #healthTimer: ReturnType<typeof setInterval> | null = null;
  #healthInFlight = new Set<string>();
  #runtimes = new Map<string, Runtime>();
  #busy = new Set<string>();
  #connectOperations = new Map<string, Promise<UpstreamSnapshot>>();
  #mutations: MutationQueue | null;

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
    this.#audit = options.audit ?? null;
    this.#mutations = options.mutations ?? null;
    this.#reconnectDelaysMs =
      options.reconnectDelaysMs && options.reconnectDelaysMs.length > 0
        ? options.reconnectDelaysMs
        : DEFAULT_RECONNECT_DELAYS_MS;
    this.#healthCheckIntervalMs = Math.max(0, options.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS);
    this.#healthCheckTimeoutMs = Math.max(1, options.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS);
    this.#circuitFailureThreshold = Math.max(1, options.circuitFailureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD);
    this.#circuitResetMs = Math.max(1, options.circuitResetMs ?? DEFAULT_CIRCUIT_RESET_MS);
  }

  #syncConfiguredRuntimes(): void {
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
          healthStatus: "unknown",
          lastHealthCheckAt: null,
          consecutiveFailureCount: 0,
          circuitState: "closed",
          circuitOpenedAt: null,
          reconnectTimer: null,
          generation: 0,
        });
      }
    }
  }

  async reconcile(): Promise<void> {
    this.#syncConfiguredRuntimes();

    const activeIds = new Set(this.#registry.list().map((config) => config.id));
    const removedIds = [...this.#runtimes.keys()].filter((id) => !activeIds.has(id));

    for (const id of removedIds) {
      const runtime = this.#runtimes.get(id);
      if (!runtime) continue;

      try {
        await this.#disconnectRuntimeForReconcile(id, runtime);
      } catch (error) {
        this.#logger.warn(
          "upstream",
          `reconcile failed for removed upstream ${runtime.config.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      this.#tools.removeServer(id);
      this.#runtimes.delete(id);
    }

    for (const runtime of this.#runtimes.values()) {
      if (!runtime.config.enabled && (runtime.client || runtime.desiredConnected || runtime.reconnectTimer)) {
        try {
          await this.disconnect(runtime.config.id);
        } catch (error) {
          this.#logger.warn(
            "upstream",
            `reconcile failed for disabled upstream ${runtime.config.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  list(): UpstreamSnapshot[] {
    const configs = this.#registry.list();
    return configs
      .map((config) => {
        const runtime = this.#runtimes.get(config.id);
        if (runtime) return this.#snapshot(runtime);
        return this.#snapshot({
          config,
          status: "configured",
          client: null,
          toolCount: 0,
          lastError: null,
          desiredConnected: false,
          reconnectAttempt: 0,
          nextRetryAt: null,
          healthStatus: "unknown",
          lastHealthCheckAt: null,
          consecutiveFailureCount: 0,
          circuitState: "closed",
          circuitOpenedAt: null,
          reconnectTimer: null,
          generation: 0,
        });
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async connect(id: string): Promise<UpstreamSnapshot> {
    this.#syncConfiguredRuntimes();
    const runtime = this.#requireRuntime(id);
    runtime.desiredConnected = true;
    this.#cancelReconnect(runtime, true);
    if (runtime.status !== "running") this.#resetCircuit(runtime);
    return this.#connectRuntime(runtime, false);
  }

  async disconnect(id: string): Promise<UpstreamSnapshot> {
    this.#syncConfiguredRuntimes();
    const runtime = this.#requireRuntime(id);

    // Invalidate an in-flight connect before checking the action lock. This is
    // important for config edits: the caller may intentionally ignore the
    // "action already in progress" result after requesting a stop, but the
    // in-flight connect must still become stale and clean itself up.
    runtime.desiredConnected = false;
    runtime.generation += 1;
    this.#cancelReconnect(runtime, true);

    if (this.#busy.has(id)) {
      const connecting = this.#connectOperations.get(id);
      if (connecting) {
        // A config change or explicit stop is a cancellation request for the
        // in-flight connect. Wait for the stale operation to finish cleaning
        // itself up, then perform the real disconnect if a client remains.
        await connecting.catch(() => undefined);
      }
      if (this.#busy.has(id)) {
        throw new Error("upstream action already in progress");
      }
    }

    this.#busy.add(id);
    runtime.status = "stopping";

    const client = runtime.client;

    try {
      if (client) {
        await client.disconnect();
      }
      runtime.client = null;
      runtime.toolCount = 0;
      this.#tools.removeServer(id);
      runtime.status = "stopped";
      runtime.lastError = null;
      this.#resetCircuit(runtime);
      this.#logger.info("upstream", `disconnected ${runtime.config.name}`);
      return this.#snapshot(runtime);
    } catch (error) {
      // Keep the client reference after a failed disconnect so a subsequent
      // stop/delete/config-change attempt can retry the actual close instead
      // of orphaning a live transport that the manager can no longer reach.
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
    this.#syncConfiguredRuntimes();
    const runtime = this.#requireRuntime(id);
    if (runtime.status !== "running" || !runtime.client) {
      throw new Error("upstream is not running");
    }

    const generation = runtime.generation;
    const client = runtime.client;
    const tools = await client.listTools();

    // Disconnect/reconnect or a config change may have invalidated this
    // refresh while the remote listTools request was in flight. Do not let
    // stale tools resurrect after the manager has already removed them.
    if (
      runtime.generation !== generation ||
      runtime.client !== client ||
      runtime.status !== "running" ||
      !runtime.desiredConnected
    ) {
      throw new Error("upstream refresh superseded");
    }

    const routes = this.#tools.replaceServerTools(
      runtime.config.id,
      runtime.config.alias,
      tools,
    );
    runtime.toolCount = routes.length;
    return this.#snapshot(runtime);
  }

  async callTool(
    publicName: string,
    args: unknown,
    context?: { source?: AuditSource },
  ): Promise<CallToolResult> {
    const route = this.#tools.resolve(publicName);
    if (!route) throw new Error("tool not found");

    const startedAt = Date.now();
    const source = context?.source ?? "gateway";

    const auditFailure = (error: unknown): void => {
      this.#audit?.record({
        source,
        publicName: route.publicName,
        serverId: route.serverId,
        serverAlias: route.serverAlias,
        originalName: route.originalName,
        success: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    };

    if (!route.enabled) {
      const error = new Error("tool is disabled");
      auditFailure(error);
      throw error;
    }

    const runtime = this.#requireRuntime(route.serverId);
    if (runtime.status !== "running" || !runtime.client) {
      const error = new Error("upstream is not running");
      auditFailure(error);
      throw error;
    }

    try {
      const result = await runtime.client.callTool(route.originalName, args);
      this.#audit?.record({
        source,
        publicName: route.publicName,
        serverId: route.serverId,
        serverAlias: route.serverAlias,
        originalName: route.originalName,
        success: true,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      auditFailure(error);
      throw error;
    }
  }

  startHealthMonitoring(): void {
    if (this.#healthTimer || this.#healthCheckIntervalMs <= 0) return;
    this.#healthTimer = setInterval(() => void this.#runHealthChecks(), this.#healthCheckIntervalMs);
    (this.#healthTimer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    this.#logger.info("upstream", `health monitoring enabled: interval=${this.#healthCheckIntervalMs}ms timeout=${this.#healthCheckTimeoutMs}ms`);
  }

  stopHealthMonitoring(): void {
    if (!this.#healthTimer) return;
    clearInterval(this.#healthTimer);
    this.#healthTimer = null;
  }

  async stopAll(): Promise<void> {
    this.stopHealthMonitoring();
    const ids = [...this.#runtimes.keys()];
    for (const id of ids) {
      try {
        await this.disconnect(id);
      } catch {
        // Best effort during shutdown.
      }
    }
  }

  async #disconnectRuntimeForReconcile(
    id: string,
    runtime: Runtime,
  ): Promise<void> {
    runtime.desiredConnected = false;
    runtime.generation += 1;
    this.#cancelReconnect(runtime, true);

    if (this.#busy.has(id)) {
      const connecting = this.#connectOperations.get(id);
      if (connecting) await connecting.catch(() => undefined);
      if (this.#busy.has(id)) {
        throw new Error("upstream action already in progress");
      }
    }

    const client = runtime.client;
    if (client) await client.disconnect();

    runtime.client = null;
    runtime.toolCount = 0;
    runtime.status = "stopped";
    runtime.lastError = null;
  }

  async #connectRuntime(
    runtime: Runtime,
    reconnecting: boolean,
  ): Promise<UpstreamSnapshot> {
    const id = runtime.config.id;
    const existing = this.#connectOperations.get(id);
    if (existing) return existing;

    const operation = this.#connectRuntimeInternal(runtime, reconnecting);
    this.#connectOperations.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.#connectOperations.get(id) === operation) {
        this.#connectOperations.delete(id);
      }
    }
  }

  async #connectRuntimeInternal(
    runtime: Runtime,
    reconnecting: boolean,
  ): Promise<UpstreamSnapshot> {
    const id = runtime.config.id;

    if (runtime.status === "running") return this.#snapshot(runtime);
    if (this.#busy.has(id)) throw new Error("upstream action already in progress");
    if (!runtime.config.enabled) throw new Error("upstream is disabled");

    // A failed disconnect keeps the client reference so it can be retried.
    // Never overwrite that still-owned client with a new connection attempt,
    // otherwise the old transport becomes orphaned.
    if (runtime.client) {
      throw new Error("upstream must be disconnected successfully before reconnecting");
    }

    this.#busy.add(id);
    runtime.status = "connecting";
    runtime.nextRetryAt = null;
    if (!reconnecting) runtime.lastError = null;

    const generation = runtime.generation + 1;
    runtime.generation = generation;
    const config = runtime.config;
    let retryAfterFailure = false;

    try {
      const client = await this.#factory(config);

      if (!this.#isConnectCurrent(runtime, generation)) {
        await client.disconnect().catch(() => undefined);
        throw new Error("upstream connect superseded");
      }

      runtime.client = client;

      client.setLifecycleHandlers?.({
        onError: (error) => {
          this.#handleClientError(id, generation, error);
        },
        onClose: () => {
          this.#handleClientClose(id, generation);
        },
        onNotificationStreamRecycled: () => {
          this.#handleNotificationStreamRecycled(id, generation);
        },
      });

      await client.connect();

      if (!this.#isConnectCurrent(runtime, generation)) {
        if (runtime.client === null) runtime.client = client;
        await client.disconnect();
        if (runtime.client === client) runtime.client = null;
        throw new Error("upstream connect superseded");
      }

      const tools = await client.listTools();

      if (!this.#isConnectCurrent(runtime, generation)) {
        if (runtime.client === client) {
          await client.disconnect();
          runtime.client = null;
        } else {
          await client.disconnect();
        }
        throw new Error("upstream connect superseded");
      }

      const routes = this.#tools.replaceServerTools(
        config.id,
        config.alias,
        tools,
      );

      if (!this.#isConnectCurrent(runtime, generation)) {
        if (runtime.client === client) {
          this.#tools.removeServer(id);
          await client.disconnect();
          runtime.client = null;
        } else {
          await client.disconnect();
        }
        throw new Error("upstream connect superseded");
      }

      runtime.toolCount = routes.length;
      runtime.status = "running";
      runtime.lastError = null;
      runtime.reconnectAttempt = 0;
      runtime.nextRetryAt = null;
      runtime.healthStatus = "healthy";
      runtime.lastHealthCheckAt = new Date().toISOString();
      runtime.consecutiveFailureCount = 0;
      runtime.circuitState = "closed";
      runtime.circuitOpenedAt = null;

      this.#logger.info(
        "upstream",
        `${reconnecting ? "reconnected" : "connected"} ${runtime.config.name} with ${routes.length} tool(s)`,
      );
      return this.#snapshot(runtime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // A newer generation owns this runtime now. Do not let an older connect
      // failure erase its status/tools or schedule a retry for it.
      if (runtime.generation !== generation) {
        if (!runtime.desiredConnected && !runtime.client) {
          runtime.status = "stopped";
          runtime.toolCount = 0;
          runtime.nextRetryAt = null;
          this.#tools.removeServer(id);
        }
        throw error;
      }

      runtime.lastError = message;
      runtime.status = "error";
      runtime.healthStatus = "unhealthy";
      runtime.consecutiveFailureCount += 1;
      runtime.toolCount = 0;
      this.#tools.removeServer(id);

      const client = runtime.client;
      if (client) {
        try {
          await client.disconnect();
          if (runtime.client === client) runtime.client = null;
        } catch (disconnectError) {
          runtime.client = client;
          this.#logger.warn(
            "upstream",
            `cleanup failed for ${runtime.config.name}: ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`,
          );
        }
      }

      if (reconnecting && runtime.consecutiveFailureCount >= this.#circuitFailureThreshold) {
        this.#openCircuit(runtime, `automatic recovery reached ${runtime.consecutiveFailureCount} consecutive failure(s)`);
      }

      retryAfterFailure =
        reconnecting &&
        runtime.desiredConnected &&
        runtime.config.enabled &&
        runtime.generation === generation &&
        runtime.circuitState !== "open";

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

  #handleNotificationStreamRecycled(id: string, generation: number): void {
    const runtime = this.#runtimes.get(id);
    if (!runtime || runtime.generation !== generation) return;
    if (runtime.status !== "running" || !runtime.desiredConnected) return;

    this.#logger.info(
      "upstream",
      `notification stream recycled for ${runtime.config.name}; transport reconnects it automatically`,
    );
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
    runtime.healthStatus = "unhealthy";
    runtime.toolCount = 0;
    runtime.lastError ??= "connection closed unexpectedly";
    runtime.consecutiveFailureCount += 1;
    this.#tools.removeServer(id);

    this.#logger.warn(
      "upstream",
      `connection lost: ${runtime.config.name}; automatic reconnect scheduled`,
    );
    this.#scheduleReconnect(runtime);
  }

  #isConnectCurrent(
    runtime: Runtime,
    generation: number,
  ): boolean {
    return (
      runtime.generation === generation &&
      runtime.desiredConnected &&
      runtime.config.enabled
    );
  }

  #scheduleReconnect(runtime: Runtime): void {
    if (
      runtime.reconnectTimer ||
      !runtime.desiredConnected ||
      !runtime.config.enabled
    ) {
      return;
    }

    if (runtime.circuitState === "open") return;
    if (
      runtime.circuitState === "half-open" ||
      runtime.consecutiveFailureCount >= this.#circuitFailureThreshold
    ) {
      this.#openCircuit(runtime, "automatic recovery circuit opened after repeated failures");
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

      const retry = () => this.#connectRuntime(runtime, true);
      void (this.#mutations
        ? this.#mutations.run(retry)
        : retry()
      ).catch(() => undefined);
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

  async #runHealthChecks(): Promise<void> {
    const checks = [...this.#runtimes.values()].filter(
      (runtime) =>
        runtime.status === "running" &&
        runtime.desiredConnected &&
        runtime.client?.healthCheck &&
        !this.#busy.has(runtime.config.id) &&
        !this.#healthInFlight.has(runtime.config.id),
    );

    await Promise.all(checks.map(async (runtime) => {
      const id = runtime.config.id;
      const generation = runtime.generation;
      const client = runtime.client;
      const healthCheck = client?.healthCheck;
      if (!client || !healthCheck) return;

      this.#healthInFlight.add(id);
      try {
        await healthCheck.call(client, this.#healthCheckTimeoutMs);
        if (
          runtime.generation !== generation ||
          runtime.client !== client ||
          runtime.status !== "running" ||
          !runtime.desiredConnected
        ) return;

        runtime.healthStatus = "healthy";
        runtime.lastHealthCheckAt = new Date().toISOString();
        runtime.consecutiveFailureCount = 0;
        runtime.lastError = null;
        runtime.circuitState = "closed";
        runtime.circuitOpenedAt = null;
      } catch (error) {
        if (
          runtime.generation !== generation ||
          runtime.client !== client ||
          runtime.status !== "running" ||
          !runtime.desiredConnected
        ) return;

        const message = error instanceof Error ? error.message : String(error);
        runtime.healthStatus = "unhealthy";
        runtime.lastHealthCheckAt = new Date().toISOString();
        runtime.lastError = message;
        runtime.consecutiveFailureCount += 1;
        this.#logger.warn("upstream", `health check failed for ${runtime.config.name}: ${message}`);

        if (runtime.consecutiveFailureCount >= this.#circuitFailureThreshold) {
          await this.#isolateUnhealthyRuntime(
            runtime,
            generation,
            client,
            `health check failed ${runtime.consecutiveFailureCount} consecutive time(s)`,
          );
        }
      } finally {
        this.#healthInFlight.delete(id);
      }
    }));
  }

  /**
   * Tear down a runtime that failed enough health checks to trip the circuit.
   * The disconnect mutates shared state (#busy, generation, tools), so it is
   * serialized through the global mutation queue instead of racing queued user
   * operations (a concurrent user disconnect would otherwise observe #busy
   * added by two owners and get its marker deleted early).
   */
  async #isolateUnhealthyRuntime(
    runtime: Runtime,
    generation: number,
    client: UpstreamClient,
    reason: string,
  ): Promise<void> {
    const id = runtime.config.id;

    const isolate = async (): Promise<void> => {
      // State may have moved on while this waited for the queue: a user
      // operation now owns the runtime (or already replaced the client), and
      // its own generation logic decides the outcome.
      if (
        this.#busy.has(id) ||
        runtime.generation !== generation ||
        runtime.client !== client ||
        runtime.status !== "running" ||
        !runtime.desiredConnected
      ) {
        return;
      }

      runtime.generation += 1;
      runtime.status = "stopping";
      this.#tools.removeServer(id);
      this.#busy.add(id);
      try {
        await client.disconnect();
        if (runtime.client === client) runtime.client = null;
      } catch (error) {
        runtime.client = client;
        this.#logger.warn("upstream", `failed to isolate unhealthy upstream ${runtime.config.name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.#busy.delete(id);
        runtime.toolCount = 0;
        runtime.status = "error";
        this.#openCircuit(runtime, reason);
      }
    };

    if (this.#mutations) {
      await this.#mutations.run(isolate).catch(() => undefined);
    } else {
      await isolate();
    }
  }

  #openCircuit(runtime: Runtime, reason: string): void {
    if (!runtime.desiredConnected || !runtime.config.enabled) return;

    runtime.circuitState = "open";
    runtime.circuitOpenedAt = new Date().toISOString();
    runtime.nextRetryAt = new Date(Date.now() + this.#circuitResetMs).toISOString();
    this.#logger.warn("upstream", `circuit opened for ${runtime.config.name}: ${reason}; recovery probe in ${this.#circuitResetMs}ms`);

    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    const timer = setTimeout(() => {
      runtime.reconnectTimer = null;
      runtime.nextRetryAt = null;
      if (!runtime.desiredConnected || !runtime.config.enabled) return;

      const recover = async (): Promise<void> => {
        if (runtime.client) {
          const retainedClient = runtime.client;
          try {
            await retainedClient.disconnect();
          } catch (error) {
            this.#logger.warn(
              "upstream",
              `circuit recovery cleanup failed for ${runtime.config.name}: ${error instanceof Error ? error.message : String(error)}`,
            );
            this.#openCircuit(runtime, "retained client could not be closed");
            return;
          }

          if (runtime.client === retainedClient) {
            runtime.client = null;
          }
          runtime.toolCount = 0;
          this.#tools.removeServer(runtime.config.id);
        }

        if (!runtime.desiredConnected || !runtime.config.enabled) return;

        runtime.circuitState = "half-open";
        this.#logger.info(
          "upstream",
          `circuit half-open for ${runtime.config.name}; starting recovery probe`,
        );
        await this.#connectRuntime(runtime, true);
      };

      const operation = this.#mutations
        ? this.#mutations.run(recover)
        : recover();
      void operation.catch(() => undefined);
    }, this.#circuitResetMs);

    runtime.reconnectTimer = timer;
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  #resetCircuit(runtime: Runtime): void {
    runtime.circuitState = "closed";
    runtime.circuitOpenedAt = null;
    runtime.consecutiveFailureCount = 0;
    runtime.healthStatus = "unknown";
    runtime.lastHealthCheckAt = null;
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
      healthStatus: runtime.healthStatus,
      lastHealthCheckAt: runtime.lastHealthCheckAt,
      consecutiveFailureCount: runtime.consecutiveFailureCount,
      circuitState: runtime.circuitState,
      circuitOpenedAt: runtime.circuitOpenedAt,
    };
  }
}
