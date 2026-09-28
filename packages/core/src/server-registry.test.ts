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


test("server registry persists enabled and autoStart settings", async () => {
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
      enabled: false,
      autoStart: true,
    });

    assert.equal(updated?.enabled, false);
    assert.equal(updated?.autoStart, true);

    const reloaded = new ServerRegistry(file, logger);
    await reloaded.init();
    assert.equal(reloaded.list()[0]?.enabled, false);
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

test("HTTP registry stores only an opaque auth secret id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "servers.json");
    const registry = new ServerRegistry(file, logger);
    await registry.init();

    const created = await registry.create({
      name: "Private Remote",
      transport: "http",
      url: "https://example.com/mcp",
      authSecretId: "http-auth:test-only",
    });

    assert.equal(created.transport, "http");
    if (created.transport === "http") {
      assert.equal(created.authSecretId, "http-auth:test-only");
    }

    const raw = await readFile(file, "utf8");
    assert.match(raw, /http-auth:test-only/);
    assert.doesNotMatch(raw, /Bearer super-secret/);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});


test("server registry persists stdio environment metadata without secret values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "servers.json");
    const registry = new ServerRegistry(file, logger);
    await registry.init();

    const created = await registry.create({
      name: "Env MCP",
      command: "fake",
    });

    await registry.updateEnvironment(created.id, {
      env: {
        MODE: "production",
      },
      envSecretIds: {
        GITHUB_TOKEN: "stdio-env:test-token",
      },
    });

    const reloaded = new ServerRegistry(file, logger);
    await reloaded.init();
    const server = reloaded.list()[0];

    assert.equal(server?.transport, "stdio");
    if (server?.transport === "stdio") {
      assert.deepEqual(server.env, { MODE: "production" });
      assert.deepEqual(server.envSecretIds, {
        GITHUB_TOKEN: "stdio-env:test-token",
      });
    }

    const raw = await readFile(file, "utf8");
    assert.match(raw, /stdio-env:test-token/);
    assert.doesNotMatch(raw, /super-secret-token/);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("http headers persist and survive a registry reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-headers-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "servers.json");
    const registry = new ServerRegistry(file, logger);
    await registry.init();

    await registry.create({
      name: "Apifox",
      transport: "http",
      url: "https://api.apifox.com/mcp",
      // A hyphenated name is a legal HTTP token but not a legal env var name.
      headers: { "X-Apifox-Api-Version": "2025-09-01" },
    });

    const reloaded = new ServerRegistry(file, logger);
    await reloaded.init();
    const server = reloaded.list()[0];

    assert.equal(server?.transport, "http");
    if (server?.transport !== "http") throw new Error("expected an http server");
    assert.equal(server.url, "https://api.apifox.com/mcp");
    assert.deepEqual(server.headers, { "X-Apifox-Api-Version": "2025-09-01" });
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an update that omits headers keeps them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-keep-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "servers.json");
    const registry = new ServerRegistry(file, logger);
    await registry.init();

    const created = await registry.create({
      name: "Apifox",
      transport: "http",
      url: "https://api.apifox.com/mcp",
      headers: { "X-Apifox-Api-Version": "2025-09-01" },
    });

    // Changing only the URL must not silently drop the headers.
    const updated = await registry.update(created.id, {
      name: "Apifox",
      transport: "http",
      url: "https://api.apifox.com/mcp/v2",
    });

    assert.equal(updated?.transport, "http");
    if (updated?.transport !== "http") throw new Error("expected an http server");
    assert.equal(updated.url, "https://api.apifox.com/mcp/v2");
    assert.deepEqual(updated.headers, { "X-Apifox-Api-Version": "2025-09-01" });
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an update with empty headers clears them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-clear-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "servers.json");
    const registry = new ServerRegistry(file, logger);
    await registry.init();

    const created = await registry.create({
      name: "Apifox",
      transport: "http",
      url: "https://api.apifox.com/mcp",
      headers: { "X-Apifox-Api-Version": "2025-09-01" },
    });

    const updated = await registry.update(created.id, {
      name: "Apifox",
      transport: "http",
      url: "https://api.apifox.com/mcp",
      headers: {},
    });

    if (updated?.transport !== "http") throw new Error("expected an http server");
    assert.equal(updated.headers, undefined);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("header injection through CRLF is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-registry-crlf-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const registry = new ServerRegistry(join(dir, "servers.json"), logger);
    await registry.init();

    await assert.rejects(
      () =>
        registry.create({
          name: "Evil",
          transport: "http",
          url: "https://example.com/mcp",
          headers: { "X-Test": "ok\r\nX-Injected: yes" },
        }),
      /contains a newline/,
    );

    await assert.rejects(
      () =>
        registry.create({
          name: "Evil",
          transport: "http",
          url: "https://example.com/mcp",
          headers: { "Bad Header Name": "ok" },
        }),
      /invalid HTTP header name/,
    );

    assert.equal(registry.list().length, 0, "rejected writes must not persist");
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
