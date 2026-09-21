import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CoreLogger } from "./logger.ts";
import { constantTimeEqual } from "./management-auth.ts";
import type { SecretStore } from "./secret-store.ts";

interface GatewayAccessFile {
  version: 1;
  apiKeySecretId: string | null;
  lanEnabled?: boolean;
}

export interface GatewayAccessSnapshot {
  enabled: boolean;
  ready: boolean;
  lastError: string | null;
  lanEnabled: boolean;
}

export type GatewayAuthorizationResult =
  | { allowed: true }
  | { allowed: false; status: 401 | 503; error: string };

export class GatewayAccessController {
  #filePath: string;
  #secrets: SecretStore;
  #logger: CoreLogger;
  #secretId: string | null = null;
  #apiKey: string | null = null;
  #lastError: string | null = null;
  #lanEnabled = false;

  constructor(
    filePath: string,
    secrets: SecretStore,
    logger: CoreLogger,
  ) {
    this.#filePath = filePath;
    this.#secrets = secrets;
    this.#logger = logger;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });

    try {
      const raw = await readFile(this.#filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<GatewayAccessFile>;
      if (
        parsed.version !== 1 ||
        !Object.prototype.hasOwnProperty.call(parsed, "apiKeySecretId") ||
        (parsed.apiKeySecretId !== null &&
          typeof parsed.apiKeySecretId !== "string") ||
        (parsed.lanEnabled !== undefined &&
          typeof parsed.lanEnabled !== "boolean")
      ) {
        throw new Error("unsupported gateway access format");
      }

      this.#secretId = parsed.apiKeySecretId ?? null;
      this.#lanEnabled = parsed.lanEnabled === true;
      if (this.#secretId) {
        try {
          this.#apiKey = await this.#secrets.get(this.#secretId);
          if (!this.#apiKey) {
            this.#lastError =
              "Gateway API Key is configured but missing from secure storage";
            this.#logger.error("gateway-access", this.#lastError);
          }
        } catch (error) {
          this.#apiKey = null;
          this.#lastError =
            error instanceof Error ? error.message : String(error);
          this.#logger.error(
            "gateway-access",
            `failed to load Gateway API Key: ${this.#lastError}`,
          );
        }
      }

      if (
        this.#lanEnabled &&
        (!this.#secretId || !this.#apiKey)
      ) {
        this.#lanEnabled = false;
        await this.#persist(this.#secretId, false);
        this.#logger.warn(
          "gateway-access",
          "LAN mode was disabled because a usable Gateway API Key is required",
        );
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        await this.#persist(null, false);
        return;
      }

      const backup = `${this.#filePath}.corrupt-${Date.now()}`;
      await rename(this.#filePath, backup).catch(() => undefined);
      this.#secretId = null;
      this.#apiKey = null;
      this.#lastError = null;
      this.#lanEnabled = false;
      await this.#persist(null, false);
      this.#logger.warn(
        "gateway-access",
        `invalid gateway access config reset; backup: ${backup}; reason: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  snapshot(): GatewayAccessSnapshot {
    return {
      enabled: this.#secretId !== null,
      ready: this.#secretId === null || this.#apiKey !== null,
      lastError: this.#lastError,
      lanEnabled: this.#lanEnabled,
    };
  }

  authorize(
    authorizationHeader: string | string[] | undefined,
  ): GatewayAuthorizationResult {
    if (!this.#secretId) return { allowed: true };

    if (!this.#apiKey) {
      return {
        allowed: false,
        status: 503,
        error: "Gateway API Key is unavailable",
      };
    }

    const raw = Array.isArray(authorizationHeader)
      ? authorizationHeader[0]
      : authorizationHeader;
    const match = raw?.match(/^Bearer\s+(.+)$/i);
    const supplied = match?.[1]?.trim();

    if (!supplied || !constantTimeEqual(supplied, this.#apiKey)) {
      return {
        allowed: false,
        status: 401,
        error: "missing or invalid bearer token",
      };
    }

    return { allowed: true };
  }

  async rotate(): Promise<{ snapshot: GatewayAccessSnapshot; apiKey: string }> {
    const apiKey = randomBytes(32).toString("base64url");
    const secretId = `gateway-api-key:${randomUUID()}`;
    const previousSecretId = this.#secretId;

    await this.#secrets.set(secretId, apiKey);

    try {
      await this.#persist(secretId, this.#lanEnabled);
    } catch (error) {
      await this.#secrets.delete(secretId).catch(() => false);
      throw error;
    }

    this.#secretId = secretId;
    this.#apiKey = apiKey;
    this.#lastError = null;

    if (previousSecretId && previousSecretId !== secretId) {
      await this.#secrets.delete(previousSecretId).catch(() => false);
    }

    this.#logger.info("gateway-access", "Gateway API Key enabled/rotated");
    return {
      snapshot: this.snapshot(),
      apiKey,
    };
  }

  async setLanEnabled(enabled: boolean): Promise<GatewayAccessSnapshot> {
    if (enabled && (!this.#secretId || !this.#apiKey)) {
      throw new Error(
        "Gateway API Key must be enabled and available before LAN access can be enabled",
      );
    }

    await this.#persist(this.#secretId, enabled);
    this.#lanEnabled = enabled;
    this.#logger.info(
      "gateway-access",
      `LAN access ${enabled ? "enabled" : "disabled"}`,
    );
    return this.snapshot();
  }

  async disable(): Promise<GatewayAccessSnapshot> {
    const previousSecretId = this.#secretId;

    await this.#persist(null, false);
    this.#secretId = null;
    this.#apiKey = null;
    this.#lastError = null;
    this.#lanEnabled = false;

    if (previousSecretId) {
      await this.#secrets.delete(previousSecretId).catch(() => false);
    }

    this.#logger.info("gateway-access", "Gateway API Key disabled");
    return this.snapshot();
  }

  async #persist(
    secretId: string | null,
    lanEnabled = this.#lanEnabled,
  ): Promise<void> {
    const payload: GatewayAccessFile = {
      version: 1,
      apiKeySecretId: secretId,
      lanEnabled,
    };

    const tempPath = `${this.#filePath}.tmp-${process.pid}`;
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, this.#filePath);
  }
}
