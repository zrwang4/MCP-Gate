import type { ServerRegistry } from "./server-registry.ts";
import type { McpProfile, ProfileStore } from "./profile-store.ts";
import type { ProfileApplyResult } from "./upstream-manager.ts";
import type { RuntimeReconciler } from "./runtime-reconciler.ts";
import type { MutationQueue } from "./mutation-queue.ts";

export interface ProfileMutationOutcome {
  ok: boolean;
  profile: McpProfile;
  activeProfileId: string | null;
  result?: ProfileApplyResult;
  rollback?: ProfileApplyResult | null;
}

export class ProfileService {
  #store: ProfileStore;
  #registry: ServerRegistry;
  #reconciler: RuntimeReconciler;
  #mutations: MutationQueue;

  constructor(
    store: ProfileStore,
    registry: ServerRegistry,
    reconciler: RuntimeReconciler,
    mutations: MutationQueue,
  ) {
    this.#store = store;
    this.#registry = registry;
    this.#reconciler = reconciler;
    this.#mutations = mutations;
  }

  list(): McpProfile[] {
    return this.#store.list();
  }

  get activeProfileId(): string | null {
    return this.#store.activeProfileId;
  }

  async create(name: string, serverIds: string[]): Promise<McpProfile> {
    return this.#mutations.run(async () => {
      this.#assertKnownServers(serverIds);
      return this.#store.create(name, serverIds);
    });
  }

  async update(
    id: string,
    input: { name: string; serverIds: string[] },
  ): Promise<ProfileMutationOutcome> {
    return this.#mutations.run(async () => {
      const previous = this.#store.get(id);
      if (!previous) throw new Error("profile not found");
      this.#assertKnownServers(input.serverIds);

      const wasActive = this.#store.activeProfileId === id;
      if (!wasActive) {
        const profile = await this.#store.update(id, input);
        if (!profile) throw new Error("profile not found");
        return {
          ok: true,
          profile,
          activeProfileId: this.#store.activeProfileId,
        };
      }

      const previousTargets = this.#reconciler.connectionTargets();
      const result = await this.#reconciler.applyExactSet(input.serverIds);
      if (result.failed.length > 0) {
        const rollback = await this.#reconciler.applyExactSet(previousTargets);
        return {
          ok: false,
          profile: previous,
          activeProfileId: this.#store.activeProfileId,
          result,
          rollback,
        };
      }

      try {
        const profile = await this.#store.update(id, input);
        if (!profile) throw new Error("profile not found");
        return {
          ok: true,
          profile,
          activeProfileId: this.#store.activeProfileId,
          result,
        };
      } catch (error) {
        const rollback = await this.#reconciler.applyExactSet(previousTargets);
        throw new Error(
          `profile update persisted failed: ${error instanceof Error ? error.message : String(error)}; runtime rollback failed/succeeded with ${rollback.failed.length} failure(s)`,
        );
      }
    });
  }

  async activate(id: string): Promise<ProfileMutationOutcome> {
    return this.#mutations.run(async () => {
      const profile = this.#store.get(id);
      if (!profile) throw new Error("profile not found");

      const previousActiveProfileId = this.#store.activeProfileId;
      const previousTargets = this.#reconciler.connectionTargets();

      const result = await this.#reconciler.applyExactSet(profile.serverIds);
      if (result.failed.length > 0) {
        const rollback = await this.#reconciler.applyExactSet(previousTargets);
        return {
          ok: false,
          profile,
          activeProfileId: previousActiveProfileId,
          result,
          rollback,
        };
      }

      try {
        await this.#store.setActive(id);
      } catch (error) {
        const rollback = await this.#reconciler.applyExactSet(previousTargets);
        throw new Error(
          `profile activation persistence failed: ${error instanceof Error ? error.message : String(error)}; runtime rollback failures=${rollback.failed.length}`,
        );
      }

      return {
        ok: true,
        profile,
        activeProfileId: this.#store.activeProfileId,
        result,
      };
    });
  }

  async deactivate(id: string): Promise<ProfileMutationOutcome> {
    return this.#mutations.run(async () => {
      const profile = this.#store.get(id);
      if (!profile) throw new Error("profile not found");

      const wasActive = this.#store.activeProfileId === id;
      if (!wasActive) {
        return {
          ok: true,
          profile,
          activeProfileId: this.#store.activeProfileId,
          result: {
            connected: [],
            disconnected: [],
            alreadyRunning: [],
            failed: [],
          },
        };
      }

      const result = await this.#reconciler.disconnectSet(profile.serverIds);

      if (result.failed.length > 0) {
        return {
          ok: false,
          profile,
          activeProfileId: this.#store.activeProfileId,
          result,
        };
      }

      if (wasActive) {
        try {
          await this.#store.setActive(null);
        } catch (error) {
          const rollback = await this.#reconciler.applyExactSet(profile.serverIds);
          throw new Error(
            `profile deactivation persistence failed: ${error instanceof Error ? error.message : String(error)}; runtime rollback failures=${rollback.failed.length}`,
          );
        }
      }

      return {
        ok: true,
        profile,
        activeProfileId: this.#store.activeProfileId,
        result,
      };
    });
  }

  async remove(id: string): Promise<ProfileMutationOutcome> {
    return this.#mutations.run(async () => {
      const profile = this.#store.get(id);
      if (!profile) throw new Error("profile not found");

      const wasActive = this.#store.activeProfileId === id;
      const result = wasActive
        ? await this.#reconciler.disconnectSet(profile.serverIds)
        : undefined;

      if (wasActive && result && result.failed.length > 0) {
        return {
          ok: false,
          profile,
          activeProfileId: this.#store.activeProfileId,
          result,
        };
      }

      try {
        const removed = await this.#store.remove(id);
        if (!removed) throw new Error("profile not found");
      } catch (error) {
        if (wasActive) {
          const rollback = await this.#reconciler.applyExactSet(profile.serverIds);
          if (rollback.failed.length > 0) {
            throw new Error(
              `profile deletion failed: ${error instanceof Error ? error.message : String(error)}; runtime rollback failures=${rollback.failed.length}`,
            );
          }
        }
        throw error;
      }

      return {
        ok: true,
        profile,
        activeProfileId: this.#store.activeProfileId,
        ...(result ? { result } : {}),
      };
    });
  }

  #assertKnownServers(serverIds: string[]): void {
    if (!Array.isArray(serverIds)) {
      throw new Error("serverIds must be an array");
    }
    if (serverIds.length > 100) {
      throw new Error("too many servers in profile");
    }

    const known = new Set(this.#registry.list().map((server) => server.id));
    const seen = new Set<string>();
    for (const rawId of serverIds) {
      if (typeof rawId !== "string" || !rawId.trim()) {
        throw new Error("serverIds must contain non-empty strings");
      }
      const id = rawId.trim();
      if (seen.has(id)) throw new Error(`duplicate server id: ${id}`);
      seen.add(id);
      if (!known.has(id)) {
        throw new Error(`unknown server id(s): ${id}`);
      }
    }
  }
}
