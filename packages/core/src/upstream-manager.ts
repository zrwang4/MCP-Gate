import type { CoreLogger } from "./logger.ts";
import type { ServerRegistry, StdioServerConfig } from "./server-registry.ts";
import type { McpToolDefinition, ToolRegistry } from "./tool-registry.ts";

export type UpstreamStatus =
  | "configured"
  | "connecting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export interface UpstreamClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
}

export type UpstreamFactory = (
  config: StdioServerConfig,
) => Promise<UpstreamClient> | UpstreamClient;

export interface UpstreamSnapshot {
  id: string;
  name: string;
  alias: string;
  status: UpstreamStatus;
  toolCount: number;
  lastError: string | null;
}

interface Runtime {
  config: StdioServerConfig;
  status: UpstreamStatus;
  client: UpstreamClient | null;
  toolCount: number;
  lastError: string | null;
}

export class UpstreamManager {
  #registry: ServerRegistry;
  #tools: ToolRegistry;
  #factory: UpstreamFactory;
  #logger: CoreLogger;
  #runtimes = new Map<string, Runtime>();
  #busy = new Set<string>();

  constructor(
    registry: ServerRegistry,
    tools: ToolRegistry,
    factory: UpstreamFactory,
    logger: CoreLogger,
  ) {
    this.#registry = registry;
    this.#tools = tools;
    this.#factory = factory;
    this.#logger = logger;
  }

  syncConfigs(): void {
    const configs = this.#registry.list();
    const activeIds = new Set(configs.map((config) => config.id));

    for (const config of configs) {
      const runtime = this.#runtimes.get(config.id);
      if (runtime) {
        runtime.config = config;
      } else {
        this.#runtimes.set(config.id, {
          config,
          status: "configured",
          client: null,
          toolCount: 0,
          lastError: null,
        });
      }
    }

    for (const [id, runtime] of this.#runtimes) {
      if (!activeIds.has(id)) {
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
      .map((runtime) => ({
        id: runtime.config.id,
        name: runtime.config.name,
        alias: runtime.config.alias,
        status: runtime.status,
        toolCount: runtime.toolCount,
        lastError: runtime.lastError,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async connect(id: string): Promise<UpstreamSnapshot> {
    this.syncConfigs();
    const runtime = this.#requireRuntime(id);
    if (runtime.status === "running") return this.#snapshot(runtime);
    if (this.#busy.has(id)) throw new Error("upstream action already in progress");
    if (!runtime.config.enabled) throw new Error("upstream is disabled");

    this.#busy.add(id);
    runtime.status = "connecting";
    runtime.lastError = null;

    try {
      const client = await this.#factory(runtime.config);
      runtime.client = client;
      await client.connect();
      const tools = await client.listTools();
      const routes = this.#tools.replaceServerTools(
        runtime.config.id,
        runtime.config.alias,
        tools,
      );
      runtime.toolCount = routes.length;
      runtime.status = "running";
      this.#logger.info(
        "upstream",
        `connected ${runtime.config.name} with ${routes.length} tool(s)`,
      );
      return this.#snapshot(runtime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.lastError = message;
      runtime.status = "error";
      runtime.toolCount = 0;
      this.#tools.removeServer(id);
      if (runtime.client) {
        await runtime.client.disconnect().catch(() => undefined);
        runtime.client = null;
      }
      this.#logger.error("upstream", `${runtime.config.name}: ${message}`);
      throw error;
    } finally {
      this.#busy.delete(id);
    }
  }

  async disconnect(id: string): Promise<UpstreamSnapshot> {
    this.syncConfigs();
    const runtime = this.#requireRuntime(id);
    if (this.#busy.has(id)) throw new Error("upstream action already in progress");

    this.#busy.add(id);
    runtime.status = "stopping";
    try {
      if (runtime.client) {
        await runtime.client.disconnect();
      }
      runtime.client = null;
      runtime.status = "stopped";
      runtime.toolCount = 0;
      runtime.lastError = null;
      this.#tools.removeServer(id);
      this.#logger.info("upstream", `disconnected ${runtime.config.name}`);
      return this.#snapshot(runtime);
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

  async callTool(publicName: string, args: unknown): Promise<unknown> {
    const route = this.#tools.resolve(publicName);
    if (!route) throw new Error("tool not found");
    if (!route.enabled) throw new Error("tool is disabled");

    const runtime = this.#requireRuntime(route.serverId);
    if (runtime.status !== "running" || !runtime.client) {
      throw new Error("upstream is not running");
    }

    return runtime.client.callTool(route.originalName, args);
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
      status: runtime.status,
      toolCount: runtime.toolCount,
      lastError: runtime.lastError,
    };
  }
}
