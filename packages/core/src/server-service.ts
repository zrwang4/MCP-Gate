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
import type { MutationQueue } from "./mutation-queue.ts";
import type { RuntimeReconciler } from "./runtime-reconciler.ts";
import { validateEnvironment } from "./server-registry.ts";

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
  #mutations: MutationQueue;
  #reconciler: RuntimeReconciler;

  constructor(
    registry: ServerRegistry,
    profiles: ProfileStore,
    upstreams: UpstreamManager,
    toolPolicy: ToolPolicyStore,
    secrets: SecretStore,
    logger: CoreLogger,
    mutations: MutationQueue,
    reconciler: RuntimeReconciler,
  ) {
    this.#registry = registry;
    this.#profiles = profiles;
    this.#upstreams = upstreams;
    this.#toolPolicy = toolPolicy;
    this.#secrets = secrets;
    this.#logger = logger;
    this.#mutations = mutations;
    this.#reconciler = reconciler;
  }

  async create(
    input: Omit<ServerConfigInput, "environment"> & {
      authorization?: string;
      environment?: EnvironmentMutationInput;
    },
  ): Promise<McpServerConfig> {
    return this.#mutations.run(async () => {
    let createdSecretId: string | null = null;
    const createdEnvSecrets: string[] = [];

    try {
      const authorization = input.authorization?.trim();
      if (input.transport === "http" && authorization) {
        createdSecretId = "http-auth:" + randomUUID();
        await this.#secrets.set(createdSecretId, authorization);
      }

      const server = await this.#registry.create({
        ...input,
        authSecretId: createdSecretId ?? undefined,
        environment: input.environment
          ? await this.#prepareEnvironment(input.transport ?? "stdio", input.environment, {}, createdEnvSecrets)
          : undefined,
      });
      return server;
    } catch (error) {
      if (createdSecretId) {
        await this.#secrets.delete(createdSecretId).catch(() => false);
      }
      await this.#deleteSecrets(createdEnvSecrets);
      throw error;
    }
    });
  }

  async update(
    id: string,
    input: Omit<ServerConfigInput, "environment"> & {
      authorization?: string;
      clearAuthorization?: boolean;
      headersProvided?: boolean;
      environment?: EnvironmentMutationInput;
    },
  ): Promise<ServerMutationResult> {
    return this.#mutations.run(async () => {
      const existing = this.#requireServer(id);
    const wasRunning = this.#isRunning(id);

    let createdSecretId: string | null = null;
    const createdEnvSecrets: string[] = [];
    let oldHttpSecretId =
      existing.transport === "http" ? existing.authSecretId ?? null : null;

    try {
      const transport = input.transport ?? existing.transport;
      const environment = input.environment
        ? await this.#prepareEnvironment(
            transport, input.environment,
            existing.transport === "stdio" ? existing.envSecretIds ?? {} : {},
            createdEnvSecrets,
          )
        : undefined;
      await this.#upstreams.disconnect(id);
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

      const registryInput: ServerConfigInput = {
        name: input.name,
        transport,
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        url: input.url,
        ...(input.headersProvided ? { headers: input.headers } : {}),
        authSecretId,
        environment,
      };

      const updated = await this.#registry.update(id, registryInput);

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
      if (existing.transport === "stdio" && environment) {
        const retained = new Set(Object.values(environment.envSecretIds));
        await this.#deleteSecrets(
          Object.values(existing.envSecretIds ?? {}).filter((secretId) => !retained.has(secretId)),
        );
      }


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
      await this.#deleteSecrets(createdEnvSecrets);

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
    });
  }

  async updateEnvironment(
    id: string,
    input: EnvironmentMutationInput,
  ): Promise<ServerMutationResult> {
    return this.#mutations.run(async () => {
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
    });
  }

  async updateSettings(
    id: string,
    input: { enabled?: boolean; autoStart?: boolean },
  ): Promise<McpServerConfig> {
    return this.#mutations.run(async () => {
      const existing = this.#requireServer(id);
      const wasRunning = this.#isRunning(id);

      if (input.enabled === false) {
        await this.#upstreams.disconnect(id);
      }

      try {
        const updated = await this.#registry.updateSettings(id, input);
        if (!updated) throw new Error("server configuration not found");

        return updated;
      } catch (error) {
        if (wasRunning && existing.enabled) {
          try {
            await this.#upstreams.connect(id);
          } catch (restoreError) {
            this.#logger.warn(
              "servers",
              `failed to restore ${existing.name} after settings error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            );
          }
        }
        throw error;
      }
    });
  }

  async remove(id: string): Promise<void> {
    return this.#mutations.run(async () => {
      const existing = this.#requireServer(id);
      const wasRunning = this.#isRunning(id);
      await this.#upstreams.disconnect(id);

      try {
        const removed = await this.#registry.remove(id);
        if (!removed) throw new Error("server configuration not found");
      } catch (error) {
        if (wasRunning && existing.enabled) {
          try {
            await this.#upstreams.connect(id);
          } catch (restoreError) {
            this.#logger.warn(
              "servers",
              `failed to restore ${existing.name} after delete failure: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            );
          }
        }
        throw error;
      }

      await this.#toolPolicy.removeServer(id);
      await this.#profiles.removeServer(id);
      await this.#reconciler.reconcile();

      if (existing.transport === "http" && existing.authSecretId) {
        await this.#secrets.delete(existing.authSecretId).catch(() => false);
      }

      if (existing.transport === "stdio") {
        for (const secretId of Object.values(existing.envSecretIds ?? {})) {
          await this.#secrets.delete(secretId).catch(() => false);
        }
      }
    });
  }

  #requireServer(id: string): McpServerConfig {
    const server = this.#registry.get(id);
    if (!server) throw new Error("server configuration not found");
    return server;
  }

  async #deleteSecrets(ids: string[]): Promise<void> {
    for (const id of ids) await this.#secrets.delete(id).catch(() => false);
  }

  async #prepareEnvironment(
    transport: "stdio" | "http",
    input: EnvironmentMutationInput,
    oldSecretIds: Record<string, string>,
    createdIds: string[],
  ): Promise<NonNullable<ServerConfigInput["environment"]>> {
    if (transport !== "stdio") throw new Error("environment is only available for stdio servers");
    const env = validateEnvironment(input.env);
    const supplied = validateEnvironment(input.secretEnv);
    const keys = new Set(input.secretEnvKeys);
    validateEnvironment(Object.fromEntries([...keys].map((key) => [key, ""])));
    for (const key of Object.keys(env)) {
      if (keys.has(key)) throw new Error(`environment variable ${key} cannot be both plain and secret`);
    }
    for (const key of Object.keys(supplied)) {
      if (!keys.has(key)) throw new Error(`secret value supplied for unlisted key: ${key}`);
    }
    for (const key of keys) {
      if (!supplied[key] && !oldSecretIds[key]) {
        throw new Error(`secret environment value is required for ${key}`);
      }
    }
    const envSecretIds: Record<string, string> = {};
    for (const key of keys) {
      if (supplied[key]) {
        const id = "stdio-env:" + randomUUID();
        await this.#secrets.set(id, supplied[key]);
        createdIds.push(id);
        envSecretIds[key] = id;
      } else {
        envSecretIds[key] = oldSecretIds[key];
      }
    }
    return { env, envSecretIds };
  }

  #isRunning(id: string): boolean {
    return this.#upstreams.list().some(
      (upstream) => upstream.id === id && upstream.status === "running",
    );
  }
}
