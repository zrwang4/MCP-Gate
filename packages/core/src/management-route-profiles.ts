import type { McpServerConfig } from "./server-registry.ts";
import {
  json,
  readJsonBody,
  requireDesktopClient,
  type RouteHandler,
} from "./management-context.ts";

let profileMutationTail: Promise<void> = Promise.resolve();

async function serializeProfileMutation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = profileMutationTail;
  let release!: () => void;
  profileMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
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
      await serializeProfileMutation(async () => {
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
      });
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
      await serializeProfileMutation(async () => {
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
          return;
        }

        const result = wasActive
          ? await ctx.upstreams.applyExactSet(profile.serverIds)
          : undefined;

        json(res, 200, {
          profile,
          activeProfileId: ctx.profiles.activeProfileId,
          ...(result ? { result } : {}),
        });
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

    try {
      await serializeProfileMutation(async () => {
        // Re-read after waiting for the mutation lock. Another request may
        // have updated or deleted this profile while we were queued.
        const profile = ctx.profiles.get(profileId);
        if (!profile) {
          json(res, 404, { error: "profile not found" });
          return;
        }

        const result =
          action === "activate"
            ? await ctx.upstreams.applyExactSet(profile.serverIds)
            : await ctx.upstreams.disconnectSet(profile.serverIds);

        // Keep an active profile when deactivation could not fully disconnect
        // its members. Otherwise failed transports become running without a
        // profile representing the desired ownership/state anymore.
        if (action === "deactivate" && result.failed.length > 0) {
          json(res, 409, {
            error: "profile deactivation incomplete",
            profile,
            activeProfileId: ctx.profiles.activeProfileId,
            result,
          });
          return;
        }

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
      });
    } catch (error) {
      json(res, 409, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (req.method === "DELETE" && profileMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const profileId = profileMatch[1];

    try {
      await serializeProfileMutation(async () => {
        // Re-read after waiting for the mutation lock to avoid acting on a
        // profile snapshot that another request has already changed.
        const profile = ctx.profiles.get(profileId);
        if (!profile) {
          json(res, 404, { error: "profile not found" });
          return;
        }

        const wasActive = ctx.profiles.activeProfileId === profileId;
        const result = wasActive
          ? await ctx.upstreams.disconnectSet(profile.serverIds)
          : undefined;

        if (wasActive && result && result.failed.length > 0) {
          json(res, 409, {
            error: "active profile cannot be deleted until all members disconnect",
            profile,
            activeProfileId: ctx.profiles.activeProfileId,
            result,
          });
          return;
        }

        const removed = await ctx.profiles.remove(profileId);
        if (!removed) {
          json(res, 404, { error: "profile not found" });
          return;
        }

        json(res, 200, {
          ok: true,
          activeProfileId: ctx.profiles.activeProfileId,
          ...(result ? { result } : {}),
        });
      });
    } catch (error) {
      json(res, 409, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
