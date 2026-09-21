import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_IMPORT_SOURCE_BYTES = 512 * 1024;

export interface McpImportSource {
  id: string;
  label: string;
  displayPath: string;
  filePath: string;
}

export interface McpImportSourceInfo {
  id: string;
  label: string;
  displayPath: string;
  exists: boolean;
  size: number | null;
  modifiedAt: string | null;
}

export function knownMcpImportSources(
  home = homedir(),
): McpImportSource[] {
  return [
    {
      id: "cursor-global",
      label: "Cursor 全局配置",
      displayPath: "~/.cursor/mcp.json",
      filePath: join(home, ".cursor", "mcp.json"),
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop 本地配置",
      displayPath:
        "~/Library/Application Support/Claude/claude_desktop_config.json",
      filePath: join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      ),
    },
  ];
}

export async function inspectMcpImportSources(
  sources = knownMcpImportSources(),
): Promise<McpImportSourceInfo[]> {
  return Promise.all(
    sources.map(async (source) => {
      try {
        const metadata = await stat(source.filePath);
        if (!metadata.isFile()) {
          return toInfo(source, false, null, null);
        }
        return toInfo(
          source,
          true,
          metadata.size,
          metadata.mtime.toISOString(),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return toInfo(source, false, null, null);
        }
        throw error;
      }
    }),
  );
}

export async function readMcpImportSource(
  sourceId: string,
  sources = knownMcpImportSources(),
): Promise<{
  source: McpImportSourceInfo;
  config: unknown;
}> {
  const source = sources.find((item) => item.id === sourceId);
  if (!source) {
    throw new Error("unknown import source");
  }

  let metadata;
  try {
    metadata = await stat(source.filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`import source not found: ${source.displayPath}`);
    }
    throw error;
  }

  if (!metadata.isFile()) {
    throw new Error(`import source is not a file: ${source.displayPath}`);
  }
  if (metadata.size > MAX_IMPORT_SOURCE_BYTES) {
    throw new Error(
      `import source is too large: ${metadata.size} bytes (max ${MAX_IMPORT_SOURCE_BYTES})`,
    );
  }

  const raw = await readFile(source.filePath, "utf8");
  let config: unknown;
  try {
    config = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `invalid JSON in ${source.displayPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    source: toInfo(
      source,
      true,
      metadata.size,
      metadata.mtime.toISOString(),
    ),
    config,
  };
}

function toInfo(
  source: McpImportSource,
  exists: boolean,
  size: number | null,
  modifiedAt: string | null,
): McpImportSourceInfo {
  return {
    id: source.id,
    label: source.label,
    displayPath: source.displayPath,
    exists,
    size,
    modifiedAt,
  };
}
