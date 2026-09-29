import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

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
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(logFile: string, maxEntries = 1000) {
    this.#logFile = logFile;
    this.#maxEntries = Math.max(1, maxEntries);
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#logFile), { recursive: true });
    try {
      const info = await stat(this.#logFile);
      if (info.size >= 5 * 1024 * 1024) {
        await rename(this.#logFile, `${this.#logFile}.1`).catch(() => undefined);
      }
    } catch {
      // The file does not exist yet.
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
    await this.#writeQueue;
  }

  async #loadExisting(): Promise<void> {
    try {
      const raw = await readFile(this.#logFile, "utf8");
      const entries: LogEntry[] = [];

      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Partial<LogEntry>;
          if (
            Number.isInteger(parsed.seq) &&
            typeof parsed.timestamp === "string" &&
            (parsed.level === "debug" ||
              parsed.level === "info" ||
              parsed.level === "warn" ||
              parsed.level === "error") &&
            typeof parsed.source === "string" &&
            typeof parsed.message === "string"
          ) {
            entries.push({
              seq: parsed.seq,
              timestamp: parsed.timestamp,
              level: parsed.level,
              source: parsed.source,
              message: parsed.message,
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

    this.#writeQueue = this.#writeQueue
      .then(() => appendFile(this.#logFile, `${JSON.stringify(entry)}\n`, "utf8"))
      .catch((error) => {
        console.error(`[logger] failed to write log file: ${String(error)}`);
      });
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
