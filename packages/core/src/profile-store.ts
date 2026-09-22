import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CoreLogger } from "./logger.ts";

export interface McpProfile {
  id: string;
  name: string;
  serverIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProfileFile {
  version: 1;
  activeProfileId: string | null;
  profiles: McpProfile[];
}

export class ProfileStore {
  #filePath: string;
  #logger: CoreLogger;
  #profiles: McpProfile[] = [];
  #activeProfileId: string | null = null;

  constructor(filePath: string, logger: CoreLogger) {
    this.#filePath = filePath;
    this.#logger = logger;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });

    try {
      const raw = await readFile(this.#filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ProfileFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
        throw new Error("unsupported profile format");
      }

      this.#profiles = parsed.profiles.filter(isProfile).map(cloneProfile);
      this.#activeProfileId =
        typeof parsed.activeProfileId === "string" &&
        this.#profiles.some((profile) => profile.id === parsed.activeProfileId)
          ? parsed.activeProfileId
          : null;

      this.#logger.info(
        "profiles",
        `loaded ${this.#profiles.length} profile(s)${this.#activeProfileId ? `; active=${this.#activeProfileId}` : ""}`,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        await this.#persist();
        this.#logger.info("profiles", "created empty profile store");
        return;
      }

      const backup = `${this.#filePath}.corrupt-${Date.now()}`;
      await rename(this.#filePath, backup).catch(() => undefined);
      this.#profiles = [];
      this.#activeProfileId = null;
      await this.#persist();
      this.#logger.warn(
        "profiles",
        `invalid profile store reset; backup: ${backup}; reason: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  list(): McpProfile[] {
    return this.#profiles.map(cloneProfile);
  }

  get(id: string): McpProfile | undefined {
    const profile = this.#profiles.find((item) => item.id === id);
    return profile ? cloneProfile(profile) : undefined;
  }

  get activeProfileId(): string | null {
    return this.#activeProfileId;
  }

  getActive(): McpProfile | undefined {
    return this.#activeProfileId
      ? this.get(this.#activeProfileId)
      : undefined;
  }

  async create(name: string, serverIds: string[]): Promise<McpProfile> {
    const now = new Date().toISOString();
    const profile: McpProfile = {
      id: randomUUID(),
      name: validateName(name),
      serverIds: validateServerIds(serverIds),
      createdAt: now,
      updatedAt: now,
    };

    this.#profiles.push(profile);
    await this.#persist();
    this.#logger.info("profiles", `created profile: ${profile.name}`);
    return cloneProfile(profile);
  }

  async update(
    id: string,
    input: { name: string; serverIds: string[] },
  ): Promise<McpProfile | undefined> {
    const profile = this.#profiles.find((item) => item.id === id);
    if (!profile) return undefined;

    profile.name = validateName(input.name);
    profile.serverIds = validateServerIds(input.serverIds);
    profile.updatedAt = new Date().toISOString();

    await this.#persist();
    this.#logger.info("profiles", `updated profile: ${profile.name}`);
    return cloneProfile(profile);
  }

  async setActive(id: string | null): Promise<void> {
    if (id !== null && !this.#profiles.some((profile) => profile.id === id)) {
      throw new Error("profile not found");
    }

    this.#activeProfileId = id;
    await this.#persist();
    this.#logger.info("profiles", id ? `activated profile: ${id}` : "cleared active profile");
  }

  async remove(id: string): Promise<boolean> {
    const index = this.#profiles.findIndex((profile) => profile.id === id);
    if (index < 0) return false;

    const [removed] = this.#profiles.splice(index, 1);
    if (this.#activeProfileId === id) {
      this.#activeProfileId = null;
    }
    await this.#persist();
    this.#logger.info("profiles", `removed profile: ${removed.name}`);
    return true;
  }

  async removeServer(serverId: string): Promise<void> {
    let changed = false;
    for (const profile of this.#profiles) {
      const next = profile.serverIds.filter((id) => id !== serverId);
      if (next.length !== profile.serverIds.length) {
        profile.serverIds = next;
        profile.updatedAt = new Date().toISOString();
        changed = true;
      }
    }

    if (changed) {
      await this.#persist();
      this.#logger.info("profiles", `removed server ${serverId} from profiles`);
    }
  }

  async #persist(): Promise<void> {
    const payload: ProfileFile = {
      version: 1,
      activeProfileId: this.#activeProfileId,
      profiles: this.#profiles,
    };
    const tempPath = `${this.#filePath}.tmp-${process.pid}`;
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, this.#filePath);
  }
}

function validateName(value: unknown): string {
  if (typeof value !== "string") throw new Error("profile name must be a string");
  const name = value.trim();
  if (!name) throw new Error("profile name is required");
  if (name.length > 80) throw new Error("profile name is too long");
  return name;
}

function validateServerIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("serverIds must be an array");
  if (value.length > 100) throw new Error("too many servers in profile");

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("serverIds must contain non-empty strings");
    }
    const id = item.trim();
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function cloneProfile(profile: McpProfile): McpProfile {
  return {
    ...profile,
    serverIds: [...profile.serverIds],
  };
}

function isProfile(value: unknown): value is McpProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<McpProfile>;
  return (
    typeof profile.id === "string" &&
    typeof profile.name === "string" &&
    Array.isArray(profile.serverIds) &&
    profile.serverIds.every((id) => typeof id === "string") &&
    typeof profile.createdAt === "string" &&
    typeof profile.updatedAt === "string"
  );
}
