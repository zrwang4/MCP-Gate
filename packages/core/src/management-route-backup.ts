import { readFile, unlink } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { writeJsonWithBackup } from "./atomic-write.ts";
import { json, readJsonBody, requireDesktopClient, type RouteHandler } from "./management-context.ts";
import { loadSessionIdleTimeout, normalizeSessionIdleTimeout } from "./session-settings.ts";

const BACKUP_VERSION = 1;

/**
 * Header names whose values must never leave the process in a backup. Values
 * are stored as plain text in servers.json (unlike authSecretId), so a naive
 * export would leak bearer tokens into the backup file.
 */
const REDACTED_HEADER_PATTERN =
  /^(authorization|proxy-authorization|cookie|set-cookie)$/i;
export const HEADER_REDACTED_PLACEHOLDER = "[REDACTED]";

export function redactServerSecrets(servers: unknown): unknown {
  if (
    !servers ||
    typeof servers !== "object" ||
    Array.isArray(servers) ||
    !Array.isArray((servers as { servers?: unknown }).servers)
  ) {
    return servers;
  }
  const registry = servers as {
    servers: Array<Record<string, unknown> | null>;
  };
  return {
    ...registry,
    servers: registry.servers.map((server) => {
      if (!server || typeof server !== "object") return server;
      const headers = server.headers;
      if (
        !headers ||
        typeof headers !== "object" ||
        Array.isArray(headers)
      ) {
        return server;
      }
      const redacted = Object.fromEntries(
        Object.entries(headers as Record<string, string>).map(
          ([name, value]) => [
            name,
            REDACTED_HEADER_PATTERN.test(name)
              ? HEADER_REDACTED_PLACEHOLDER
              : value,
          ],
        ),
      );
      return { ...server, headers: redacted };
    }),
  };
}

/**
 * Drop redacted header entries on restore: a placeholder is not a credential,
 * and sending "[REDACTED]" upstream would fail authentication in a confusing
 * way. The user re-enters the value in the UI after restoring.
 */
export function stripRedactedHeaders(servers: unknown): unknown {
  if (
    !servers ||
    typeof servers !== "object" ||
    Array.isArray(servers) ||
    !Array.isArray((servers as { servers?: unknown }).servers)
  ) {
    return servers;
  }
  const registry = servers as {
    servers: Array<Record<string, unknown> | null>;
  };
  return {
    ...registry,
    servers: registry.servers.map((server) => {
      if (!server || typeof server !== "object") return server;
      const headers = server.headers;
      if (
        !headers ||
        typeof headers !== "object" ||
        Array.isArray(headers)
      ) {
        return server;
      }
      const kept = Object.fromEntries(
        Object.entries(headers as Record<string, string>).filter(
          ([name, value]) =>
            !REDACTED_HEADER_PATTERN.test(name) ||
            value !== HEADER_REDACTED_PLACEHOLDER,
        ),
      );
      return { ...server, headers: kept };
    }),
  };
}

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


interface BackupRestoreTarget {
  path: string;
  value: unknown;
}

interface ExistingState {
  path: string;
  existed: boolean;
  value?: unknown;
}

type JsonWriter = typeof writeJsonWithBackup;

async function captureExistingState(path: string): Promise<ExistingState> {
  try {
    return {
      path,
      existed: true,
      value: JSON.parse(await readFile(path, "utf8")),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, existed: false };
    }
    throw error;
  }
}

export async function restoreConfigurationFiles(
  targets: BackupRestoreTarget[],
  logger: Parameters<JsonWriter>[1]["logger"],
  writer: JsonWriter = writeJsonWithBackup,
): Promise<void> {
  const previous = await Promise.all(
    targets.map((target) => captureExistingState(target.path)),
  );
  const attempted: ExistingState[] = [];

  try {
    for (const target of targets) {
      const state = previous[attempted.length];
      if (!state) throw new Error("backup restore target/state mismatch");
      attempted.push(state);

      await writer(target.value, {
        directory: dirname(target.path),
        fileName: basename(target.path),
        logger,
      });
    }
  } catch (error) {
    const rollbackErrors: string[] = [];

    for (let index = attempted.length - 1; index >= 0; index -= 1) {
      const state = attempted[index];
      try {
        if (state.existed) {
          await writer(state.value, {
            directory: dirname(state.path),
            fileName: basename(state.path),
            logger,
          });
        } else {
          await unlink(state.path).catch((rollbackError) => {
            if ((rollbackError as NodeJS.ErrnoException).code !== "ENOENT") {
              throw rollbackError;
            }
          });
        }
      } catch (rollbackError) {
        rollbackErrors.push(
          `${state.path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    if (rollbackErrors.length > 0) {
      throw new Error(
        `configuration restore failed: ${message}; rollback failed for ${rollbackErrors.length} file(s)`,
      );
    }
    throw error;
  }
}

export const handleBackup: RouteHandler = async (req, res, url, ctx) => {
  if (req.method === "GET" && url.pathname === "/api/backup/export") {
    await ctx.mutations.run(async () => {
      const bundle: BackupBundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        note:
          "Configuration backup. Secret values are never exported: Keychain-backed secrets export as opaque references, and Authorization/Cookie-style header values are replaced with [REDACTED] and dropped on restore (re-enter them after restoring). Secret references remain valid only when the secure storage entries still exist.",
        servers: redactServerSecrets(
          await readJsonOrDefault(ctx.config.serverConfigFile, {
            version: 1,
            servers: [],
          }),
        ),
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
    });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/backup/restore") {
    if (!requireDesktopClient(req, res)) return true;

    try {
      const body = await readJsonBody(req, 1024 * 1024);
      const backup = validateBackupBundle((body as { backup?: unknown }).backup ?? body);
      let reloadWarnings: string[] = [];

      await ctx.mutations.run(async () => {
        await restoreConfigurationFiles(
          [
            {
              path: ctx.config.serverConfigFile,
              value: stripRedactedHeaders(backup.servers),
            },
            { path: ctx.config.profileFile, value: backup.profiles },
            { path: ctx.config.toolPolicyFile, value: backup.toolPolicy },
            { path: ctx.config.gatewayAccessFile, value: backup.gatewayAccess },
            { path: ctx.config.sessionSettingsFile, value: backup.sessionSettings },
          ],
          ctx.logger,
        );

        // Reload every in-memory store from the files we just wrote. Without
        // this, the next mutation would persist the stale pre-restore state
        // back over the restored files (write poisoning), and reads would
        // disagree with disk until restart.
        const reloadErrors: string[] = [];
        const reloads: Array<[string, () => Promise<void>]> = [
          ["servers", () => ctx.registry.reload()],
          ["profiles", () => ctx.profiles.reload()],
          ["toolPolicy", () => ctx.toolPolicy.reload()],
          ["gatewayAccess", () => ctx.gatewayAccess.reload()],
          [
            "sessionSettings",
            async () => {
              ctx.config.sessionIdleTimeoutMs = await loadSessionIdleTimeout(
                ctx.config.sessionSettingsFile,
                ctx.config.sessionIdleTimeoutMs,
              );
            },
          ],
        ];
        for (const [name, reload] of reloads) {
          try {
            await reload();
          } catch (error) {
            reloadErrors.push(
              `${name}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        // Align runtime state with the restored registry: disconnect upstreams
        // that the restored configuration removed or disabled. Restart is
        // still required for full effect (connected upstreams keep running
        // with their pre-restore config until then).
        try {
          await ctx.reconciler.reconcile();
        } catch (error) {
          reloadErrors.push(
            `runtime reconcile: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        if (reloadErrors.length > 0) {
          ctx.logger.error(
            "backup",
            `configuration backup restored, but reloading in-memory state failed: ${reloadErrors.join("; ")}`,
          );
        } else {
          ctx.logger.info(
            "backup",
            "configuration backup restored; in-memory state reloaded",
          );
        }
        reloadWarnings = reloadErrors;
      });
      json(res, 200, {
        ok: true,
        restartRequired: true,
        note: backup.note,
        warnings: reloadWarnings,
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
