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

    try {
      const body = await readJsonBody(req) as {
        env?: unknown;
        secretEnvKeys?: unknown;
        secretEnv?: unknown;
      };
      const env = normalizeEnvironmentRecord(body.env);
      const secretEnvKeys = normalizeEnvironmentKeys(body.secretEnvKeys);
      const secretEnv = normalizeEnvironmentRecord(body.secretEnv);

      const result = await ctx.servers.updateEnvironment(serverId, {
        env,
        secretEnvKeys,
        secretEnv,
      });

      json(res, result.reconnectError ? 409 : 200, {
        server: toPublicServerConfig(result.server),
        ...(result.reconnectError
          ? { reconnectError: result.reconnectError }
          : {}),
      });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const upstreamActionMatch = url.pathname.match(  const upstreamActionMatch = url.pathname.match(
    /^\/api\/upstreams\/([0-9a-f-]+)\/(connect|disconnect|refresh-tools)$/i,
  );
  if (req.method === "POST" && upstreamActionMatch) {
    if (!requireDesktopClient(req, res)) return true;
    const [, upstreamId, action] = upstreamActionMatch;

    await ctx.mutations.run(async () => {
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
    });
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
      const server = await ctx.servers.create({
        name: body.name as string,
        transport,
        command: typeof body.command === "string" ? body.command : undefined,
        args: Array.isArray(body.args) ? body.args as string[] : [],
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
        url: typeof body.url === "string" ? body.url : undefined,
        headers: readOptionalHeaders(body.headers),
        authorization,
      });

      json(res, 201, { server: toPublicServerConfig(server) });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const configEditMatch = url.pathname.match(  const configEditMatch = url.pathname.match(
    /^\/api\/server-configs\/([0-9a-f-]+)$/i,
  );
  if (req.method === "POST" && configEditMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const serverId = configEditMatch[1];
    if (!ctx.registry.get(serverId)) {
      json(res, 404, { error: "server configuration not found" });
      return true;
    }

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

      const transport =
        body.transport === "http"
          ? "http"
          : body.transport === "stdio"
            ? "stdio"
            : undefined;

      const result = await ctx.servers.update(serverId, {
        name: body.name as string,
        transport,
        command: typeof body.command === "string" ? body.command : undefined,
        args: Array.isArray(body.args) ? body.args as string[] : undefined,
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
        url: typeof body.url === "string" ? body.url : undefined,
        headers: readOptionalHeaders(body.headers),
        headersProvided: Object.prototype.hasOwnProperty.call(body, "headers"),
        authorization: normalizeOptionalAuthorization(body.authorization),
        clearAuthorization: body.clearAuthorization === true,
      });

      json(res, result.reconnectError ? 409 : 200, {
        server: toPublicServerConfig(result.server),
        ...(result.reconnectError
          ? { reconnectError: result.reconnectError }
          : {}),
      });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const configSettingsMatch = url.pathname.match(  const configSettingsMatch = url.pathname.match(
    /^\/api\/server-configs\/([0-9a-f-]+)\/settings$/i,
  );
  if (req.method === "POST" && configSettingsMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const serverId = configSettingsMatch[1];
    if (!ctx.registry.get(serverId)) {
      json(res, 404, { error: "server configuration not found" });
      return true;
    }

    try {
      const body = await readJsonBody(req) as {
        enabled?: unknown;
        autoStart?: unknown;
      };

      const updated = await ctx.servers.updateSettings(serverId, {
        enabled:
          body.enabled === undefined
            ? undefined
            : body.enabled as boolean,
        autoStart:
          body.autoStart === undefined
            ? undefined
            : body.autoStart as boolean,
      });

      json(res, 200, { server: toPublicServerConfig(updated) });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const configDeleteMatch = url.pathname.match  const configDeleteMatch = url.pathname.match(/^\/api\/server-configs\/([0-9a-f-]+)$/i);
  if (req.method === "DELETE" && configDeleteMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const serverId = configDeleteMatch[1];
    if (!ctx.registry.get(serverId)) {
      json(res, 404, { error: "server configuration not found" });
      return true;
    }

    try {
      await ctx.servers.remove(serverId);
      json(res, 200, { ok: true });
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  return false;  return false;
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
