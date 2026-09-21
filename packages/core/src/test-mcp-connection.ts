import type { CoreLogger } from "./logger.ts";
import { HttpUpstreamClient } from "./http-upstream-client.ts";
import type {
  HttpServerConfig,
  McpServerConfig,
  ServerRegistry,
  StdioServerConfig,
} from "./server-registry.ts";
import {
  MemorySecretStore,
  type SecretStore,
} from "./secret-store.ts";
import { StdioUpstreamClient } from "./stdio-upstream-client.ts";
import type { UpstreamClient } from "./upstream-manager.ts";

export interface McpConnectionTestInput {
  serverId?: unknown;
  transport?: unknown;
  command?: unknown;
  args?: unknown;
  cwd?: unknown;
  env?: unknown;
  secretEnvKeys?: unknown;
  secretEnv?: unknown;
  url?: unknown;
  authorization?: unknown;
  clearAuthorization?: unknown;
}

export interface McpConnectionTestResult {
  transport: "stdio" | "http";
  toolCount: number;
  toolNames: string[];
  durationMs: number;
}

export type ConnectionTestClientFactory = (
  config: McpServerConfig,
  secrets: SecretStore,
) => Promise<UpstreamClient> | UpstreamClient;

export async function testMcpConnection(
  input: McpConnectionTestInput,
  registry: ServerRegistry,
  persistentSecrets: SecretStore,
  logger: CoreLogger,
  factory: ConnectionTestClientFactory = createTestClient,
): Promise<McpConnectionTestResult> {
  const startedAt = Date.now();
  const serverId =
    typeof input.serverId === "string" && input.serverId
      ? input.serverId
      : undefined;
  const existing = serverId ? registry.get(serverId) : undefined;

  if (serverId && !existing) {
    throw new Error("server configuration not found");
  }

  const transport =
    input.transport === "http"
      ? "http"
      : input.transport === "stdio"
        ? "stdio"
        : existing?.transport ?? "stdio";

  const temporarySecrets = new MemorySecretStore();
  let config: McpServerConfig;

  if (transport === "stdio") {
    config = await buildStdioTestConfig(
      input,
      existing,
      persistentSecrets,
    );
  } else {
    config = await buildHttpTestConfig(
      input,
      existing,
      persistentSecrets,
      temporarySecrets,
    );
  }

  const client = await factory(config, temporarySecrets);
  let connected = false;

  try {
    await client.connect();
    connected = true;
    const tools = await client.listTools();
    const result: McpConnectionTestResult = {
      transport,
      toolCount: tools.length,
      toolNames: tools.map((tool) => tool.name).slice(0, 50),
      durationMs: Date.now() - startedAt,
    };

    logger.info(
      "connection-test",
      `connection test succeeded: transport=${transport} tools=${result.toolCount} durationMs=${result.durationMs}`,
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      "connection-test",
      `connection test failed: transport=${transport}: ${message}`,
    );
    throw error;
  } finally {
    if (connected) {
      await client.disconnect().catch(() => undefined);
    } else {
      await client.disconnect().catch(() => undefined);
    }
  }
}

async function buildStdioTestConfig(
  input: McpConnectionTestInput,
  existing: McpServerConfig | undefined,
  persistentSecrets: SecretStore,
): Promise<StdioServerConfig> {
  const command = validateRequiredString("command", input.command, 2048);
  const args = validateStringArray(input.args ?? [], "args", 100, 4096);
  const cwd = validateOptionalString("cwd", input.cwd, 4096);
  const env = normalizeEnvironmentRecord(input.env);
  const secretEnvKeys = normalizeEnvironmentKeys(input.secretEnvKeys);
  const secretEnv = normalizeEnvironmentRecord(input.secretEnv);

  for (const key of Object.keys(env)) {
    if (secretEnvKeys.includes(key)) {
      throw new Error(
        `environment variable ${key} cannot be both plain and secret`,
      );
    }
  }
  for (const key of Object.keys(secretEnv)) {
    if (!secretEnvKeys.includes(key)) {
      throw new Error(
        `secret value supplied for unlisted key: ${key}`,
      );
    }
  }

  const combinedEnv: Record<string, string> = { ...env };

  for (const key of secretEnvKeys) {
    const supplied = secretEnv[key];
    if (supplied !== undefined && supplied !== "") {
      combinedEnv[key] = supplied;
      continue;
    }

    const existingSecretId =
      existing?.transport === "stdio"
        ? existing.envSecretIds?.[key]
        : undefined;
    if (!existingSecretId) {
      throw new Error(
        `secret environment value is required for ${key}`,
      );
    }

    const value = await persistentSecrets.get(existingSecretId);
    if (value === null) {
      throw new Error(
        `environment secret ${key} is missing from secure storage`,
      );
    }
    combinedEnv[key] = value;
  }

  const now = new Date().toISOString();
  return {
    id: "connection-test",
    name: "Connection Test",
    alias: "connection-test",
    transport: "stdio",
    command,
    args,
    cwd,
    env:
      Object.keys(combinedEnv).length > 0
        ? combinedEnv
        : undefined,
    enabled: true,
    autoStart: false,
    createdAt: now,
    updatedAt: now,
  };
}

async function buildHttpTestConfig(
  input: McpConnectionTestInput,
  existing: McpServerConfig | undefined,
  persistentSecrets: SecretStore,
  temporarySecrets: MemorySecretStore,
): Promise<HttpServerConfig> {
  const url = validateHttpUrl(input.url);
  const clearAuthorization = input.clearAuthorization === true;
  const suppliedAuthorization = normalizeOptionalAuthorization(
    input.authorization,
  );

  let authorization = suppliedAuthorization;
  if (
    !authorization &&
    !clearAuthorization &&
    existing?.transport === "http" &&
    existing.authSecretId
  ) {
    authorization =
      (await persistentSecrets.get(existing.authSecretId)) ?? undefined;
    if (!authorization) {
      throw new Error(
        "HTTP authorization secret is missing from secure storage",
      );
    }
  }

  let authSecretId: string | undefined;
  if (authorization) {
    authSecretId = "connection-test:http-auth";
    await temporarySecrets.set(authSecretId, authorization);
  }

  const now = new Date().toISOString();
  return {
    id: "connection-test",
    name: "Connection Test",
    alias: "connection-test",
    transport: "http",
    url,
    authSecretId,
    enabled: true,
    autoStart: false,
    createdAt: now,
    updatedAt: now,
  };
}

function createTestClient(
  config: McpServerConfig,
  secrets: SecretStore,
): UpstreamClient {
  return config.transport === "http"
    ? new HttpUpstreamClient(config, secrets)
    : new StdioUpstreamClient(config, secrets);
}

function validateRequiredString(
  field: string,
  value: unknown,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > maxLength) {
    throw new Error(`${field} is too long`);
  }
  return trimmed;
}

function validateOptionalString(
  field: string,
  value: unknown,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new Error(`${field} is too long`);
  }
  return trimmed;
}

function validateStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length > maxItems) {
    throw new Error(`${field} has too many items`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${field}[${index}] must be a string`);
    }
    if (item.length > maxLength) {
      throw new Error(`${field}[${index}] is too long`);
    }
    return item;
  });
}

function normalizeEnvironmentRecord(
  value: unknown,
): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("environment must be an object");
  }

  const entries = Object.entries(value);
  if (entries.length > 128) {
    throw new Error("too many environment variables");
  }

  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(
        `invalid environment variable name: ${key}`,
      );
    }
    if (typeof item !== "string") {
      throw new Error(
        `environment value for ${key} must be a string`,
      );
    }
    if (item.length > 65_536) {
      throw new Error(
        `environment value for ${key} is too long`,
      );
    }
    result[key] = item;
  }
  return result;
}

function normalizeEnvironmentKeys(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("secretEnvKeys must be an array");
  }
  if (value.length > 128) {
    throw new Error("too many secret environment variables");
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item)
    ) {
      throw new Error(
        `invalid secret environment variable name: ${String(item)}`,
      );
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function normalizeOptionalAuthorization(
  value: unknown,
): string | undefined {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("authorization must be a string");
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 8192) {
    throw new Error("authorization is too long");
  }
  return trimmed;
}

function validateHttpUrl(value: unknown): string {
  const raw = validateRequiredString("url", value, 4096);
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
