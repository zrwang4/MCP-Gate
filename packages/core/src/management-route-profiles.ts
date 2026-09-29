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
      activeProfileId: ctx.profileService.activeProfileId,
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
      const profile = await ctx.profileService.create(
        body.name as string,
        normalizeProfileServerIds(body.serverIds),
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
      const outcome = await ctx.profileService.update(profileMatch[1], {
        name: body.name as string,
        serverIds: normalizeProfileServerIds(body.serverIds),
      });

      if (!outcome.ok) {
        json(res, 409, {
          error: "profile update could not be fully applied",
          profile: outcome.profile,
          activeProfileId: outcome.activeProfileId,
          result: outcome.result,
          ...(outcome.rollback ? { rollback: outcome.rollback } : {}),
        });
        return true;
      }

      json(res, 200, {
        profile: outcome.profile,
        activeProfileId: outcome.activeProfileId,
        ...(outcome.result ? { result: outcome.result } : {}),
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
      const outcome =
        action === "activate"
          ? await ctx.profileService.activate(profileId)
          : await ctx.profileService.deactivate(profileId);

      if (!outcome.ok) {
        json(res, 409, {
          error:
            action === "activate"
              ? "profile activation incomplete"
              : "profile deactivation incomplete",
          profile: outcome.profile,
          activeProfileId: outcome.activeProfileId,
          result: outcome.result,
          ...(outcome.rollback ? { rollback: outcome.rollback } : {}),
        });
        return true;
      }

      json(res, 200, {
        profile: outcome.profile,
        activeProfileId: outcome.activeProfileId,
        result: outcome.result,
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

    try {
      const outcome = await ctx.profileService.remove(profileMatch[1]);
      if (!outcome.ok) {
        json(res, 409, {
          error: "active profile cannot be deleted until all members disconnect",
          profile: outcome.profile,
          activeProfileId: outcome.activeProfileId,
          result: outcome.result,
        });
        return true;
      }

      json(res, 200, {
        ok: true,
        activeProfileId: outcome.activeProfileId,
        ...(outcome.result ? { result: outcome.result } : {}),
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
