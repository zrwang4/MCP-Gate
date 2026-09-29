import { readFile } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { writeJsonWithBackup } from "./atomic-write.ts";
import { json, readJsonBody, requireDesktopClient, type RouteHandler } from "./management-context.ts";
import { normalizeSessionIdleTimeout } from "./session-settings.ts";

const BACKUP_VERSION = 1;

type BackupBundle = {
  version: 1;
  exportedAt: string;
  note: string;
  servers: unknown;
  profiles: unknown;
  toolPolicy: unknown;
  gatewayAccess: unknown;
  sessionSettings: unknown;
};

async function readJsonOrDefault(path: string, fallback: unknown): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export function validateBackupBundle(value: unknown): BackupBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("backup must be a JSON object");
  }

  const bundle = value as Record<string, unknown>;
  if (bundle.version !== BACKUP_VERSION) {
    throw new Error("unsupported backup version");
  }

  for (const key of ["servers", "profiles", "toolPolicy", "gatewayAccess", "sessionSettings"]) {
    const item = bundle[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`backup.${key} must be an object`);
    }
  }

  const servers = bundle.servers as Record<string, unknown>;
  const profiles = bundle.profiles as Record<string, unknown>;
  const toolPolicy = bundle.toolPolicy as Record<string, unknown>;
  const gatewayAccess = bundle.gatewayAccess as Record<string, unknown>;
  const sessionSettings = bundle.sessionSettings as Record<string, unknown>;

  if (servers.version !== 1 || !Array.isArray(servers.servers)) {
    throw new Error("invalid server registry backup");
  }
  if (profiles.version !== 1 || !Array.isArray(profiles.profiles)) {
    throw new Error("invalid profile backup");
  }
  if (toolPolicy.version !== 1 || !toolPolicy.disabled || typeof toolPolicy.disabled !== "object") {
    throw new Error("invalid tool policy backup");
  }
  if (
    gatewayAccess.version !== 1 ||
    !Object.prototype.hasOwnProperty.call(gatewayAccess, "apiKeySecretId") ||
    (gatewayAccess.lanEnabled !== undefined && typeof gatewayAccess.lanEnabled !== "boolean")
  ) {
    throw new Error("invalid gateway access backup");
  }
  if (
    sessionSettings.version !== 1 ||
    typeof sessionSettings.idleTimeoutMs !== "number"
  ) {
    throw new Error("invalid session settings backup");
  }
  normalizeSessionIdleTimeout(sessionSettings.idleTimeoutMs);

  const profileIds = new Set(
    (profiles.profiles as unknown[])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const activeProfileId = profiles.activeProfileId;
  if (activeProfileId !== null && typeof activeProfileId !== "string") {
    throw new Error("invalid activeProfileId");
  }
  if (typeof activeProfileId === "string" && !profileIds.has(activeProfileId)) {
    throw new Error("active profile does not exist");
  }

  return {
    version: 1,
    exportedAt: typeof bundle.exportedAt === "string" ? bundle.exportedAt : "",
    note: typeof bundle.note === "string" ? bundle.note : "",
    servers: bundle.servers,
    profiles: bundle.profiles,
    toolPolicy: bundle.toolPolicy,
    gatewayAccess: bundle.gatewayAccess,
    sessionSettings: bundle.sessionSettings,
  };
}

export const handleBackup: RouteHandler = async (req, res, url, ctx) => {
  if (req.method === "GET" && url.pathname === "/api/backup/export") {
    const bundle: BackupBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      note:
        "Configuration backup. Secret values are never exported; secret references remain valid only when the secure storage entries still exist.",
      servers: await readJsonOrDefault(ctx.config.serverConfigFile, {
        version: 1,
        servers: [],
      }),
      profiles: await readJsonOrDefault(ctx.config.profileFile, {
        version: 1,
        activeProfileId: null,
        profiles: [],
      }),
      toolPolicy: await readJsonOrDefault(ctx.config.toolPolicyFile, {
        version: 1,
        disabled: {},
      }),
      gatewayAccess: await readJsonOrDefault(ctx.config.gatewayAccessFile, {
        version: 1,
        apiKeySecretId: null,
        lanEnabled: false,
      }),
      sessionSettings: await readJsonOrDefault(ctx.config.sessionSettingsFile, {
        version: 1,
        idleTimeoutMs: ctx.config.sessionIdleTimeoutMs,
      }),
    };

    json(res, 200, { backup: bundle });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/backup/restore") {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req, 1024 * 1024);
      const backup = validateBackupBundle((body as { backup?: unknown }).backup ?? body);

      await writeJsonWithBackup(
        backup.servers,
        {
          directory: dirname(ctx.config.serverConfigFile),
          fileName: basename(ctx.config.serverConfigFile),
          logger: ctx.logger,
        },
      );
      await writeJsonWithBackup(
        backup.profiles,
        {
          directory: dirname(ctx.config.profileFile),
          fileName: basename(ctx.config.profileFile),
          logger: ctx.logger,
        },
      );
      await writeJsonWithBackup(
        backup.toolPolicy,
        {
          directory: dirname(ctx.config.toolPolicyFile),
          fileName: basename(ctx.config.toolPolicyFile),
          logger: ctx.logger,
        },
      );
      await writeJsonWithBackup(
        backup.gatewayAccess,
        {
          directory: dirname(ctx.config.gatewayAccessFile),
          fileName: basename(ctx.config.gatewayAccessFile),
          logger: ctx.logger,
        },
      );
      await writeJsonWithBackup(
        backup.sessionSettings,
        {
          directory: dirname(ctx.config.sessionSettingsFile),
          fileName: basename(ctx.config.sessionSettingsFile),
          logger: ctx.logger,
        },
      );

      ctx.logger.info("backup", "configuration backup restored; Core restart required");
      json(res, 200, {
        ok: true,
        restartRequired: true,
        note: backup.note,
      });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  return false;
};
