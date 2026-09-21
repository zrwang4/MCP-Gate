import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  inspectMcpImportSources,
  knownMcpImportSources,
  readMcpImportSource,
} from "./mcp-import-source.ts";

test("known import sources resolve Cursor and Claude Desktop paths", () => {
  const sources = knownMcpImportSources("/Users/tester");
  assert.deepEqual(
    sources.map((source) => [source.id, source.displayPath]),
    [
      ["cursor-global", "~/.cursor/mcp.json"],
      [
        "claude-desktop",
        "~/Library/Application Support/Claude/claude_desktop_config.json",
      ],
    ],
  );
  assert.equal(
    sources[0]?.filePath,
    "/Users/tester/.cursor/mcp.json",
  );
});

test("import source inspection and read never expose raw file path in source info", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-import-source-"));
  try {
    const filePath = join(dir, ".cursor", "mcp.json");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        mcpServers: {
          demo: {
            command: "node",
            args: ["server.js"],
          },
        },
      }),
      "utf8",
    );

    const sources = [
      {
        id: "cursor-global",
        label: "Cursor 全局配置",
        displayPath: "~/.cursor/mcp.json",
        filePath,
      },
      {
        id: "missing",
        label: "Missing",
        displayPath: "~/missing.json",
        filePath: join(dir, "missing.json"),
      },
    ];

    const inspected = await inspectMcpImportSources(sources);
    assert.equal(inspected[0]?.exists, true);
    assert.equal(inspected[1]?.exists, false);
    assert.equal("filePath" in (inspected[0] ?? {}), false);

    const loaded = await readMcpImportSource(
      "cursor-global",
      sources,
    );
    assert.equal(loaded.source.displayPath, "~/.cursor/mcp.json");
    assert.equal("filePath" in loaded.source, false);
    assert.deepEqual(loaded.config, {
      mcpServers: {
        demo: {
          command: "node",
          args: ["server.js"],
        },
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
