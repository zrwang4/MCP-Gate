import type { AuditSource } from "./audit-logger.ts";
import type { LogLevel } from "./logger.ts";
import { json, type RouteHandler } from "./management-context.ts";

export const handleLogs: RouteHandler = async (req, res, url, ctx) => {
  if (req.method === "GET" && url.pathname === "/api/audit") {
    const after = Number(url.searchParams.get("after") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const serverId = url.searchParams.get("serverId") ?? undefined;
    const publicName = url.searchParams.get("publicName") ?? undefined;
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
        serverId,
        publicName,
      }),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    const after = Number(url.searchParams.get("after") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "200");
    const source = url.searchParams.get("source") ?? undefined;
    const contains = url.searchParams.get("contains") ?? undefined;
    const rawLevel = url.searchParams.get("level") as LogLevel | null;
    const level = rawLevel && ["debug", "info", "warn", "error"].includes(rawLevel)
      ? rawLevel
      : undefined;
    json(res, 200, {
      entries: ctx.logger.list({
        after: Number.isFinite(after) ? after : 0,
        limit: Number.isFinite(limit) ? limit : 200,
        level,
        source,
        contains,
      }),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/observability") {
    const logs = ctx.logger.list({ limit: 1000 });
    const audit = ctx.audit.list({ limit: 1000 });
    const upstreams = ctx.upstreams.list();

    const memory = process.memoryUsage();

    json(res, 200, {
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers ?? 0,
        uptimeSeconds: Math.round(process.uptime()),
      },
      core: {
        startedAt: ctx.startedAt,
        logFile: ctx.logger.filePath,
        auditFile: ctx.audit.filePath,
      },
      logs: {
        total: logs.length,
        errors: logs.filter((entry) => entry.level === "error").length,
        warnings: logs.filter((entry) => entry.level === "warn").length,
        latest: logs.at(-1) ?? null,
      },
      audit: {
        total: audit.length,
        failures: audit.filter((entry) => !entry.success).length,
        latest: audit.at(-1) ?? null,
      },
      upstreams: {
        total: upstreams.length,
        running: upstreams.filter((item) => item.status === "running").length,
        unhealthy: upstreams.filter((item) => item.healthStatus === "unhealthy").length,
        circuitsOpen: upstreams.filter((item) => item.circuitState === "open").length,
      },
    });
    return true;
  }

  return false;
};
