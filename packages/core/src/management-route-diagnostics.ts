import { buildDiagnosticSnapshot } from "./diagnostics.ts";
import { json, type RouteHandler } from "./management-context.ts";
import { CORE_VERSION } from "./version.ts";

export const handleDiagnostics: RouteHandler = async (req, res, url, ctx) => {
  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    json(res, 200, {
      snapshot: buildDiagnosticSnapshot({
        coreVersion: CORE_VERSION,
        coreStartedAt: ctx.startedAt,
        gateway: ctx.gateway.snapshot(),
        activeProfileId: ctx.profiles.activeProfileId,
        profiles: ctx.profiles.list(),
        servers: ctx.registry.list(),
        upstreams: ctx.upstreams.list(),
        tools: ctx.tools.list({ includeDisabled: true }),
        logs: ctx.logger.list({ limit: 500 }),
      }),
    });
    return true;
  }

  return false;
};
