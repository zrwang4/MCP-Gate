import type { AuditSource } from "./audit-logger.ts";
import type { LogLevel } from "./logger.ts";
import { json, type RouteHandler } from "./management-context.ts";

export const handleLogs: RouteHandler = async (req, res, url, ctx) => {
  if (req.method === "GET" && url.pathname === "/api/audit") {
    const after = Number(url.searchParams.get("after") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const rawSuccess = url.searchParams.get("success");
    const rawSource = url.searchParams.get("source");
    const success =
      rawSuccess === "true"
        ? true
        : rawSuccess === "false"
          ? false
          : undefined;
    const source: AuditSource | undefined =
      rawSource === "gateway" || rawSource === "tester"
        ? rawSource
        : undefined;

    json(res, 200, {
      file: ctx.audit.filePath,
      entries: ctx.audit.list({
        after: Number.isFinite(after) ? after : 0,
        limit: Number.isFinite(limit) ? limit : 100,
        success,
        source,
      }),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    const after = Number(url.searchParams.get("after") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "200");
    const rawLevel = url.searchParams.get("level") as LogLevel | null;
    const level = rawLevel && ["debug", "info", "warn", "error"].includes(rawLevel)
      ? rawLevel
      : undefined;
    json(res, 200, {
      entries: ctx.logger.list({
        after: Number.isFinite(after) ? after : 0,
        limit: Number.isFinite(limit) ? limit : 200,
        level,
      }),
    });
    return true;
  }

  return false;
};
