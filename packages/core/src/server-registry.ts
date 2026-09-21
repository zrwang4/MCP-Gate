import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CoreLogger } from "./logger.ts";

interface ServerConfigBase {
  id: string;
  name: string;
  alias: string;
  enabled: boolean;
  autoStart: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StdioServerConfig extends ServerConfigBase {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
}

export interface HttpServerConfig extends ServerConfigBase {
  transport: "http";
  url: string;
}

export type McpServerConfig = StdioServerConfig | HttpServerConfig;

export interface ServerConfigInput {
  name: string;
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
}

interface RegistryFile {
  version: 1;
  servers: McpServerConfig[];
}

export class ServerRegistry {
  #filePath: string;
  #logger: CoreLogger;
  #servers: McpServerConfig[] = [];

  constructor(filePath: string, logger: CoreLogger) {
    this.#filePath = filePath;
    this.#logger = logger;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });

    try {
      const raw = await readFile(this.#filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.servers)) {
        throw new Error("unsupported registry format");
      }
      this.#servers = parsed.servers.filter(isServerConfig);
      this.#logger.info("registry", `loaded ${this.#servers.length} MCP configuration(s)`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        await this.#persist();
        this.#logger.info("registry", "created empty MCP server registry");
        return;
      }

      const backup = `${this.#filePath}.corrupt-${Date.now()}`;
      await rename(this.#filePath, backup).catch(() => undefined);
      this.#servers = [];
      await this.#persist();
      this.#logger.warn(
        "registry",
        `invalid registry was reset; backup: ${backup}; reason: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  list(): McpServerConfig[] {
    return this.#servers.map(cloneServer);
  }

  async create(input: ServerConfigInput): Promise<McpServerConfig> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const server = this.#buildConfig(input, {
      id,
      alias: this.#uniqueAlias(input.name, id),
      enabled: true,
      autoStart: false,
      createdAt: now,
      updatedAt: now,
    });

    this.#servers.push(server);
    await this.#persist();
    this.#logger.info(
      "registry",
      `added MCP configuration: ${server.name} (${server.alias}) transport=${server.transport}`,
    );
    return cloneServer(server);
  }

  async update(
    id: string,
    input: ServerConfigInput,
  ): Promise<McpServerConfig | undefined> {
    const index = this.#servers.findIndex((item) => item.id === id);
    if (index < 0) return undefined;

    const current = this.#servers[index];
    const updated = this.#buildConfig(
      {
        ...input,
        transport: input.transport ?? current.transport,
      },
      {
        id: current.id,
        alias: current.alias,
        enabled: current.enabled,
        autoStart: current.autoStart,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      },
    );

    this.#servers[index] = updated;
    await this.#persist();
    this.#logger.info(
      "registry",
      `updated MCP configuration: ${updated.name} (${updated.alias}) transport=${updated.transport}`,
    );
    return cloneServer(updated);
  }

  async updateSettings(
    id: string,
    input: { enabled?: boolean; autoStart?: boolean },
  ): Promise<McpServerConfig | undefined> {
    const server = this.#servers.find((item) => item.id === id);
    if (!server) return undefined;

    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") {
        throw new Error("enabled must be a boolean");
      }
      server.enabled = input.enabled;
    }

    if (input.autoStart !== undefined) {
      if (typeof input.autoStart !== "boolean") {
        throw new Error("autoStart must be a boolean");
      }
      server.autoStart = input.autoStart;
    }

    server.updatedAt = new Date().toISOString();
    await this.#persist();
    this.#logger.info(
      "registry",
      `updated MCP settings: ${server.name} enabled=${server.enabled} autoStart=${server.autoStart}`,
    );
    return cloneServer(server);
  }

  async remove(id: string): Promise<boolean> {
    const index = this.#servers.findIndex((server) => server.id === id);
    if (index < 0) return false;

    const [removed] = this.#servers.splice(index, 1);
    await this.#persist();
    this.#logger.info("registry", `removed MCP configuration: ${removed.name} (${removed.alias})`);
    return true;
  }

  #buildConfig(
    input: ServerConfigInput,
    meta: Omit<ServerConfigBase, "name">,
  ): McpServerConfig {
    const name = validateText("name", input.name, 80);
    const transport = input.transport ?? "stdio";

    if (transport === "http") {
      return {
        ...meta,
        name,
        transport: "http",
        url: validateHttpUrl(input.url),
      };
    }

    const command = validateText("command", input.command, 2048);
    const cwd = input.cwd?.trim() || undefined;
    if (cwd && cwd.length > 4096) throw new Error("cwd is too long");

    return {
      ...meta,
      name,
      transport: "stdio",
      command,
      args: validateArgs(input.args ?? []),
      cwd,
    };
  }

  async #persist(): Promise<void> {
    const payload: RegistryFile = {
      version: 1,
      servers: this.#servers,
    };
    const tempPath = `${this.#filePath}.tmp-${process.pid}`;
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, this.#filePath);
  }

  #uniqueAlias(name: string, id: string): string {
    const base =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "mcp";

    if (!this.#servers.some((server) => server.alias === base)) return base;
    return `${base}-${id.slice(0, 6)}`;
  }
}

function validateText(field: string, value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > maxLength) throw new Error(`${field} is too long`);
  return trimmed;
}

function validateArgs(values: string[]): string[] {
  if (!Array.isArray(values)) throw new Error("args must be an array");
  if (values.length > 100) throw new Error("too many arguments");

  return values.map((arg, index) => {
    if (typeof arg !== "string") throw new Error(`args[${index}] must be a string`);
    if (arg.length > 4096) throw new Error(`args[${index}] is too long`);
    return arg;
  });
}

function validateHttpUrl(value: unknown): string {
  const raw = validateText("url", value, 4096);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("url must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must use http or https");
  }
  return url.toString();
}

function cloneServer(server: McpServerConfig): McpServerConfig {
  return server.transport === "stdio"
    ? { ...server, args: [...server.args] }
    : { ...server };
}

function isServerConfig(value: unknown): value is McpServerConfig {
  if (!value || typeof value !== "object") return false;
  const server = value as Partial<McpServerConfig> & Record<string, unknown>;

  const baseValid =
    typeof server.id === "string" &&
    typeof server.name === "string" &&
    typeof server.alias === "string" &&
    typeof server.enabled === "boolean" &&
    typeof server.autoStart === "boolean" &&
    typeof server.createdAt === "string" &&
    typeof server.updatedAt === "string";

  if (!baseValid) return false;

  if (server.transport === "http") {
    return typeof server.url === "string";
  }

  return (
    server.transport === "stdio" &&
    typeof server.command === "string" &&
    Array.isArray(server.args) &&
    server.args.every((arg) => typeof arg === "string") &&
    (server.cwd === undefined || typeof server.cwd === "string")
  );
}
