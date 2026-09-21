import { randomUUID } from "node:crypto";
import type { CoreLogger } from "./logger.ts";
import type {
  McpServerConfig,
  ServerRegistry,
} from "./server-registry.ts";
import type { SecretStore } from "./secret-store.ts";

export interface McpImportIssue {
  sourceName?: string;
  message: string;
}

interface ImportCandidateBase {
  sourceName: string;
  name: string;
  warnings: string[];
}

export interface StdioImportCandidate extends ImportCandidateBase {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  secretEnv: Record<string, string>;
}

export interface HttpImportCandidate extends ImportCandidateBase {
  transport: "http";
  url: string;
  authorization?: string;
}

export type McpImportCandidate =
  | StdioImportCandidate
  | HttpImportCandidate;

export interface McpImportPreview {
  candidates: McpImportCandidate[];
  issues: McpImportIssue[];
}

export interface PublicMcpImportCandidate {
  sourceName: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  plainEnvKeys: string[];
  secretEnvKeys: string[];
  hasAuthorization: boolean;
  warnings: string[];
}

export interface PublicMcpImportPreview {
  candidates: PublicMcpImportCandidate[];
  issues: McpImportIssue[];
}

export interface McpImportApplyResult {
  imported: Array<{
    sourceName: string;
    serverId: string;
    name: string;
  }>;
  skipped: Array<{
    sourceName: string;
    reason: string;
  }>;
  failed: Array<{
    sourceName: string;
    error: string;
  }>;
  issues: McpImportIssue[];
}

export function previewMcpClientConfig(input: unknown): McpImportPreview {
  const root = requireRecord(input, "config must be an object");
  const rawServers =
    Object.prototype.hasOwnProperty.call(root, "mcpServers")
      ? requireRecord(root.mcpServers, "mcpServers must be an object")
      : root;

  const entries = Object.entries(rawServers);
  if (entries.length > 100) {
    throw new Error("too many MCP servers in import");
  }

  const candidates: McpImportCandidate[] = [];
  const issues: McpImportIssue[] = [];

  for (const [sourceName, raw] of entries) {
    try {
      candidates.push(parseCandidate(sourceName, raw));
    } catch (error) {
      issues.push({
        sourceName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { candidates, issues };
}

export function toPublicMcpImportPreview(
  preview: McpImportPreview,
): PublicMcpImportPreview {
  return {
    candidates: preview.candidates.map((candidate) => {
      if (candidate.transport === "stdio") {
        return {
          sourceName: candidate.sourceName,
          name: candidate.name,
          transport: "stdio",
          command: candidate.command,
          args: [...candidate.args],
          cwd: candidate.cwd,
          plainEnvKeys: Object.keys(candidate.env).sort(),
          secretEnvKeys: Object.keys(candidate.secretEnv).sort(),
          hasAuthorization: false,
          warnings: [...candidate.warnings],
        };
      }

      return {
        sourceName: candidate.sourceName,
        name: candidate.name,
        transport: "http",
        url: candidate.url,
        plainEnvKeys: [],
        secretEnvKeys: [],
        hasAuthorization: Boolean(candidate.authorization),
        warnings: [...candidate.warnings],
      };
    }),
    issues: preview.issues.map((issue) => ({ ...issue })),
  };
}

export async function applyMcpClientConfig(
  input: unknown,
  registry: ServerRegistry,
  secrets: SecretStore,
  logger: CoreLogger,
): Promise<McpImportApplyResult> {
  const preview = previewMcpClientConfig(input);
  const result: McpImportApplyResult = {
    imported: [],
    skipped: [],
    failed: [],
    issues: preview.issues.map((issue) => ({ ...issue })),
  };

  for (const candidate of preview.candidates) {
    if (isDuplicate(candidate, registry.list())) {
      result.skipped.push({
        sourceName: candidate.sourceName,
        reason: "matching MCP configuration already exists",
      });
      continue;
    }

    const createdSecretIds: string[] = [];
    let createdServerId: string | null = null;

    try {
      if (candidate.transport === "http") {
        let authSecretId: string | undefined;
        if (candidate.authorization) {
          authSecretId = `http-auth:${randomUUID()}`;
          await secrets.set(authSecretId, candidate.authorization);
          createdSecretIds.push(authSecretId);
        }

        const server = await registry.create({
          name: candidate.name,
          transport: "http",
          url: candidate.url,
          authSecretId,
        });
        createdServerId = server.id;
        result.imported.push({
          sourceName: candidate.sourceName,
          serverId: server.id,
          name: server.name,
        });
        logger.info("import", `imported HTTP MCP: ${candidate.name}`);
        continue;
      }

      const envSecretIds: Record<string, string> = {};
      for (const [key, value] of Object.entries(candidate.secretEnv)) {
        const secretId = `stdio-env:${randomUUID()}`;
        await secrets.set(secretId, value);
        createdSecretIds.push(secretId);
        envSecretIds[key] = secretId;
      }

      const server = await registry.create({
        name: candidate.name,
        transport: "stdio",
        command: candidate.command,
        args: candidate.args,
        cwd: candidate.cwd,
      });
      createdServerId = server.id;

      if (
        Object.keys(candidate.env).length > 0 ||
        Object.keys(envSecretIds).length > 0
      ) {
        await registry.updateEnvironment(server.id, {
          env: candidate.env,
          envSecretIds,
        });
      }

      result.imported.push({
        sourceName: candidate.sourceName,
        serverId: server.id,
        name: server.name,
      });
      logger.info("import", `imported stdio MCP: ${candidate.name}`);
    } catch (error) {
      if (createdServerId) {
        await registry.remove(createdServerId).catch(() => false);
      }
      for (const secretId of createdSecretIds) {
        await secrets.delete(secretId).catch(() => false);
      }

      result.failed.push({
        sourceName: candidate.sourceName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function parseCandidate(
  sourceName: string,
  raw: unknown,
): McpImportCandidate {
  const name = validateName(sourceName);
  const config = requireRecord(
    raw,
    `MCP server ${sourceName} must be an object`,
  );

  const hasCommand = typeof config.command === "string";
  const hasUrl = typeof config.url === "string";

  if (hasCommand === hasUrl) {
    throw new Error("server must define exactly one of command or url");
  }

  if (hasCommand) {
    if (
      config.type !== undefined &&
      config.type !== "stdio"
    ) {
      throw new Error(`unsupported stdio type: ${String(config.type)}`);
    }
    if (config.envFile !== undefined) {
      throw new Error("envFile import is not supported yet");
    }

    const command = validateString("command", config.command, 2048);
    assertNoInterpolation(command, "command");

    const args = validateStringArray(config.args ?? [], "args", 100, 4096);
    args.forEach((value, index) =>
      assertNoInterpolation(value, `args[${index}]`),
    );

    const cwd =
      config.cwd === undefined
        ? undefined
        : validateString("cwd", config.cwd, 4096);
    if (cwd) assertNoInterpolation(cwd, "cwd");

    const rawEnv = normalizeStringRecord(config.env, "env", 128, 65_536);
    const env: Record<string, string> = {};
    const secretEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawEnv)) {
      assertNoInterpolation(value, `env.${key}`);
      if (isLikelySecretKey(key)) {
        secretEnv[key] = value;
      } else {
        env[key] = value;
      }
    }

    return {
      sourceName,
      name,
      transport: "stdio",
      command,
      args,
      cwd,
      env,
      secretEnv,
      warnings: [],
    };
  }

  const rawType = config.type;
  if (
    rawType !== undefined &&
    rawType !== "http" &&
    rawType !== "streamable-http"
  ) {
    if (rawType === "sse") {
      throw new Error("legacy SSE import is not supported yet");
    }
    throw new Error(`unsupported remote MCP type: ${String(rawType)}`);
  }
  if (config.auth !== undefined) {
    throw new Error("static OAuth auth import is not supported yet");
  }

  const url = normalizeHttpUrl(config.url);
  assertNoInterpolation(url, "url");

  const headers = normalizeStringRecord(
    config.headers,
    "headers",
    64,
    16_384,
  );
  const unsupportedHeaders = Object.keys(headers).filter(
    (key) => key.toLowerCase() !== "authorization",
  );
  if (unsupportedHeaders.length > 0) {
    throw new Error(
      `unsupported HTTP header(s): ${unsupportedHeaders.join(", ")}`,
    );
  }

  let authorization: string | undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") {
      assertNoInterpolation(value, "headers.Authorization");
      authorization = value;
    }
  }

  const warnings: string[] = [];
  if (/\/sse(?:[/?#]|$)/i.test(url)) {
    warnings.push(
      "URL looks like a legacy SSE endpoint; MCP Gate currently connects remote servers with Streamable HTTP",
    );
  }

  return {
    sourceName,
    name,
    transport: "http",
    url,
    authorization,
    warnings,
  };
}

function isDuplicate(
  candidate: McpImportCandidate,
  servers: McpServerConfig[],
): boolean {
  return servers.some((server) => {
    if (
      server.name !== candidate.name ||
      server.transport !== candidate.transport
    ) {
      return false;
    }

    if (server.transport === "http" && candidate.transport === "http") {
      return server.url === candidate.url;
    }

    if (server.transport === "stdio" && candidate.transport === "stdio") {
      return (
        server.command === candidate.command &&
        server.cwd === candidate.cwd &&
        arraysEqual(server.args, candidate.args)
      );
    }

    return false;
  });
}

function validateName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("server name is required");
  if (name.length > 80) throw new Error("server name is too long");
  return name;
}

function validateString(
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

function normalizeStringRecord(
  value: unknown,
  field: string,
  maxItems: number,
  maxValueLength: number,
): Record<string, string> {
  if (value === undefined || value === null) return {};
  const record = requireRecord(value, `${field} must be an object`);
  const entries = Object.entries(record);
  if (entries.length > maxItems) {
    throw new Error(`${field} has too many entries`);
  }

  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (typeof item !== "string") {
      throw new Error(`${field}.${key} must be a string`);
    }
    if (item.length > maxValueLength) {
      throw new Error(`${field}.${key} is too long`);
    }
    result[key] = item;
  }
  return result;
}

function requireRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function normalizeHttpUrl(value: unknown): string {
  const raw = validateString("url", value, 4096);
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

function assertNoInterpolation(value: string, field: string): void {
  if (/\$\{[^}]+\}/.test(value)) {
    throw new Error(
      `${field} contains config interpolation; replace it with a concrete value before import`,
    );
  }
}

function isLikelySecretKey(key: string): boolean {
  return /(^|_)(TOKEN|API_KEY|KEY|SECRET|PASSWORD|PASS|AUTH|AUTHORIZATION|COOKIE|CREDENTIAL|CREDENTIALS|PRIVATE_KEY)($|_)/i.test(
    key,
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
