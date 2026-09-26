import {
  json,
  readJsonBody,
  requireDesktopClient,
  type RouteHandler,
} from "./management-context.ts";

export const handleTools: RouteHandler = async (req, res, url, ctx) => {
  if (req.method === "GET" && url.pathname === "/api/tools") {
    json(res, 200, { tools: ctx.tools.list({ includeDisabled: true }) });
    return true;
  }

  const toolCallMatch = url.pathname.match(
    /^\/api\/tools\/([A-Za-z0-9_-]+)\/call$/,
  );
  if (req.method === "POST" && toolCallMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const [, publicName] = toolCallMatch;
    try {
      const body = await readJsonBody(req) as { arguments?: unknown };
      const args = body.arguments ?? {};
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        json(res, 400, { error: "arguments must be a JSON object" });
        return true;
      }

      const result = await ctx.upstreams.callTool(
        publicName,
        args,
        { source: "tester" },
      );
      ctx.logger.info("tools", `test call completed: ${publicName}`);
      json(res, 200, { result });
    } catch (error) {
      ctx.logger.warn(
        "tools",
        `test call failed: ${publicName}: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const toolActionMatch = url.pathname.match(
    /^\/api\/tools\/([A-Za-z0-9_-]+)\/(enable|disable)$/,
  );
  if (req.method === "POST" && toolActionMatch) {
    if (!requireDesktopClient(req, res)) return true;

    const [, publicName, action] = toolActionMatch;
    const tool = ctx.tools.resolve(publicName);
    if (!tool) {
      json(res, 404, { error: "tool not found" });
      return true;
    }

    const enabled = action === "enable";
    await ctx.toolPolicy.setEnabled(
      tool.serverId,
      tool.originalName,
      enabled,
    );
    const changed = ctx.tools.setEnabled(publicName, enabled);
    if (!changed) {
      json(res, 404, { error: "tool not found" });
      return true;
    }

    const updatedTool = ctx.tools.resolve(publicName);
    ctx.logger.info(
      "tools",
      `${action === "enable" ? "enabled" : "disabled"} ${publicName}`,
    );
    json(res, 200, { tool: updatedTool });
    return true;
  }

  return false;
};
