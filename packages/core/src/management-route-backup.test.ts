import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { restoreConfigurationFiles, validateBackupBundle, redactServerSecrets, stripRedactedHeaders, HEADER_REDACTED_PLACEHOLDER, handleBackup } from "./management-route-backup.ts";
import { ServerRegistry } from "./server-registry.ts";
import { ProfileStore } from "./profile-store.ts";
import { ToolPolicyStore } from "./tool-policy-store.ts";
import { GatewayAccessController } from "./gateway-access.ts";
import { CoreLogger } from "./logger.ts";
import { MemorySecretStore } from "./secret-store.ts";
import { MutationQueue } from "./mutation-queue.ts";
import { RuntimeReconciler } from "./runtime-reconciler.ts";
import { UpstreamManager } from "./upstream-manager.ts";
import { ToolRegistry } from "./tool-registry.ts";
import type { RouteHandler, ManagementContext } from "./management-context.ts";

const validBackup = (): {
  version: 1;
  exportedAt: string;
  note: string;
  servers: { version: 1; servers: unknown[] };
  profiles: { version: 1; activeProfileId: string | null; profiles: unknown[] };
  toolPolicy: { version: 1; disabled: Record<string, unknown> };
  gatewayAccess: { version: 1; apiKeySecretId: string | null; lanEnabled: boolean };
  sessionSettings: { version: 1; idleTimeoutMs: number };
} => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  note: "test",
  servers: { version: 1, servers: [] },
  profiles: { version: 1, activeProfileId: null, profiles: [] },
  toolPolicy: { version: 1, disabled: {} },
  gatewayAccess: { version: 1, apiKeySecretId: null, lanEnabled: false },
  sessionSettings: { version: 1, idleTimeoutMs: 30 * 60_000 },
});

test("backup validator accepts a complete configuration bundle", () => {
  const bundle = validateBackupBundle(validBackup());
  assert.equal(bundle.version, 1);
  assert.equal((bundle.sessionSettings as { idleTimeoutMs: number }).idleTimeoutMs, 30 * 60_000);
});

test("backup validator rejects invalid session settings", () => {
  const backup = validBackup();
  backup.sessionSettings = { version: 1, idleTimeoutMs: 30_000 };
  assert.throws(() => validateBackupBundle(backup), /between 1 minute/);
});

test("backup validator rejects a dangling active profile", () => {
  const backup = validBackup();
  backup.profiles = {
    version: 1,
    activeProfileId: "missing",
    profiles: [],
  };
  assert.throws(() => validateBackupBundle(backup), /active profile does not exist/);
});

test("backup export redacts credential header values but keeps other headers", () => {
  const registry = {
    version: 1,
    servers: [
      {
        id: "http-1",
        name: "Apifox",
        transport: "http",
        headers: {
          "X-Apifox-Api-Version": "2025-09-01",
          Authorization: "Bearer super-secret-token",
          "X-Custom": "fine",
        },
      },
      {
        id: "stdio-1",
        name: "Local",
        transport: "stdio",
        command: "node",
      },
    ],
  };

  const redacted = redactServerSecrets(registry) as typeof registry;
  const httpServer = redacted.servers[0]!;
  assert.deepEqual(httpServer.headers, {
    "X-Apifox-Api-Version": "2025-09-01",
    Authorization: HEADER_REDACTED_PLACEHOLDER,
    "X-Custom": "fine",
  });
  // The stdio server without headers must pass through untouched.
  assert.deepEqual(redacted.servers[1], registry.servers[1]);
  // And the original in-memory registry is not mutated.
  assert.equal(registry.servers[0]!.headers!.Authorization, "Bearer super-secret-token");
});

test("backup restore drops redacted placeholder headers instead of sending them upstream", () => {
  const registry = {
    version: 1,
    servers: [
      {
        id: "http-1",
        name: "Apifox",
        transport: "http",
        headers: {
          "X-Apifox-Api-Version": "2025-09-01",
          Authorization: HEADER_REDACTED_PLACEHOLDER,
          "Proxy-Authorization": HEADER_REDACTED_PLACEHOLDER,
          "X-Custom": "fine",
        },
      },
    ],
  };

  const restored = stripRedactedHeaders(registry) as typeof registry;
  assert.deepEqual(restored.servers[0]!.headers, {
    "X-Apifox-Api-Version": "2025-09-01",
    "X-Custom": "fine",
  });
});

test("backup restore keeps a literal Authorization header that was never redacted", () => {
  const registry = {
    version: 1,
    servers: [
      {
        id: "http-1",
        name: "Apifox",
        transport: "http",
        headers: { Authorization: "Bearer user-typed-this" },
      },
    ],
  };

  const restored = stripRedactedHeaders(registry) as typeof registry;
  assert.equal(restored.servers[0]!.headers.Authorization, "Bearer user-typed-this");
});


test("configuration restore rolls back files already replaced when a later write fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-backup-transaction-"));
  try {
    const servers = join(dir, "servers.json");
    const profiles = join(dir, "profiles.json");
    await writeFile(servers, '{"version":1,"servers":[{"name":"old"}]}');
    await writeFile(profiles, '{"version":1,"profiles":[{"name":"old-profile"}]}');

    let writes = 0;
    const writer = async (
      value: unknown,
      options: { directory: string; fileName: string },
    ): Promise<void> => {
      writes += 1;
      if (writes === 2) throw new Error("injected restore failure");
      await writeFile(
        join(options.directory, options.fileName),
        JSON.stringify(value),
      );
    };

    await assert.rejects(
      restoreConfigurationFiles(
        [
          { path: servers, value: { version: 1, servers: [{ name: "new" }] } },
          { path: profiles, value: { version: 1, profiles: [{ name: "new-profile" }] } },
        ],
        undefined,
        writer as never,
      ),
      /injected restore failure/,
    );

    assert.deepEqual(
      JSON.parse(await readFile(servers, "utf8")),
      { version: 1, servers: [{ name: "old" }] },
    );
    assert.deepEqual(
      JSON.parse(await readFile(profiles, "utf8")),
      { version: 1, profiles: [{ name: "old-profile" }] },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("backup restore reloads in-memory stores so later writes do not poison restored files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-backup-reload-"));
  try {
    const logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const serversFile = join(dir, "servers.json");
    const registry = new ServerRegistry(serversFile, logger);
    await registry.init();
    const oldServer = await registry.create({ name: "OldServer", command: "node", args: ["old.js"] });

    const profiles = new ProfileStore(join(dir, "profiles.json"), logger);
    await profiles.init();
    const toolPolicy = new ToolPolicyStore(join(dir, "tool-policy.json"), logger);
    await toolPolicy.init();
    const secrets = new MemorySecretStore();
    const gatewayAccess = new GatewayAccessController(join(dir, "gateway-access.json"), secrets, logger);
    await gatewayAccess.init();

    // A backup taken before OldServer existed: restoring must remove it from
    // disk AND from the in-memory registry.
    const backup = validBackup();
    backup.servers = { version: 1, servers: [] };
    (backup.sessionSettings as { idleTimeoutMs: number }).idleTimeoutMs = 45 * 60_000;

    const reconciles: number[] = [];
    const upstreams = new UpstreamManager(
      registry,
      new ToolRegistry(toolPolicy),
      () => ({
        async connect() {},
        async disconnect() {},
        async listTools() {
          return [];
        },
        async callTool() {
          throw new Error("not used");
        },
      }),
      logger,
    );
    const reconciler = new RuntimeReconciler(registry, upstreams);
    const originalReconcile = reconciler.reconcile.bind(reconciler);
    reconciler.reconcile = () => {
      reconciles.push(1);
      return originalReconcile();
    };

    const mutations = new MutationQueue();
    const config = {
      serverConfigFile: serversFile,
      profileFile: join(dir, "profiles.json"),
      toolPolicyFile: join(dir, "tool-policy.json"),
      gatewayAccessFile: join(dir, "gateway-access.json"),
      sessionSettingsFile: join(dir, "session-settings.json"),
      sessionIdleTimeoutMs: 30 * 60_000,
    };
    const ctx = {
      config,
      registry,
      profiles,
      toolPolicy,
      gatewayAccess,
      reconciler,
      mutations,
      logger,
    } as unknown as ManagementContext;

    const req = {
      method: "POST",
      headers: { "x-mcp-gate-client": "desktop" },
      [Symbol.asyncIterator]() {
        const chunks = [Buffer.from(JSON.stringify({ backup }))].values();
        return {
          next: async () => chunks.next(),
        };
      },
    } as unknown as IncomingMessage;
    const written: string[] = [];
    const resHeaders: Record<string, string> = {};
    const res = {
      statusCode: 0,
      headers: resHeaders,
      setHeader(name: string, value: string) {
        resHeaders[name] = value;
      },
      end(body?: string) {
        if (body) written.push(body);
      },
    } as unknown as ServerResponse;

    const handled = await (handleBackup as RouteHandler)(
      req,
      res,
      new URL("http://x/api/backup/restore"),
      ctx,
    );
    assert.equal(handled, true);

    const response = JSON.parse(written.join(""));
    assert.equal(response.ok, true);
    assert.deepEqual(response.warnings, []);

    // The in-memory registry no longer holds the pre-restore server.
    assert.equal(registry.get(oldServer.id), undefined);
    // A later mutation persists the reloaded state, not the stale one.
    assert.deepEqual(JSON.parse(await readFile(serversFile, "utf8")), {
      version: 1,
      servers: [],
    });
    // Session settings followed the restored file immediately.
    assert.equal(ctx.config.sessionIdleTimeoutMs, 45 * 60_000);
    // Runtime was reconciled exactly once against the restored registry.
    assert.equal(reconciles.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
