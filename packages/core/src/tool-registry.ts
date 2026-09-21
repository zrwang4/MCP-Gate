import type { ToolPolicyStore } from "./tool-policy-store.ts";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type ToolRegistryListener = () => void;

export interface ToolRoute {
  publicName: string;
  serverId: string;
  serverAlias: string;
  originalName: string;
  enabled: boolean;
  definition: McpToolDefinition;
}

export class ToolRegistry {
  #routes = new Map<string, ToolRoute>();
  #policy: ToolPolicyStore | null;
  #listeners = new Set<ToolRegistryListener>();

  constructor(policy?: ToolPolicyStore) {
    this.#policy = policy ?? null;
  }

  onChanged(listener: ToolRegistryListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  replaceServerTools(
    serverId: string,
    serverAlias: string,
    tools: McpToolDefinition[],
  ): ToolRoute[] {
    const before = this.#fingerprint();
    const previousEnabled = new Map(
      [...this.#routes.values()]
        .filter((route) => route.serverId === serverId)
        .map((route) => [route.originalName, route.enabled] as const),
    );

    this.#removeServerRoutes(serverId);

    const created: ToolRoute[] = [];
    for (const tool of tools) {
      const originalName = validateToolName(tool.name);
      const baseName = `${sanitizeName(serverAlias)}__${sanitizeName(originalName)}`;
      let publicName = baseName;
      let suffix = 2;

      while (this.#routes.has(publicName)) {
        publicName = `${baseName}__${suffix++}`;
      }

      const route: ToolRoute = {
        publicName,
        serverId,
        serverAlias,
        originalName,
        enabled:
          previousEnabled.get(originalName) ??
          this.#policy?.isEnabled(serverId, originalName) ??
          true,
        definition: {
          name: publicName,
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
      };

      this.#routes.set(publicName, route);
      created.push(cloneRoute(route));
    }

    this.#emitIfChanged(before);
    return created;
  }

  removeServer(serverId: string): void {
    const before = this.#fingerprint();
    this.#removeServerRoutes(serverId);
    this.#emitIfChanged(before);
  }

  list(options?: { includeDisabled?: boolean }): ToolRoute[] {
    const includeDisabled = options?.includeDisabled ?? false;
    return [...this.#routes.values()]
      .filter((route) => includeDisabled || route.enabled)
      .sort((a, b) => a.publicName.localeCompare(b.publicName))
      .map(cloneRoute);
  }

  resolve(publicName: string): ToolRoute | undefined {
    const route = this.#routes.get(publicName);
    return route ? cloneRoute(route) : undefined;
  }

  setEnabled(publicName: string, enabled: boolean): boolean {
    const route = this.#routes.get(publicName);
    if (!route) return false;
    if (route.enabled === enabled) return true;

    route.enabled = enabled;
    this.#emitChanged();
    return true;
  }

  clear(): void {
    if (this.#routes.size === 0) return;
    this.#routes.clear();
    this.#emitChanged();
  }

  #removeServerRoutes(serverId: string): void {
    for (const [publicName, route] of this.#routes) {
      if (route.serverId === serverId) {
        this.#routes.delete(publicName);
      }
    }
  }

  #fingerprint(): string {
    return JSON.stringify(
      [...this.#routes.values()]
        .sort((a, b) => a.publicName.localeCompare(b.publicName))
        .map((route) => ({
          publicName: route.publicName,
          serverId: route.serverId,
          originalName: route.originalName,
          enabled: route.enabled,
          description: route.definition.description,
          inputSchema: route.definition.inputSchema,
        })),
    );
  }

  #emitIfChanged(before: string): void {
    if (before !== this.#fingerprint()) {
      this.#emitChanged();
    }
  }

  #emitChanged(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // Listeners must not break registry mutations.
      }
    }
  }
}

function validateToolName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("tool name is required");
  }
  return value.trim();
}

function sanitizeName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 96) || "tool"
  );
}

function cloneRoute(route: ToolRoute): ToolRoute {
  return {
    ...route,
    definition: { ...route.definition },
  };
}
