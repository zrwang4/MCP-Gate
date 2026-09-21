import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreLogger } from "./logger.ts";
import { ServerRegistry } from "./server-registry.ts";

test("server registry persists stdio configurations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-"));
  try {
    const logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "servers.json");
    const registry = new ServerRegistry(file, logger);
    await registry.init();

    const created = await registry.create({
      name: "GitHub",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      cwd: "/tmp",
    });

    assert.equal(created.transport, "stdio");
    assert.equal(created.command, "npx");
    assert.equal(registry.list().length, 1);

    const reloaded = new ServerRegistry(file, logger);
    await reloaded.init();
    assert.equal(reloaded.list()[0]?.name, "GitHub");

    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.equal(raw.version, 1);
    assert.equal(raw.servers.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("server registry rejects invalid configurations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-"));
  try {
    const logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const registry = new ServerRegistry(join(dir, "servers.json"), logger);
    await registry.init();

    await assert.rejects(
      registry.create({ name: "Broken", command: "   " }),
      /command is required/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("server registry persists autoStart settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-"));
  try {
    const logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "servers.json");
    const registry = new ServerRegistry(file, logger);
    await registry.init();

    const created = await registry.create({
      name: "Auto",
      command: "fake",
    });

    const updated = await registry.updateSettings(created.id, {
      autoStart: true,
    });

    assert.equal(updated?.autoStart, true);

    const reloaded = new ServerRegistry(file, logger);
    await reloaded.init();
    assert.equal(reloaded.list()[0]?.autoStart, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("server registry persists and validates HTTP MCP configurations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const registry = new ServerRegistry(join(dir, "servers.json"), logger);
    await registry.init();

    const created = await registry.create({
      name: "Remote",
      transport: "http",
      url: "https://example.com/mcp",
    });

    assert.equal(created.transport, "http");
    if (created.transport === "http") {
      assert.equal(created.url, "https://example.com/mcp");
    }

    await assert.rejects(
      registry.create({
        name: "Bad Remote",
        transport: "http",
        url: "file:///tmp/mcp",
      }),
      /http or https/,
    );
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
