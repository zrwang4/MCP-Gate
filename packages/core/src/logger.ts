import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_LOG_BYTES = 2 * 1024 * 1024;

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  seq: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

export class CoreLogger {
  #entries: LogEntry[] = [];
  #nextSeq = 1;
  #maxEntries: number;
  #logFile: string;
  #pendingLines: string[] = [];
  #pendingBytes = 0;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #flushPromise: Promise<void> | null = null;
  #fileBytes = 0;
  #pendingOverflowWarned = false;

  constructor(logFile: string, maxEntries = 1000) {
    this.#logFile = logFile;
    this.#maxEntries = Math.max(1, maxEntries);
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#logFile), { recursive: true });
    await this.#rotateIfNeeded();
    try {
      this.#fileBytes = (await stat(this.#logFile)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#fileBytes = 0;
    }

    await this.#loadExisting();
  }

  debug(source: string, message: string): void {
    this.#log("debug", source, message);
  }

  info(source: string, message: string): void {
    this.#log("info", source, message);
  }

  warn(source: string, message: string): void {
    this.#log("warn", source, message);
  }

  error(source: string, message: string): void {
    this.#log("error", source, message);
  }

  list(options?: {
    after?: number;
    limit?: number;
    level?: LogLevel;
    source?: string;
    contains?: string;
  }): LogEntry[] {
    const after = options?.after ?? 0;
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
    const level = options?.level;
    const source = options?.source?.trim();
    const contains = options?.contains?.trim().toLowerCase();

    const filtered = this.#entries.filter(
      (entry) =>
        entry.seq > after &&
        (!level || entry.level === level) &&
        (!source || entry.source === source) &&
        (!contains || entry.message.toLowerCase().includes(contains)),
    );

    return filtered.slice(-limit).map((entry) => ({ ...entry }));
  }

  clear(): void {
    this.#entries = [];
  }

  get filePath(): string {
    return this.#logFile;
  }

  async flush(): Promise<void> {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    await this.#flushPending();
  }

  async #rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.#logFile);
      if (info.size >= MAX_LOG_FILE_BYTES) {
        await rename(this.#logFile, this.#logFile + ".1");
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

  #trimPendingBuffer(): void {
    while (
      this.#pendingLines.length > 1 &&
      this.#pendingBytes > MAX_PENDING_LOG_BYTES
    ) {
      const dropped = this.#pendingLines.shift();
      this.#pendingBytes -= dropped ? Buffer.byteLength(dropped, "utf8") : 0;
    }

    if (this.#pendingBytes > MAX_PENDING_LOG_BYTES && !this.#pendingOverflowWarned) {
      this.#pendingOverflowWarned = true;
      console.warn("[logger] pending log buffer exceeded 2 MiB; dropping oldest pending entries");
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
            this.#fileBytes + nextBatchBytes > MAX_LOG_FILE_BYTES
          ) {
            await this.#rotateIfNeeded();
          }
          await appendFile(this.#logFile, nextBatch, "utf8");
          this.#fileBytes += nextBatchBytes;
          this.#pendingOverflowWarned = false;
        } catch (error) {
          console.error(`[logger] failed to write log file: ${String(error)}`);
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
      const raw = await readFile(this.#logFile, "utf8");
      const entries: LogEntry[] = [];

      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Partial<LogEntry>;
          const seq = parsed.seq;
          const timestamp = parsed.timestamp;
          const level = parsed.level;
          const source = parsed.source;
          const message = parsed.message;
          if (
            typeof seq === "number" && Number.isInteger(seq) &&
            typeof timestamp === "string" &&
            (level === "debug" ||
              level === "info" ||
              level === "warn" ||
              level === "error") &&
            typeof source === "string" &&
            typeof message === "string"
          ) {
            entries.push({
              seq,
              timestamp,
              level,
              source,
              message,
            });
          }
        } catch {
          // Ignore an incomplete/corrupt JSONL line and keep readable history.
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

  #log(level: LogLevel, source: string, message: string): void {
    const normalized = redactSecrets(message.trim());
    if (!normalized) return;

    const entry: LogEntry = {
      seq: this.#nextSeq++,
      timestamp: new Date().toISOString(),
      level,
      source,
      message: normalized,
    };

    this.#entries.push(entry);
    if (this.#entries.length > this.#maxEntries) {
      this.#entries.splice(0, this.#entries.length - this.#maxEntries);
    }

    const printable = `[${entry.timestamp}] [${level.toUpperCase()}] [${source}] ${normalized}`;
    if (level === "error") console.error(printable);
    else if (level === "warn") console.warn(printable);
    else console.info(printable);

    const line = `${JSON.stringify(entry)}\n`;
    this.#pendingLines.push(line);
    this.#pendingBytes += Buffer.byteLength(line, "utf8");
    this.#trimPendingBuffer();
    if (this.#pendingBytes >= 64 * 1024) {
      void this.#flushPending();
    } else {
      this.#scheduleFlush();
    }
  }
}

export function redactSecrets(value: string): string {
  const secretKey =
    "(?:authorization|api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|password|secret|client[_-]?secret|cookie)";
  // `authorization` is handled by its own rule below (which preserves the
  // Bearer prefix); including it here would redact that prefix as the value.
  const plainSecretKey = secretKey.replace("authorization|", "");
  return value
    .replace(
      new RegExp(`("(?:${secretKey})"\\s*:\\s*")([^"]*)(")`, "gi"),
      "$1[REDACTED]$3",
    )
    .replace(
      new RegExp(`(authorization\\s*[:=]\\s*)(bearer\\s+)?[^\\s,;]+`, "gi"),
      "$1$2[REDACTED]",
    )
    .replace(
      new RegExp(`(${plainSecretKey}\\s*[:=]\\s*)[^\\s,;&]+`, "gi"),
      "$1[REDACTED]",
    )
    .replace(
      new RegExp(`([?&](?:${secretKey}))=[^&\\s]+`, "gi"),
      "$1=[REDACTED]",
    );
}
