export interface SecretStore {
  get(secretId: string): Promise<string | null>;
  set(secretId: string, value: string): Promise<void>;
  delete(secretId: string): Promise<boolean>;
}

const KEYCHAIN_SERVICE = "MCP Gate HTTP Authorization";

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export class MacKeychainSecretStore implements SecretStore {
  #keytar: Promise<KeytarLike> | null = null;

  async get(secretId: string): Promise<string | null> {
    return (await this.#loadKeytar()).getPassword(KEYCHAIN_SERVICE, secretId);
  }

  async set(secretId: string, value: string): Promise<void> {
    if (!value) throw new Error("secret value is required");
    await (await this.#loadKeytar()).setPassword(
      KEYCHAIN_SERVICE,
      secretId,
      value,
    );
  }

  async delete(secretId: string): Promise<boolean> {
    return (await this.#loadKeytar()).deletePassword(
      KEYCHAIN_SERVICE,
      secretId,
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
