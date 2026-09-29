import { randomUUID } from "node:crypto";
import type { CoreLogger } from "./logger.ts";
import type {
  McpServerConfig,
  ServerConfigInput,
  ServerRegistry,
} from "./server-registry.ts";
import type { ProfileStore } from "./profile-store.ts";
import type { SecretStore } from "./secret-store.ts";
import type { ToolPolicyStore } from "./tool-policy-store.ts";
import type { UpstreamManager } from "./upstream-manager.ts";

export interface EnvironmentMutationInput {
  env: Record<string, string>;
  secretEnvKeys: string[];
  secretEnv: Record<string, string>;
}

export interface ServerMutationResult {
  server: McpServerConfig;
  reconnectError?: string;
}

export class ServerService {
  #registry: ServerRegistry;
  #profiles: ProfileStore;
  #upstreams: UpstreamManager;
  #toolPolicy: ToolPolicyStore;
  #secrets: SecretStore;
  #logger: CoreLogger;

  constructor(
    registry: ServerRegistry,
    profiles: ProfileStore,
    upstreams: UpstreamManager,
    toolPolicy: ToolPolicyStore,
    secrets: SecretStore,
    logger: CoreLogger,
  ) {
    this.#registry = registry;
    this.#profiles = profiles;
    this.#upstreams = upstreams;
    this.#toolPolicy = toolPolicy;
    this.#secrets = secrets;
    this.#logger = logger;
  }

  async create(
    input: ServerConfigInput & { authorization?: string },
  ): Promise<McpServerConfig> {
    let createdSecretId: string | null = null;

    try {
      const authorization = input.authorization?.trim();
      if (input.transport === "http" && authorization) {
        createdSecretId = "http-auth:" + randomUUID();
        await this.#secrets.set(createdSecretId, authorization);
      }

      const server = await this.#registry.create({
        ...input,
        authSecretId: createdSecretId ?? undefined,
      });
      await this.#upstreams.reconcile();
      return server;
    } catch (error) {
      if (createdSecretId) {
        await this.#secrets.delete(createdSecretId).catch(() => false);
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: ServerConfigInput & {
      authorization?: string;
      clearAuthorization?: boolean;
      headersProvided?: boolean;
    },
  ): Promise<ServerMutationResult> {
    const existing = this.#requireServer(id);
    const wasRunning = this.#isRunning(id);

    let createdSecretId: string | null = null;
    let oldHttpSecretId =
      existing.transport === "http" ? existing.authSecretId ?? null : null;

    try {
      await this.#upstreams.disconnect(id);

      const transport = input.transport ?? existing.transport;
      const authorization = input.authorization?.trim();
      let authSecretId: string | null | undefined;

      if (transport === "http") {
        if (authorization) {
          createdSecretId = "http-auth:" + randomUUID();
          await this.#secrets.set(createdSecretId, authorization);
          authSecretId = createdSecretId;
        } else if (input.clearAuthorization) {
          authSecretId = null;
        } else if (existing.transport === "http") {
          authSecretId = existing.authSecretId;
          oldHttpSecretId = null;
        }
      } else {
        authSecretId = null;
      }

      const updated = await this.#registry.update(id, {
        ...input,
        transport,
        ...(input.headersProvided ? { headers: input.headers } : {}),
        authSecretId,
      });

      if (!updated) throw new Error("server configuration not found");

      if (
        oldHttpSecretId &&
        oldHttpSecretId !== createdSecretId
      ) {
        await this.#secrets.delete(oldHttpSecretId).catch(() => false);
      }

      if (existing.transport === "stdio" && updated.transport !== "stdio") {
        for (const secretId of Object.values(existing.envSecretIds ?? {})) {
          await this.#secrets.delete(secretId).catch(() => false);
        }
      }

      await this.#upstreams.reconcile();

      if (wasRunning && updated.enabled) {
        try {
          await this.#upstreams.connect(id);
        } catch (error) {
          return {
            server: updated,
            reconnectError:
              error instanceof Error ? error.message : String(error),
          };
        }
      }

      return { server: updated };
    } catch (error) {
      if (createdSecretId) {
        await this.#secrets.delete(createdSecretId).catch(() => false);
      }

      if (wasRunning && existing.enabled) {
        try {
          await this.#upstreams.connect(id);
        } catch (restoreError) {
          this.#logger.warn(
            "servers",
            `failed to restore ${existing.name} after configuration error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
          );
        }
      }

      throw error;
    }
  }

  async updateEnvironment(
    id: string,
    input: EnvironmentMutationInput,
  ): Promise<ServerMutationResult> {
    const existing = this.#requireServer(id);
    if (existing.transport !== "stdio") {
      throw new Error("environment is only available for stdio servers");
    }

    const wasRunning = this.#isRunning(id);
    const oldSecretIds = existing.envSecretIds ?? {};
    const createdSecretIds: string[] = [];

    try {
      for (const key of Object.keys(input.env)) {
        if (input.secretEnvKeys.includes(key)) {
          throw new Error(
            `environment variable ${key} cannot be both plain and secret`,
          );
        }
      }
      for (const key of Object.keys(input.secretEnv)) {
        if (!input.secretEnvKeys.includes(key)) {
          throw new Error(
            `secret value supplied for unlisted key: ${key}`,
          );
        }
      }

      await this.#upstreams.disconnect(id);

      const nextSecretIds: Record<string, string> = {};
      for (const key of input.secretEnvKeys) {
        const suppliedValue = input.secretEnv[key];
        if (suppliedValue !== undefined && suppliedValue !== "") {
          const secretId = "stdio-env:" + randomUUID();
          await this.#secrets.set(secretId, suppliedValue);
          createdSecretIds.push(secretId);
          nextSecretIds[key] = secretId;
          continue;
        }

        const existingSecretId = oldSecretIds[key];
        if (!existingSecretId) {
          throw new Error(
            `secret environment value is required for ${key}`,
          );
        }
        nextSecretIds[key] = existingSecretId;
      }

      const updated = await this.#registry.updateEnvironment(id, {
        env: input.env,
        envSecretIds: nextSecretIds,
      });
      if (!updated) throw new Error("server configuration not found");

      const retainedIds = new Set(Object.values(nextSecretIds));
      for (const oldSecretId of Object.values(oldSecretIds)) {
        if (!retainedIds.has(oldSecretId)) {
          await this.#secrets.delete(oldSecretId).catch(() => false);
        }
      }

      await this.#upstreams.reconcile();

      if (wasRunning && updated.enabled) {
        try {
          await this.#upstreams.connect(id);
        } catch (error) {
          return {
            server: updated,
            reconnectError:
              error instanceof Error ? error.message : String(error),
          };
        }
      }

      return { server: updated };
    } catch (error) {
      for (const secretId of createdSecretIds) {
        await this.#secrets.delete(secretId).catch(() => false);
      }

      if (wasRunning && existing.enabled) {
        try {
          await this.#upstreams.connect(id);
        } catch (restoreError) {
          this.#logger.warn(
            "servers",
            `failed to restore ${existing.name} after environment error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
          );
        }
      }

      throw error;
    }
  }

  async updateSettings(
    id: string,
    input: { enabled?: boolean; autoStart?: boolean },
  ): Promise<McpServerConfig> {
    const existing = this.#requireServer(id);
    if (input.enabled === false) {
      await this.#upstreams.disconnect(id);
    }

    const updated = await this.#registry.updateSettings(id, input);
    if (!updated) throw new Error("server configuration not found");

    await this.#upstreams.reconcile();
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = this.#requireServer(id);
    await this.#upstreams.disconnect(id);

    const removed = await this.#registry.remove(id);
    if (!removed) throw new Error("server configuration not found");

    await this.#toolPolicy.removeServer(id);
    await this.#profiles.removeServer(id);
    await this.#upstreams.reconcile();

    if (existing.transport === "http" && existing.authSecretId) {
      await this.#secrets.delete(existing.authSecretId).catch(() => false);
    }

    if (existing.transport === "stdio") {
      for (const secretId of Object.values(existing.envSecretIds ?? {})) {
        await this.#secrets.delete(secretId).catch(() => false);
      }
    }
  }

  #requireServer(id: string): McpServerConfig {
    const server = this.#registry.get(id);
    if (!server) throw new Error("server configuration not found");
    return server;
  }

  #isRunning(id: string): boolean {
    return this.#upstreams.list().some(
      (upstream) => upstream.id === id && upstream.status === "running",
    );
  }
}
