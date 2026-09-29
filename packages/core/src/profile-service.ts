import type { McpServerConfig, ServerRegistry } from "./server-registry.ts";
import type { McpProfile, ProfileStore } from "./profile-store.ts";
import type { UpstreamManager, ProfileApplyResult } from "./upstream-manager.ts";

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
  #upstreams: UpstreamManager;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(
    store: ProfileStore,
    registry: ServerRegistry,
    upstreams: UpstreamManager,
  ) {
    this.#store = store;
    this.#registry = registry;
    this.#upstreams = upstreams;
  }

  list(): McpProfile[] {
    return this.#store.list();
  }

  get activeProfileId(): string | null {
    return this.#store.activeProfileId;
  }

  async create(name: string, serverIds: string[]): Promise<McpProfile> {
    return this.#serialize(async () => {
      this.#assertKnownServers(serverIds);
      return this.#store.create(name, serverIds);
    });
  }

  async update(
    id: string,
    input: { name: string; serverIds: string[] },
  ): Promise<ProfileMutationOutcome> {
    return this.#serialize(async () => {
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

      const result = await this.#upstreams.applyExactSet(input.serverIds);
      if (result.failed.length > 0) {
        const rollback = await this.#upstreams.applyExactSet(previous.serverIds);
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
        const rollback = await this.#upstreams.applyExactSet(previous.serverIds);
        throw new Error(
          `profile update persisted failed: ${error instanceof Error ? error.message : String(error)}; runtime rollback failed/succeeded with ${rollback.failed.length} failure(s)`,
        );
      }
    });
  }

  async activate(id: string): Promise<ProfileMutationOutcome> {
    return this.#serialize(async () => {
      const profile = this.#store.get(id);
      if (!profile) throw new Error("profile not found");

      const previousActiveProfileId = this.#store.activeProfileId;
      const previousActiveProfile =
        previousActiveProfileId && previousActiveProfileId !== id
          ? this.#store.get(previousActiveProfileId)
          : null;

      const result = await this.#upstreams.applyExactSet(profile.serverIds);
      if (result.failed.length > 0) {
        const rollback = previousActiveProfile
          ? await this.#upstreams.applyExactSet(previousActiveProfile.serverIds)
          : await this.#upstreams.applyExactSet([]);
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
        const rollback = previousActiveProfile
          ? await this.#upstreams.applyExactSet(previousActiveProfile.serverIds)
          : await this.#upstreams.applyExactSet([]);
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
    return this.#serialize(async () => {
      const profile = this.#store.get(id);
      if (!profile) throw new Error("profile not found");

      const wasActive = this.#store.activeProfileId === id;
      const result = await this.#upstreams.disconnectSet(profile.serverIds);

      if (wasActive && result.failed.length > 0) {
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
          const rollback = await this.#upstreams.applyExactSet(profile.serverIds);
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
    return this.#serialize(async () => {
      const profile = this.#store.get(id);
      if (!profile) throw new Error("profile not found");

      const wasActive = this.#store.activeProfileId === id;
      const result = wasActive
        ? await this.#upstreams.disconnectSet(profile.serverIds)
        : undefined;

      if (wasActive && result && result.failed.length > 0) {
        return {
          ok: false,
          profile,
          activeProfileId: this.#store.activeProfileId,
          result,
        };
      }

      const removed = await this.#store.remove(id);
      if (!removed) throw new Error("profile not found");

      return {
        ok: true,
        profile,
        activeProfileId: this.#store.activeProfileId,
        ...(result ? { result } : {}),
      };
    });
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release!: () => void;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
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
