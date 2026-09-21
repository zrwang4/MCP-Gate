export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

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

  replaceServerTools(
    serverId: string,
    serverAlias: string,
    tools: McpToolDefinition[],
  ): ToolRoute[] {
    this.removeServer(serverId);

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
        enabled: true,
        definition: {
          name: publicName,
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
      };

      this.#routes.set(publicName, route);
      created.push(cloneRoute(route));
    }

    return created;
  }

  removeServer(serverId: string): void {
    for (const [publicName, route] of this.#routes) {
      if (route.serverId === serverId) {
        this.#routes.delete(publicName);
      }
    }
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
    route.enabled = enabled;
    return true;
  }

  clear(): void {
    this.#routes.clear();
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
