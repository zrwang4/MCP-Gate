import { randomUUID } from "node:crypto";
import { readOptionalHeaders } from "./http-headers.ts";
import {
  json,
  readJsonBody,
  requireDesktopClient,
  toPublicServerConfig,
  type RouteHandler,
} from "./management-context.ts";
import { testMcpConnection } from "./test-mcp-connection.ts";

export const handleServers: RouteHandler = async (req, res, url, ctx) => {
  if (req.method === "GET" && url.pathname === "/api/servers") {
    json(res, 200, { servers: [] });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/server-configs") {
    json(res, 200, {
      servers: ctx.registry.list().map(toPublicServerConfig),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/upstreams") {
    json(res, 200, { upstreams: ctx.upstreams.list() });
    return true;
  }

  const environmentMatch = url.pathname.match(
    /^\/api\/server-configs\/([0-9a-f-]+)\/environment$/i,
  );
  if (req.method === "POST" && environmentMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const serverId = environmentMatch[1];
    const existing = ctx.registry.get(serverId);
    if (!existing) {
      json(res, 404, { error: "server configuration not found" });
      return true;
    }
    if (existing.transport !== "stdio") {
      json(res, 400, { error: "environment is only available for stdio servers" });
      return true;
    }

    const createdSecretIds: string[] = [];
    const wasRunning = ctx.upstreams
      .list()
      .some((upstream) => upstream.id === serverId && upstream.status === "running");
    try {
      const body = await readJsonBody(req) as {
        env?: unknown;
        secretEnvKeys?: unknown;
        secretEnv?: unknown;
      };

      const env = normalizeEnvironmentRecord(body.env);
      const secretEnvKeys = normalizeEnvironmentKeys(body.secretEnvKeys);
      const secretEnv = normalizeEnvironmentRecord(body.secretEnv);

      for (const key of Object.keys(env)) {
        if (secretEnvKeys.includes(key)) {
          throw new Error(`environment variable ${key} cannot be both plain and secret`);
        }
      }
      for (const key of Object.keys(secretEnv)) {
        if (!secretEnvKeys.includes(key)) {
          throw new Error(`secret value supplied for unlisted key: ${key}`);
        }
      }

      await ctx.upstreams.disconnect(serverId);

      const oldSecretIds = existing.envSecretIds ?? {};
      const nextSecretIds: Record<string, string> = {};

      for (const key of secretEnvKeys) {
        const suppliedValue = secretEnv[key];
        if (suppliedValue !== undefined && suppliedValue !== "") {
          const secretId = `stdio-env:${randomUUID()}`;
          await ctx.secrets.set(secretId, suppliedValue);
          createdSecretIds.push(secretId);
          nextSecretIds[key] = secretId;
          continue;
        }

        const existingSecretId = oldSecretIds[key];
        if (!existingSecretId) {
          throw new Error(`secret environment value is required for ${key}`);
        }
        nextSecretIds[key] = existingSecretId;
      }

      const updated = await ctx.registry.updateEnvironment(serverId, {
        env,
        envSecretIds: nextSecretIds,
      });
      if (!updated) {
        throw new Error("server configuration not found");
      }

      const retainedIds = new Set(Object.values(nextSecretIds));
      for (const oldSecretId of Object.values(oldSecretIds)) {
        if (!retainedIds.has(oldSecretId)) {
          await ctx.secrets.delete(oldSecretId).catch(() => false);
        }
      }

      ctx.upstreams.syncConfigs();
      let reconnectError: string | null = null;
      if (wasRunning && updated.enabled) {
        try {
          await ctx.upstreams.connect(serverId);
        } catch (error) {
          reconnectError = error instanceof Error ? error.message : String(error);
        }
      }

      json(res, reconnectError ? 409 : 200, {
        server: toPublicServerConfig(updated),
        ...(reconnectError ? { reconnectError } : {}),
      });
    } catch (error) {
      for (const secretId of createdSecretIds) {
        await ctx.secrets.delete(secretId).catch(() => false);
      }

      let restoreError: string | null = null;
      if (wasRunning && existing.enabled) {
        try {
          await ctx.upstreams.connect(serverId);
        } catch (restoreFailure) {
          restoreError =
            restoreFailure instanceof Error
              ? restoreFailure.message
              : String(restoreFailure);
        }
      }

      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
        ...(restoreError ? { restoreError } : {}),
      });
    }
    return true;
  }

  const upstreamActionMatch = url.pathname.match(
    /^\/api\/upstreams\/([0-9a-f-]+)\/(connect|disconnect|refresh-tools)$/i,
  );
  if (req.method === "POST" && upstreamActionMatch) {
    if (!requireDesktopClient(req, res)) return true;
    const [, upstreamId, action] = upstreamActionMatch;

    try {
      const upstream =
        action === "connect"
          ? await ctx.upstreams.connect(upstreamId)
          : action === "disconnect"
            ? await ctx.upstreams.disconnect(upstreamId)
            : await ctx.upstreams.refreshTools(upstreamId);

      json(res, 200, { upstream });
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/server-configs/test-connection"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req, 256 * 1024);
      const result = await testMcpConnection(
        body as Record<string, unknown>,
        ctx.registry,
        ctx.secrets,
        ctx.logger,
        { upstreamConnectTimeoutMs: ctx.config.connectionTimeoutMs },
      );
      json(res, 200, { result });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/server-configs") {
    if (!requireDesktopClient(req, res)) return true;

    let createdSecretId: string | null = null;
    try {
      const body = await readJsonBody(req) as {
        name?: unknown;
        transport?: unknown;
        command?: unknown;
        args?: unknown;
        cwd?: unknown;
        url?: unknown;
        headers?: unknown;
        authorization?: unknown;
      };

      const transport = body.transport === "http" ? "http" : "stdio";
      const authorization = normalizeOptionalAuthorization(body.authorization);

      if (transport === "http" && authorization) {
        createdSecretId = `http-auth:${randomUUID()}`;
        await ctx.secrets.set(createdSecretId, authorization);
      }

      const server = await ctx.registry.create({
        name: body.name as string,
        transport,
        command: typeof body.command === "string" ? body.command : undefined,
        args: Array.isArray(body.args) ? body.args as string[] : [],
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
        url: typeof body.url === "string" ? body.url : undefined,
        headers: readOptionalHeaders(body.headers),
        authSecretId: createdSecretId ?? undefined,
      });
      ctx.upstreams.syncConfigs();
      json(res, 201, { server: toPublicServerConfig(server) });
    } catch (error) {
      if (createdSecretId) {
        await ctx.secrets.delete(createdSecretId).catch(() => false);
      }
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const configEditMatch = url.pathname.match(
    /^\/api\/server-configs\/([0-9a-f-]+)$/i,
  );
  if (req.method === "POST" && configEditMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const serverId = configEditMatch[1];
    const existing = ctx.registry.get(serverId);
    if (!existing) {
      json(res, 404, { error: "server configuration not found" });
      return true;
    }

    let createdSecretId: string | null = null;
    let secretToDeleteAfterSuccess: string | null =
      existing.transport === "http" ? existing.authSecretId ?? null : null;
    const wasRunning = ctx.upstreams
      .list()
      .some((upstream) => upstream.id === serverId && upstream.status === "running");

    try {
      const body = await readJsonBody(req) as {
        name?: unknown;
        transport?: unknown;
        command?: unknown;
        args?: unknown;
        cwd?: unknown;
        url?: unknown;
        headers?: unknown;
        authorization?: unknown;
        clearAuthorization?: unknown;
      };

      await ctx.upstreams.disconnect(serverId);

      const transport =
        body.transport === "http"
          ? "http"
          : body.transport === "stdio"
            ? "stdio"
            : existing.transport;

      const authorization = normalizeOptionalAuthorization(body.authorization);
      const clearAuthorization = body.clearAuthorization === true;

      let authSecretId: string | null | undefined;

      if (transport === "http") {
        if (authorization) {
          createdSecretId = `http-auth:${randomUUID()}`;
          await ctx.secrets.set(createdSecretId, authorization);
          authSecretId = createdSecretId;
        } else if (clearAuthorization) {
          authSecretId = null;
        } else if (existing.transport === "http") {
          authSecretId = existing.authSecretId;
          secretToDeleteAfterSuccess = null;
        }
      } else {
        authSecretId = null;
      }

      const updated = await ctx.registry.update(serverId, {
        name: body.name as string,
        transport,
        command: typeof body.command === "string" ? body.command : undefined,
        args: Array.isArray(body.args) ? body.args as string[] : [],
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
        url: typeof body.url === "string" ? body.url : undefined,
        ...(Object.prototype.hasOwnProperty.call(body, "headers")
          ? { headers: readOptionalHeaders(body.headers) }
          : {}),
        authSecretId,
      });

      if (!updated) {
        throw new Error("server configuration not found");
      }

      if (
        secretToDeleteAfterSuccess &&
        secretToDeleteAfterSuccess !== createdSecretId
      ) {
        await ctx.secrets
          .delete(secretToDeleteAfterSuccess)
          .catch(() => false);
      }

      if (existing.transport === "stdio" && updated.transport !== "stdio") {
        for (const secretId of Object.values(existing.envSecretIds ?? {})) {
          await ctx.secrets.delete(secretId).catch(() => false);
        }
      }

      ctx.upstreams.syncConfigs();
      let reconnectError: string | null = null;
      if (wasRunning && updated.enabled) {
        try {
          await ctx.upstreams.connect(serverId);
        } catch (error) {
          reconnectError = error instanceof Error ? error.message : String(error);
        }
      }

      json(res, reconnectError ? 409 : 200, {
        server: toPublicServerConfig(updated),
        ...(reconnectError ? { reconnectError } : {}),
      });
    } catch (error) {
      if (createdSecretId) {
        await ctx.secrets.delete(createdSecretId).catch(() => false);
      }

      let restoreError: string | null = null;
      if (wasRunning && existing.enabled) {
        try {
          await ctx.upstreams.connect(serverId);
        } catch (restoreFailure) {
          restoreError =
            restoreFailure instanceof Error
              ? restoreFailure.message
              : String(restoreFailure);
        }
      }

      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
        ...(restoreError ? { restoreError } : {}),
      });
    }
    return true;
  }

  const configSettingsMatch = url.pathname.match(
    /^\/api\/server-configs\/([0-9a-f-]+)\/settings$/i,
  );
  if (req.method === "POST" && configSettingsMatch) {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req) as {
        enabled?: unknown;
        autoStart?: unknown;
      };

      const serverId = configSettingsMatch[1];
      if (body.enabled === false) {
        await ctx.upstreams.disconnect(serverId);
      }

      const updated = await ctx.registry.updateSettings(
        serverId,
        {
          enabled:
            body.enabled === undefined
              ? undefined
              : body.enabled as boolean,
          autoStart:
            body.autoStart === undefined
              ? undefined
              : body.autoStart as boolean,
        },
      );

      if (!updated) {
        json(res, 404, { error: "server configuration not found" });
        return true;
      }

      ctx.upstreams.syncConfigs();

      json(res, 200, { server: toPublicServerConfig(updated) });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const configDeleteMatch = url.pathname.match(/^\/api\/server-configs\/([0-9a-f-]+)$/i);
  if (req.method === "DELETE" && configDeleteMatch) {
    if (!requireDesktopClient(req, res)) return true;
    const serverId = configDeleteMatch[1];
    const existing = ctx.registry.get(serverId);

    try {
      await ctx.upstreams.disconnect(serverId);
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }

    const removed = await ctx.registry.remove(serverId);
    await ctx.toolPolicy.removeServer(serverId);
    await ctx.profiles.removeServer(serverId);
    ctx.upstreams.syncConfigs();
    if (!removed) {
      json(res, 404, { error: "server configuration not found" });
      return true;
    }

    if (existing?.transport === "http" && existing.authSecretId) {
      await ctx.secrets.delete(existing.authSecretId).catch(() => false);
    }
    if (existing?.transport === "stdio") {
      for (const secretId of Object.values(existing.envSecretIds ?? {})) {
        await ctx.secrets.delete(secretId).catch(() => false);
      }
    }

    json(res, 200, { ok: true });
    return true;
  }

  return false;
};

function normalizeOptionalAuthorization(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("authorization must be a string");
  }

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 8192) {
    throw new Error("authorization is too long");
  }
  return trimmed;
}

function normalizeEnvironmentRecord(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("environment must be an object");
  }

  const entries = Object.entries(value);
  if (entries.length > 128) throw new Error("too many environment variables");

  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`invalid environment variable name: ${key}`);
    }
    if (typeof item !== "string") {
      throw new Error(`environment value for ${key} must be a string`);
    }
    if (item.length > 65_536) {
      throw new Error(`environment value for ${key} is too long`);
    }
    result[key] = item;
  }
  return result;
}

function normalizeEnvironmentKeys(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("secretEnvKeys must be an array");
  }
  if (value.length > 128) throw new Error("too many secret environment variables");

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item)) {
      throw new Error(`invalid secret environment variable name: ${String(item)}`);
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}
