import {
  json,
  readJsonBody,
  requireDesktopClient,
  type RouteHandler,
} from "./management-context.ts";

export const handleGatewayAccess: RouteHandler = async (req, res, url, ctx) => {
  if (req.method === "GET" && url.pathname === "/api/gateway-access") {
    json(res, 200, {
      access: ctx.gatewayAccess.snapshot(),
    });
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/gateway-access/lan"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    const previous = ctx.gatewayAccess.snapshot().lanEnabled;
    await ctx.mutations.run(async () => {
    try {
        const body = await readJsonBody(req) as { enabled?: unknown };
        if (typeof body.enabled !== "boolean") {
          throw new Error("enabled must be a boolean");
        }

        await ctx.gatewayAccess.setLanEnabled(body.enabled);
        await ctx.gateway.stop();
        await ctx.gateway.start();

        json(res, 200, {
          access: ctx.gatewayAccess.snapshot(),
          gateway: ctx.gateway.snapshot(),
        });

    } catch (error) {

        const current = ctx.gatewayAccess.snapshot().lanEnabled;
        if (current !== previous) {
          await ctx.gatewayAccess
            .setLanEnabled(previous)
            .catch(() => undefined);
          await ctx.gateway.stop().catch(() => undefined);
          await ctx.gateway.start().catch(() => undefined);
        }

        json(res, 400, {
          error: error instanceof Error ? error.message : String(error),
          gateway: ctx.gateway.snapshot(),
        });
      }
      return true;
    }


    }
    });
  if (
    req.method === "POST" &&
    url.pathname === "/api/gateway-access/rotate"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    await ctx.mutations.run(async () => {
    try {
        const rotated = await ctx.gatewayAccess.rotate();
        json(res, 200, {
          access: rotated.snapshot,
          apiKey: rotated.apiKey,
        });

    } catch (error) {

        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }


    }
    });
  if (
    req.method === "POST" &&
    url.pathname === "/api/gateway-access/disable"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    await ctx.mutations.run(async () => {
    try {
        const wasLanEnabled = ctx.gatewayAccess.snapshot().lanEnabled;
        const access = await ctx.gatewayAccess.disable();

        if (wasLanEnabled) {
          await ctx.gateway.stop();
          await ctx.gateway.start();
        }

        json(res, 200, {
          access,
          gateway: ctx.gateway.snapshot(),
        });

    } catch (error) {

        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }


    }
    });
  return false;
};
