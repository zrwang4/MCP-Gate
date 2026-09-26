import { copyFile, mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CoreLogger } from "./logger.ts";

/**
 * Backs up the current file, then swaps in the new contents. The rename keeps
 * the swap itself atomic, so readers see either the old or the new file, never
 * a half-written one.
 */
async function writeAtomic(target: string, contents: string): Promise<void> {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempPath = `${target}.tmp-${unique}`;
  await writeFile(tempPath, contents, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, target);
}

/**
 * Content-addressed rotation: keeps the newest `maxBackups` copies, keyed by
 * millisecond timestamp so two writes inside the same millisecond still land
 * in separate files.
 */
async function pruneBackups(
  backupsDir: string,
  fileStem: string,
  maxBackups: number,
): Promise<void> {
  let entries: { name: string; stamp: number; serial: string }[];
  try {
    const names = await readdir(backupsDir);
    entries = names
      .map((name) => {
        const match = /^(.*)\.(\d{13})-([0-9a-z]+)\.bak$/.exec(name);
        return match && match[1] === fileStem
          ? { name, stamp: Number(match[2]), serial: match[3] }
          : null;
      })
      .filter(
        (entry): entry is { name: string; stamp: number; serial: string } => entry !== null,
      )
      // Timestamp first, then serial for writes that share a millisecond.
      .sort(
        (a, b) =>
          a.stamp - b.stamp ||
          (a.serial < b.serial ? -1 : a.serial > b.serial ? 1 : 0),
      );
  } catch {
    return;
  }

  const excess = entries.slice(0, Math.max(0, entries.length - maxBackups));
  await Promise.all(
    excess.map((entry) => unlink(`${backupsDir}/${entry.name}`).catch(() => undefined)),
  );
}

export interface AtomicWriteOptions {
  directory: string;
  fileName: string;
  logger?: CoreLogger;
  maxBackups?: number;
}

/**
 * Writes JSON to a file with two safety nets on top of the atomic swap:
 *
 * 1. The previous contents are copied aside before the swap, so a bad edit is
 *    recoverable from disk.
 * 2. Only the newest `maxBackups` copies are kept, so the directory does not
 *    grow without bound.
 *
 * Backups live in `<directory>/backups/<fileName>.<millis>.bak`.
 */
export async function writeJsonWithBackup(
  value: unknown,
  options: AtomicWriteOptions,
): Promise<void> {
  const { directory, fileName, logger, maxBackups = 20 } = options;
  const target = `${directory}/${fileName}`;
  const backupsDir = `${directory}/backups`;
  const fileStem = fileName.replace(/\.json$/i, "");

  await mkdir(directory, { recursive: true });
  const contents = `${JSON.stringify(value, null, 2)}\n`;

  // Copy before the swap: the backup captures the state the user had before
  // this write, not the one we are about to install.
  try {
    const stamp = Date.now();
    const serial = Math.random().toString(36).slice(2, 8);
    const backupPath = `${backupsDir}/${fileStem}.${stamp}-${serial}.bak`;
    await mkdir(backupsDir, { recursive: true });
    await copyFile(target, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger?.warn(
        "backup",
        `failed to back up ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await writeAtomic(target, contents);
  await pruneBackups(backupsDir, fileStem, maxBackups);
}
