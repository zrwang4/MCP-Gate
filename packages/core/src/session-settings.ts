import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { writeJsonWithBackup } from "./atomic-write.ts";
import type { CoreLogger } from "./logger.ts";

const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;
const MIN_SESSION_IDLE_TIMEOUT_MS = 60_000;
const MAX_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60_000;

interface SessionSettingsFile {
  version: 1;
  idleTimeoutMs: number;
}

export function normalizeSessionIdleTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("session idle timeout must be an integer");
  }
  if (
    value < MIN_SESSION_IDLE_TIMEOUT_MS ||
    value > MAX_SESSION_IDLE_TIMEOUT_MS
  ) {
    throw new Error("session idle timeout must be between 1 minute and 24 hours");
  }
  return value;
}

export async function loadSessionIdleTimeout(
  filePath: string,
  fallback = DEFAULT_SESSION_IDLE_TIMEOUT_MS,
): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<SessionSettingsFile>;
    if (parsed.version !== 1) {
      throw new Error("unsupported session settings format");
    }
    return normalizeSessionIdleTimeout(parsed.idleTimeoutMs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function saveSessionIdleTimeout(
  filePath: string,
  idleTimeoutMs: number,
  logger?: CoreLogger,
): Promise<number> {
  const normalized = normalizeSessionIdleTimeout(idleTimeoutMs);
  await writeJsonWithBackup(
    {
      version: 1,
      idleTimeoutMs: normalized,
    } satisfies SessionSettingsFile,
    {
      directory: dirname(filePath),
      fileName: basename(filePath),
      logger,
    },
  );
  return normalized;
}

export function sessionSettingsSnapshot(idleTimeoutMs: number): SessionSettingsFile {
  return {
    version: 1,
    idleTimeoutMs: normalizeSessionIdleTimeout(idleTimeoutMs),
  };
}
