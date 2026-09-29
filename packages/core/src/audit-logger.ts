import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { redactSecrets } from "./logger.ts";

const MAX_AUDIT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_AUDIT_BYTES = 2 * 1024 * 1024;

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
  #pendingLines: string[] = [];
  #pendingBytes = 0;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #flushPromise: Promise<void> | null = null;
  #fileBytes = 0;
  #pendingOverflowWarned = false;

  constructor(filePath: string, maxEntries = 1000) {
    this.#filePath = filePath;
    this.#maxEntries = Math.max(1, maxEntries);
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    await this.#rotateIfNeeded();
    try {
      this.#fileBytes = (await stat(this.#filePath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#fileBytes = 0;
    }
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

    const line = `${JSON.stringify(entry)}\n`;
    this.#pendingLines.push(line);
    this.#pendingBytes += Buffer.byteLength(line, "utf8");
    this.#trimPendingBuffer();
    if (this.#pendingBytes >= 64 * 1024) {
      void this.#flushPending();
    } else {
      this.#scheduleFlush();
    }

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
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    await this.#flushPending();
  }

  #trimPendingBuffer(): void {
    while (
      this.#pendingLines.length > 1 &&
      this.#pendingBytes > MAX_PENDING_AUDIT_BYTES
    ) {
      const dropped = this.#pendingLines.shift();
      this.#pendingBytes -= dropped ? Buffer.byteLength(dropped, "utf8") : 0;
    }

    if (this.#pendingBytes > MAX_PENDING_AUDIT_BYTES && !this.#pendingOverflowWarned) {
      this.#pendingOverflowWarned = true;
      console.warn("[audit] pending audit buffer exceeded 2 MiB; dropping oldest pending entries");
    }
  }

  #scheduleFlush(): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.#flushPending();
    }, 250);
    (this.#flushTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  async #flushPending(): Promise<void> {
    if (this.#flushPromise) return this.#flushPromise;
    if (this.#pendingLines.length === 0) return;

    this.#flushPromise = (async () => {
      while (this.#pendingLines.length > 0) {
        const nextBatch = this.#pendingLines.join("");
        const nextBatchBytes = Buffer.byteLength(nextBatch, "utf8");
        this.#pendingLines = [];
        this.#pendingBytes = 0;
        try {
          if (
            this.#fileBytes > 0 &&
            this.#fileBytes + nextBatchBytes > MAX_AUDIT_FILE_BYTES
          ) {
            await this.#rotateActiveFile();
          }
          await appendFile(this.#filePath, nextBatch, "utf8");
          this.#fileBytes += nextBatchBytes;
          this.#pendingOverflowWarned = false;
        } catch (error) {
          console.error(`[audit] failed to write audit file: ${String(error)}`);
        }
      }
    })().finally(() => {
      this.#flushPromise = null;
      if (this.#pendingLines.length > 0) {
        void this.#flushPending();
      }
    });

    return this.#flushPromise;
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

  async #rotateActiveFile(): Promise<void> {
    await rename(this.#filePath, this.#filePath + ".1");
    this.#fileBytes = 0;
  }

  async #rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.#filePath);
      if (info.size >= MAX_AUDIT_FILE_BYTES) {
        await rename(this.#filePath, this.#filePath + ".1");
        this.#fileBytes = 0;
      } else {
        this.#fileBytes = info.size;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.#fileBytes = 0;
        return;
      }
      throw error;
    }
  }
}
