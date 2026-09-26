import {
  applyMcpClientConfig,
  previewMcpClientConfig,
  toPublicMcpImportPreview,
} from "./mcp-config-import.ts";
import { inspectMcpImportSources, readMcpImportSource } from "./mcp-import-source.ts";
import {
  json,
  readJsonBody,
  requireDesktopClient,
  type RouteHandler,
} from "./management-context.ts";

export const handleImport: RouteHandler = async (req, res, url, ctx) => {
  if (
    req.method === "POST" &&
    url.pathname === "/api/import/mcp-config/sources"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const sources = await inspectMcpImportSources();
      json(res, 200, { sources });
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/import/mcp-config/source-preview"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req) as {
        sourceId?: unknown;
      };
      if (typeof body.sourceId !== "string") {
        throw new Error("sourceId is required");
      }

      const loaded = await readMcpImportSource(body.sourceId);
      const preview = previewMcpClientConfig(loaded.config);
      json(res, 200, {
        source: loaded.source,
        preview: toPublicMcpImportPreview(preview),
      });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/import/mcp-config/source-apply"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req) as {
        sourceId?: unknown;
        expectedModifiedAt?: unknown;
      };
      if (typeof body.sourceId !== "string") {
        throw new Error("sourceId is required");
      }

      const loaded = await readMcpImportSource(body.sourceId);
      if (
        typeof body.expectedModifiedAt === "string" &&
        loaded.source.modifiedAt !== body.expectedModifiedAt
      ) {
        throw new Error("import source changed since preview; preview it again before importing");
      }

      const result = await applyMcpClientConfig(
        loaded.config,
        ctx.registry,
        ctx.secrets,
        ctx.logger,
      );
      ctx.upstreams.syncConfigs();
      json(res, 200, {
        source: loaded.source,
        result,
      });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/import/mcp-config/preview"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req, 512 * 1024) as {
        config?: unknown;
      };
      const preview = previewMcpClientConfig(body.config);
      json(res, 200, {
        preview: toPublicMcpImportPreview(preview),
      });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/import/mcp-config/apply"
  ) {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req, 512 * 1024) as {
        config?: unknown;
      };
      const result = await applyMcpClientConfig(
        body.config,
        ctx.registry,
        ctx.secrets,
        ctx.logger,
      );
      ctx.upstreams.syncConfigs();
      json(res, 200, { result });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  return false;
};
