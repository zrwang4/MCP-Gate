import { appendFile, mkdir, rename, stat } from "node:fs/promises";
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
    this.#maxEntries = maxEntries;
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

  list(options?: { after?: number; limit?: number; level?: LogLevel }): LogEntry[] {
    const after = options?.after ?? 0;
    const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
    const level = options?.level;

    const filtered = this.#entries.filter(
      (entry) => entry.seq > after && (!level || entry.level === level),
    );

    return filtered.slice(-limit);
  }

  clear(): void {
    this.#entries = [];
  }

  get filePath(): string {
    return this.#logFile;
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

function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/((?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:api[_-]?key|token|password|secret)=)[^&\s]+/gi, "$1[REDACTED]");
}
