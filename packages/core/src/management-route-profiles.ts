import type { McpServerConfig } from "./server-registry.ts";
import {
  json,
  readJsonBody,
  requireDesktopClient,
  type RouteHandler,
} from "./management-context.ts";

export const handleProfiles: RouteHandler = async (req, res, url, ctx) => {
  const profileMatch = url.pathname.match(
    /^\/api\/profiles\/([0-9a-f-]+)$/i,
  );

  if (req.method === "GET" && url.pathname === "/api/profiles") {
    json(res, 200, {
      profiles: ctx.profiles.list(),
      activeProfileId: ctx.profiles.activeProfileId,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profiles") {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req) as {
        name?: unknown;
        serverIds?: unknown;
      };
      const serverIds = normalizeProfileServerIds(body.serverIds);
      assertKnownServers(serverIds, ctx.registry.list());
      const profile = await ctx.profiles.create(
        body.name as string,
        serverIds,
      );
      json(res, 201, { profile });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (req.method === "POST" && profileMatch) {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req) as {
        name?: unknown;
        serverIds?: unknown;
      };
      const serverIds = normalizeProfileServerIds(body.serverIds);
      assertKnownServers(serverIds, ctx.registry.list());
      const profileId = profileMatch[1];
      const wasActive = ctx.profiles.activeProfileId === profileId;
      const profile = await ctx.profiles.update(profileId, {
        name: body.name as string,
        serverIds,
      });
      if (!profile) {
        json(res, 404, { error: "profile not found" });
        return true;
      }

      const result = wasActive
        ? await ctx.upstreams.applyExactSet(profile.serverIds)
        : undefined;

      json(res, 200, {
        profile,
        activeProfileId: ctx.profiles.activeProfileId,
        ...(result ? { result } : {}),
      });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const profileActionMatch = url.pathname.match(
    /^\/api\/profiles\/([0-9a-f-]+)\/(activate|deactivate)$/i,
  );
  if (req.method === "POST" && profileActionMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const [, profileId, action] = profileActionMatch;
    const profile = ctx.profiles.get(profileId);
    if (!profile) {
      json(res, 404, { error: "profile not found" });
      return true;
    }

    const result =
      action === "activate"
        ? await ctx.upstreams.applyExactSet(profile.serverIds)
        : await ctx.upstreams.disconnectSet(profile.serverIds);

    if (action === "activate") {
      await ctx.profiles.setActive(profileId);
    } else if (ctx.profiles.activeProfileId === profileId) {
      await ctx.profiles.setActive(null);
    }

    json(res, 200, {
      profile,
      activeProfileId: ctx.profiles.activeProfileId,
      result,
    });
    return true;
  }

  if (req.method === "DELETE" && profileMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const profileId = profileMatch[1];
    const profile = ctx.profiles.get(profileId);
    if (!profile) {
      json(res, 404, { error: "profile not found" });
      return true;
    }

    const wasActive = ctx.profiles.activeProfileId === profileId;
    const result = wasActive
      ? await ctx.upstreams.disconnectSet(profile.serverIds)
      : undefined;

    const removed = await ctx.profiles.remove(profileId);
    if (!removed) {
      json(res, 404, { error: "profile not found" });
      return true;
    }

    json(res, 200, {
      ok: true,
      activeProfileId: ctx.profiles.activeProfileId,
      ...(result ? { result } : {}),
    });
    return true;
  }

  return false;
};

function normalizeProfileServerIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("serverIds must be an array");
  }
  if (value.length > 100) {
    throw new Error("too many servers in profile");
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("serverIds must contain non-empty strings");
    }
    const id = item.trim();
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function assertKnownServers(
  serverIds: string[],
  servers: McpServerConfig[],
): void {
  const known = new Set(servers.map((server) => server.id));
  const missing = serverIds.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new Error(`unknown server id(s): ${missing.join(", ")}`);
  }
}
