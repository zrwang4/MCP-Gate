import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, rm, readFile, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ManagementContext } from "./management-context.ts";
import { handleServers } from "./management-route-servers.ts";
import { CoreLogger } from "./logger.ts";
import { ServerRegistry } from "./server-registry.ts";
import { ProfileStore } from "./profile-store.ts";
import { ProfileService } from "./profile-service.ts";
import { ServerService } from "./server-service.ts";
import { ToolPolicyStore } from "./tool-policy-store.ts";
import { MemorySecretStore } from "./secret-store.ts";
import { RuntimeReconciler } from "./runtime-reconciler.ts";
import { MutationQueue } from "./mutation-queue.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { UpstreamManager, type UpstreamFactory } from "./upstream-manager.ts";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition did not settle");
    await delay(5);
  }
}

async function fixture(t: TestContext, factory: UpstreamFactory, circuitResetMs = 60_000) {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-architecture-"));
  const logger = new CoreLogger(join(dir, "core.jsonl"));
  await logger.init();
  const registry = new ServerRegistry(join(dir, "servers.json"), logger);
  const profiles = new ProfileStore(join(dir, "profiles.json"), logger);
  const policy = new ToolPolicyStore(join(dir, "policy.json"), logger);
  await registry.init(); await profiles.init(); await policy.init();
  const secrets = new MemorySecretStore();
  const queue = new MutationQueue();
  const tools = new ToolRegistry(policy);
  const upstreams = new UpstreamManager(registry, tools, factory, logger, {
    mutations: queue, healthCheckIntervalMs: 5, circuitFailureThreshold: 1, circuitResetMs,
  });
  const reconciler = new RuntimeReconciler(registry, upstreams);
  const profileService = new ProfileService(profiles, registry, reconciler, queue);
  const serverService = new ServerService(registry, profiles, upstreams, policy, secrets, logger, queue, reconciler);
  t.after(async () => {
    await upstreams.stopAll(); await logger.flush(); await rm(dir, { recursive: true, force: true });
  });
  return { dir, registry, profiles, secrets, queue, tools, upstreams, profileService, serverService };
}

test("queued circuit recovery cannot close a manually replaced client", async (t) => {
  let serial = 0;
  const closed: number[] = [];
  const f = await fixture(t, () => {
    const id = ++serial;
    return {
      async connect() {}, async disconnect() { closed.push(id); },
      async healthCheck() { if (id === 1) throw new Error("unhealthy"); },
      async listTools() { return [{ name: "tool" }]; }, async callTool() { return { content: [] }; },
    };
  }, 30);
  const server = await f.registry.create({ name: "Recovery", command: "fake" });
  await f.queue.run(() => f.upstreams.connect(server.id));
  f.upstreams.startHealthMonitoring();
  await waitFor(() => f.upstreams.list()[0].circuitState === "open");
  f.upstreams.stopHealthMonitoring();
  assert.deepEqual(f.upstreams.connectionTargets(), [server.id]);
  await f.queue.run(async () => {
    await delay(80); // Let the old recovery task queue behind this mutation.
    await f.upstreams.disconnect(server.id);
    await f.upstreams.connect(server.id);
  });
  await f.queue.run(async () => {});
  assert.equal(serial, 2);
  assert.deepEqual(closed, [1]);
  assert.equal(f.upstreams.list()[0].status, "running");
  assert.equal(f.upstreams.list()[0].circuitState, "closed");
  assert.equal(f.tools.list().length, 1);
});

test("failed profile activation restores manually connected targets without an old profile", async (t) => {
  const f = await fixture(t, (config) => ({
    async connect() { if (config.name === "Fail") throw new Error("unavailable"); },
    async disconnect() {}, async listTools() { return []; }, async callTool() { return { content: [] }; },
  }));
  const a = await f.registry.create({ name: "Manual", command: "fake" });
  const b = await f.registry.create({ name: "Fail", command: "fake" });
  await f.queue.run(() => f.upstreams.connect(a.id));
  const profile = await f.profileService.create("New", [b.id]);
  const outcome = await f.profileService.activate(profile.id);
  assert.equal(outcome.ok, false);
  assert.equal(f.profiles.activeProfileId, null);
  assert.equal(f.upstreams.list().find((item) => item.id === a.id)?.status, "running");
  assert.deepEqual(f.upstreams.connectionTargets(), [a.id]);
});

test("failed reactivation of the current profile preserves its previous targets", async (t) => {
  let fail = false;
  const f = await fixture(t, (config) => ({
    async connect() { if (fail && config.name === "B") throw new Error("unavailable"); },
    async disconnect() {}, async listTools() { return []; }, async callTool() { return { content: [] }; },
  }));
  const a = await f.registry.create({ name: "A", command: "fake" });
  const b = await f.registry.create({ name: "B", command: "fake" });
  const profile = await f.profileService.create("Existing", [a.id, b.id]);
  await f.profileService.activate(profile.id);
  await f.queue.run(() => f.upstreams.disconnect(b.id));
  fail = true;
  const outcome = await f.profileService.activate(profile.id);
  assert.equal(outcome.ok, false);
  assert.equal(f.profiles.activeProfileId, profile.id);
  assert.equal(f.upstreams.list().find((item) => item.id === a.id)?.status, "running");
  assert.deepEqual(f.upstreams.connectionTargets(), [a.id]);
});

test("combined server edit persists config and environment with a single reconnect", async (t) => {
  let connects = 0;
  let disconnects = 0;
  const f = await fixture(t, () => ({
    async connect() { connects++; }, async disconnect() { disconnects++; },
    async listTools() { return []; }, async callTool() { return { content: [] }; },
  }));
  const server = await f.serverService.create({
    name: "Old", command: "fake",
    environment: { env: { MODE: "old" }, secretEnvKeys: ["TOKEN"], secretEnv: { TOKEN: "secret" } },
  });
  const oldSecret = server.transport === "stdio" ? server.envSecretIds?.TOKEN : undefined;
  assert.ok(oldSecret);
  await f.queue.run(() => f.upstreams.connect(server.id));
  const result = await f.serverService.update(server.id, {
    name: "New", command: "new-command",
    environment: { env: { MODE: "new" }, secretEnvKeys: ["TOKEN"], secretEnv: {} },
  });
  assert.equal(connects, 2); assert.equal(disconnects, 1);
  assert.equal(result.server.transport, "stdio");
  if (result.server.transport !== "stdio") throw new Error("expected stdio");
  assert.equal(result.server.command, "new-command");
  assert.deepEqual(result.server.env, { MODE: "new" });
  assert.equal(result.server.envSecretIds?.TOKEN, oldSecret);
  const disk = JSON.parse(await readFile(join(f.dir, "servers.json"), "utf8"));
  assert.equal(disk.servers[0].name, "New");
  assert.equal(disk.servers[0].env.MODE, "new");
  assert.ok(!JSON.stringify(disk).includes('"secret"'));
});

test("invalid combined environment leaves both config and running connection unchanged", async (t) => {
  let disconnects = 0;
  const f = await fixture(t, () => ({
    async connect() {}, async disconnect() { disconnects++; },
    async listTools() { return []; }, async callTool() { return { content: [] }; },
  }));
  const server = await f.serverService.create({ name: "Old", command: "fake" });
  await f.queue.run(() => f.upstreams.connect(server.id));
  await assert.rejects(f.serverService.update(server.id, {
    name: "New", command: "new-command",
    environment: { env: {}, secretEnvKeys: ["TOKEN"], secretEnv: {} },
  }), /secret environment value is required/);
  assert.equal(disconnects, 0);
  assert.equal(f.registry.get(server.id)?.name, "Old");
  assert.equal(f.upstreams.list()[0].status, "running");
});

test("failed combined persistence restores old config and cleans staged secrets", async (t) => {
  let connects = 0;
  const f = await fixture(t, () => ({
    async connect() { connects++; }, async disconnect() {},
    async listTools() { return []; }, async callTool() { return { content: [] }; },
  }));
  const server = await f.serverService.create({ name: "Old", command: "fake" });
  await f.queue.run(() => f.upstreams.connect(server.id));
  const staged: string[] = [];
  const originalSet = f.secrets.set.bind(f.secrets);
  f.secrets.set = async (id, value) => { staged.push(id); await originalSet(id, value); };
  const file = join(f.dir, "servers.json");
  await rename(file, `${file}.saved`);
  await mkdir(file); // Make the atomic replacement fail.
  await assert.rejects(f.serverService.update(server.id, {
    name: "New", command: "new-command",
    environment: { env: { MODE: "new" }, secretEnvKeys: ["TOKEN"], secretEnv: { TOKEN: "new-secret" } },
  }), /EISDIR|ENOTDIR|rename/i);
  await rm(file, { recursive: true });
  await rename(`${file}.saved`, file);
  assert.equal(f.registry.get(server.id)?.name, "Old");
  assert.equal(JSON.parse(await readFile(file, "utf8")).servers[0].name, "Old");
  assert.equal(f.upstreams.list()[0].status, "running");
  assert.equal(connects, 2);
  assert.equal(staged.length, 1);
  assert.equal(await f.secrets.get(staged[0]), null);
});

test("combined save keeps committed config and secrets when reconnect fails", async (t) => {
  const f = await fixture(t, (config) => ({
    async connect() { if (config.name === "New") throw new Error("reconnect unavailable"); },
    async disconnect() {}, async listTools() { return []; }, async callTool() { return { content: [] }; },
  }));
  const server = await f.serverService.create({ name: "Old", command: "fake" });
  await f.queue.run(() => f.upstreams.connect(server.id));
  const result = await f.serverService.update(server.id, {
    name: "New", command: "fake",
    environment: { env: {}, secretEnvKeys: ["TOKEN"], secretEnv: { TOKEN: "kept-secret" } },
  });
  assert.match(result.reconnectError ?? "", /reconnect unavailable/);
  assert.equal(f.registry.get(server.id)?.name, "New");
  assert.equal(result.server.transport, "stdio");
  if (result.server.transport !== "stdio") throw new Error("expected stdio");
  assert.equal(await f.secrets.get(result.server.envSecretIds!.TOKEN), "kept-secret");
});

test("server routes accept combined config and environment without exposing secret references", async (t) => {
  const f = await fixture(t, () => ({
    async connect() {}, async disconnect() {},
    async listTools() { return []; }, async callTool() { return { content: [] }; },
  }));
  const ctx = { registry: f.registry, servers: f.serverService } as unknown as ManagementContext;
  async function post(path: string, body: unknown) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
    req.method = "POST";
    req.headers = { "x-mcp-gate-client": "desktop" };
    let response = "";
    const res = {
      statusCode: 0, setHeader() {}, end(value: string) { response = value; },
    };
    assert.equal(await handleServers(req, res as unknown as ServerResponse, new URL(path, "http://localhost"), ctx), true);
    return { status: res.statusCode, body: JSON.parse(response) };
  }
  const created = await post("/api/server-configs", {
    name: "Combined", command: "fake", transport: "stdio",
    env: { MODE: "old" }, secretEnvKeys: ["TOKEN"], secretEnv: { TOKEN: "private" },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.server.env, { MODE: "old" });
  assert.deepEqual(created.body.server.secretEnvKeys, ["TOKEN"]);
  assert.equal(created.body.server.envSecretIds, undefined);
  const edited = await post(`/api/server-configs/${created.body.server.id}`, {
    name: "Edited", command: "fake", transport: "stdio",
    env: { MODE: "new" }, secretEnvKeys: ["TOKEN"], secretEnv: {},
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.server.env, { MODE: "new" });
  assert.deepEqual(edited.body.server.secretEnvKeys, ["TOKEN"]);
});
