import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { redactSecrets } from "./logger.ts";

export type AuditSource = "gateway" | "tester";

export interface AuditEntry {
  seq: number;
  timestamp: string;
  source: AuditSource;
  publicName: string;
  serverId: string;
  serverAlias: string;
  originalName: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface AuditRecordInput {
  source: AuditSource;
  publicName: string;
  serverId: string;
  serverAlias: string;
  originalName: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export class AuditLogger {
  #filePath: string;
  #entries: AuditEntry[] = [];
  #nextSeq = 1;
  #maxEntries: number;
  #writeQueue = Promise.resolve();

  constructor(filePath: string, maxEntries = 1000) {
    this.#filePath = filePath;
    this.#maxEntries = Math.max(1, maxEntries);
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    await this.#rotateIfNeeded();
    await this.#loadExisting();
  }

  record(input: AuditRecordInput): AuditEntry {
    const entry: AuditEntry = {
      seq: this.#nextSeq++,
      timestamp: new Date().toISOString(),
      source: input.source,
      publicName: input.publicName,
      serverId: input.serverId,
      serverAlias: input.serverAlias,
      originalName: input.originalName,
      success: input.success,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      ...(input.error
        ? { error: redactSecrets(input.error.trim()) }
        : {}),
    };

    this.#entries.push(entry);
    if (this.#entries.length > this.#maxEntries) {
      this.#entries.splice(0, this.#entries.length - this.#maxEntries);
    }

    this.#writeQueue = this.#writeQueue
      .then(() =>
        appendFile(this.#filePath, `${JSON.stringify(entry)}\n`, "utf8"),
      )
      .catch((error) => {
        console.error(`[audit] failed to write audit file: ${String(error)}`);
      });

    return { ...entry };
  }

  list(options?: {
    after?: number;
    limit?: number;
    success?: boolean;
    source?: AuditSource;
    serverId?: string;
    publicName?: string;
  }): AuditEntry[] {
    const after = options?.after ?? 0;
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 1000);
    const serverId = options?.serverId?.trim();
    const publicName = options?.publicName?.trim();

    return this.#entries
      .filter(
        (entry) =>
          entry.seq > after &&
          (options?.success === undefined || entry.success === options.success) &&
          (!options?.source || entry.source === options.source) &&
          (!serverId || entry.serverId === serverId) &&
          (!publicName || entry.publicName === publicName),
      )
      .slice(-limit)
      .map((entry) => ({ ...entry }));
  }

  get filePath(): string {
    return this.#filePath;
  }

  async flush(): Promise<void> {
    await this.#writeQueue;
  }

  async #loadExisting(): Promise<void> {
    try {
      const raw = await readFile(this.#filePath, "utf8");
      const entries: AuditEntry[] = [];

      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Partial<AuditEntry>;
          const seq = parsed.seq;
          const timestamp = parsed.timestamp;
          const source = parsed.source;
          const publicName = parsed.publicName;
          const serverId = parsed.serverId;
          const serverAlias = parsed.serverAlias;
          const originalName = parsed.originalName;
          const success = parsed.success;
          const durationMs = parsed.durationMs;
          const errorValue = parsed.error;
          if (
            typeof seq === "number" && Number.isInteger(seq) &&
            typeof timestamp === "string" &&
            (source === "gateway" || source === "tester") &&
            typeof publicName === "string" &&
            typeof serverId === "string" &&
            typeof serverAlias === "string" &&
            typeof originalName === "string" &&
            typeof success === "boolean" &&
            typeof durationMs === "number"
          ) {
            entries.push({
              seq,
              timestamp,
              source,
              publicName,
              serverId,
              serverAlias,
              originalName,
              success,
              durationMs,
              ...(typeof errorValue === "string"
                ? { error: errorValue }
                : {}),
            });
          }
        } catch {
          // Ignore malformed JSONL lines while preserving valid audit history.
        }
      }

      this.#entries = entries.slice(-this.#maxEntries);
      const maxSeq = this.#entries.reduce(
        (max, entry) => Math.max(max, entry.seq),
        0,
      );
      this.#nextSeq = maxSeq + 1;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  async #rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.#filePath);
      if (info.size >= 5 * 1024 * 1024) {
        await rename(this.#filePath, `${this.#filePath}.1`).catch(
          () => undefined,
        );
      }
    } catch {
      // The file does not exist yet.
    }
  }
}
