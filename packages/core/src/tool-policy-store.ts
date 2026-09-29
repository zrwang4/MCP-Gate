import { mkdir, readFile, rename } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { writeJsonWithBackup } from "./atomic-write.ts";
import type { CoreLogger } from "./logger.ts";

interface ToolPolicyFile {
  version: 1;
  disabled: Record<string, string[]>;
}

export class ToolPolicyStore {
  #filePath: string;
  #logger: CoreLogger;
  #disabled = new Map<string, Set<string>>();

  constructor(filePath: string, logger: CoreLogger) {
    this.#filePath = filePath;
    this.#logger = logger;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });

    try {
      const raw = await readFile(this.#filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ToolPolicyFile>;
      if (parsed.version !== 1 || !parsed.disabled || typeof parsed.disabled !== "object") {
        throw new Error("unsupported tool policy format");
      }

      this.#disabled.clear();
      for (const [serverId, names] of Object.entries(parsed.disabled)) {
        if (!Array.isArray(names)) continue;
        this.#disabled.set(
          serverId,
          new Set(names.filter((name): name is string => typeof name === "string")),
        );
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        await this.#persist();
        return;
      }

      const backup = `${this.#filePath}.corrupt-${Date.now()}`;
      await rename(this.#filePath, backup).catch(() => undefined);
      this.#disabled.clear();
      await this.#persist();
      this.#logger.warn(
        "tools",
        `invalid tool policy reset; backup: ${backup}; reason: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  isEnabled(serverId: string, originalName: string): boolean {
    return !this.#disabled.get(serverId)?.has(originalName);
  }

  async setEnabled(
    serverId: string,
    originalName: string,
    enabled: boolean,
  ): Promise<void> {
    const previous = new Map(
      [...this.#disabled.entries()].map(([id, names]) => [id, new Set(names)] as const),
    );
    const names = this.#disabled.get(serverId) ?? new Set<string>();
    if (enabled) names.delete(originalName);
    else names.add(originalName);

    if (names.size === 0) this.#disabled.delete(serverId);
    else this.#disabled.set(serverId, names);

    try {
      await this.#persist();
    } catch (error) {
      this.#disabled = previous;
      throw error;
    }
  }

  async removeServer(serverId: string): Promise<void> {
    const previous = new Map(
      [...this.#disabled.entries()].map(([id, names]) => [id, new Set(names)] as const),
    );
    if (!this.#disabled.delete(serverId)) return;
    try {
      await this.#persist();
    } catch (error) {
      this.#disabled = previous;
      throw error;
    }
  }

  async #persist(): Promise<void> {
    const payload: ToolPolicyFile = {
      version: 1,
      disabled: Object.fromEntries(
        [...this.#disabled.entries()].map(([serverId, names]) => [
          serverId,
          [...names].sort(),
        ]),
      ),
    };

    await writeJsonWithBackup(payload, {
      directory: dirname(this.#filePath),
      fileName: basename(this.#filePath),
      logger: this.#logger,
    });
  }
}
