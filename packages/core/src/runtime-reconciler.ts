import type { ServerRegistry } from "./server-registry.ts";
import type {
  ProfileApplyResult,
  UpstreamManager,
} from "./upstream-manager.ts";

export class RuntimeReconciler {
  #registry: ServerRegistry;
  #upstreams: UpstreamManager;

  constructor(registry: ServerRegistry, upstreams: UpstreamManager) {
    this.#registry = registry;
    this.#upstreams = upstreams;
  }

  async reconcile(): Promise<void> {
    await this.#upstreams.reconcile();
  }

  connectionTargets(): string[] {
    return this.#upstreams.connectionTargets();
  }

  async applyExactSet(serverIds: string[]): Promise<ProfileApplyResult> {
    await this.#upstreams.reconcile();

    const desired = new Set(serverIds);
    const knownIds = new Set(this.#registry.list().map((config) => config.id));
    const result: ProfileApplyResult = {
      connected: [],
      disconnected: [],
      alreadyRunning: [],
      failed: [],
    };

    for (const serverId of desired) {
      if (!knownIds.has(serverId)) {
        result.failed.push({
          serverId,
          error: "server configuration not found",
        });
      }
    }

    const runtimes = this.#upstreams.list();
    for (const runtime of runtimes) {
      if (desired.has(runtime.id)) continue;
      if (
        runtime.status === "configured" ||
        runtime.status === "stopped"
      ) {
        continue;
      }

      try {
        await this.#upstreams.disconnect(runtime.id);
        result.disconnected.push(runtime.id);
      } catch (error) {
        result.failed.push({
          serverId: runtime.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const serverId of desired) {
      const runtime = this.#upstreams
        .list()
        .find((item) => item.id === serverId);
      if (!runtime) continue;

      if (runtime.status === "running") {
        result.alreadyRunning.push(serverId);
        continue;
      }

      const config = this.#registry.get(serverId);
      if (!config) {
        result.failed.push({
          serverId,
          error: "server configuration not found",
        });
        continue;
      }

      if (!config.enabled) {
        result.failed.push({
          serverId,
          error: "server is disabled",
        });
        continue;
      }

      try {
        await this.#upstreams.connect(serverId);
        result.connected.push(serverId);
      } catch (error) {
        result.failed.push({
          serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  async disconnectSet(serverIds: string[]): Promise<ProfileApplyResult> {
    await this.#upstreams.reconcile();

    const result: ProfileApplyResult = {
      connected: [],
      disconnected: [],
      alreadyRunning: [],
      failed: [],
    };

    for (const serverId of new Set(serverIds)) {
      const runtime = this.#upstreams
        .list()
        .find((item) => item.id === serverId);
      if (!runtime) {
        result.failed.push({
          serverId,
          error: "server configuration not found",
        });
        continue;
      }

      if (runtime.status === "configured" || runtime.status === "stopped") {
        continue;
      }

      try {
        await this.#upstreams.disconnect(serverId);
        result.disconnected.push(serverId);
      } catch (error) {
        result.failed.push({
          serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  async connectAutoStart(): Promise<void> {
    await this.#upstreams.reconcile();

    const ids = this.#registry
      .list()
      .filter((config) => config.enabled && config.autoStart)
      .map((config) => config.id);

    await Promise.allSettled(
      ids.map((id) => this.#upstreams.connect(id)),
    );
  }
}
