export interface SecretStore {
  get(secretId: string): Promise<string | null>;
  set(secretId: string, value: string): Promise<void>;
  delete(secretId: string): Promise<boolean>;
}

const KEYCHAIN_SERVICE = "MCP Gate HTTP Authorization";

/**
 * A Keychain read can block indefinitely: when the calling binary's code
 * signature is not in the item's ACL, the Security framework waits for a
 * confirmation that a background child process may never be able to surface.
 * Because `GatewayAccessController.init()` awaits this during Core startup, an
 * unbounded read would take the whole Core (gateway + management API + every
 * MCP upstream) down. Bound it so the caller can degrade instead of hanging.
 */
const KEYCHAIN_TIMEOUT_MS = Number(
  process.env.MCP_GATE_KEYCHAIN_TIMEOUT_MS ?? 5_000,
);

class KeychainTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(
      `Keychain ${operation} timed out after ${timeoutMs}ms; ` +
        `the item's access list may not trust this build of MCP Gate`,
    );
    this.name = "KeychainTimeoutError";
  }
}

export async function withKeychainTimeout<T>(
  operation: string,
  promise: Promise<T>,
  timeoutMs: number = KEYCHAIN_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new KeychainTimeoutError(operation, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export class MacKeychainSecretStore implements SecretStore {
  #keytar: Promise<KeytarLike> | null = null;

  async get(secretId: string): Promise<string | null> {
    return withKeychainTimeout(
      "read",
      (await this.#loadKeytar()).getPassword(KEYCHAIN_SERVICE, secretId),
    );
  }

  async set(secretId: string, value: string): Promise<void> {
    if (!value) throw new Error("secret value is required");
    await withKeychainTimeout(
      "write",
      (await this.#loadKeytar()).setPassword(
        KEYCHAIN_SERVICE,
        secretId,
        value,
      ),
    );
  }

  async delete(secretId: string): Promise<boolean> {
    return withKeychainTimeout(
      "delete",
      (await this.#loadKeytar()).deletePassword(KEYCHAIN_SERVICE, secretId),
    );
  }

  async #loadKeytar(): Promise<KeytarLike> {
    if (process.platform !== "darwin") {
      throw new Error("macOS Keychain is only available on macOS");
    }

    if (!this.#keytar) {
      this.#keytar = (async () => {
        const moduleName = "@github/keytar";
        let imported: Record<string, unknown>;
        try {
          imported = await import(moduleName) as Record<string, unknown>;
        } catch (error) {
          throw new Error(
            `Keychain adapter is unavailable. Run pnpm install on macOS: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        const candidate =
          imported.default && typeof imported.default === "object"
            ? imported.default as Record<string, unknown>
            : imported;

        if (
          typeof candidate.getPassword !== "function" ||
          typeof candidate.setPassword !== "function" ||
          typeof candidate.deletePassword !== "function"
        ) {
          throw new Error("invalid @github/keytar module");
        }

        return candidate as unknown as KeytarLike;
      })();

      // Do not cache a rejected load: the native module may simply not be built
      // yet, and a poisoned promise would disable secrets for the whole process.
      this.#keytar.catch(() => {
        this.#keytar = null;
      });
    }

    return this.#keytar;
  }
}

export class MemorySecretStore implements SecretStore {
  #values = new Map<string, string>();

  async get(secretId: string): Promise<string | null> {
    return this.#values.get(secretId) ?? null;
  }

  async set(secretId: string, value: string): Promise<void> {
    if (!value) throw new Error("secret value is required");
    this.#values.set(secretId, value);
  }

  async delete(secretId: string): Promise<boolean> {
    return this.#values.delete(secretId);
  }
}

export class UnsupportedSecretStore implements SecretStore {
  async get(): Promise<string | null> {
    throw new Error("secure secret storage is not available on this platform");
  }

  async set(): Promise<void> {
    throw new Error("secure secret storage is not available on this platform");
  }

  async delete(): Promise<boolean> {
    return false;
  }
}

export function createPlatformSecretStore(): SecretStore {
  return process.platform === "darwin"
    ? new MacKeychainSecretStore()
    : new UnsupportedSecretStore();
}
