import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GatewayAccessController } from "./gateway-access.ts";
import { CoreLogger } from "./logger.ts";
import { MemorySecretStore } from "./secret-store.ts";

test("gateway access key is persisted only as an opaque secret id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-access-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "gateway-access.json");
    const secrets = new MemorySecretStore();

    const access = new GatewayAccessController(file, secrets, logger);
    await access.init();
    assert.deepEqual(access.snapshot(), {
      enabled: false,
      ready: true,
      lastError: null,
    });
    assert.equal(access.authorize(undefined).allowed, true);

    const rotated = await access.rotate();
    assert.equal(rotated.snapshot.enabled, true);
    assert.equal(rotated.snapshot.ready, true);
    assert.ok(rotated.apiKey.length >= 40);

    assert.equal(
      access.authorize(`Bearer ${rotated.apiKey}`).allowed,
      true,
    );
    const wrong = access.authorize("Bearer wrong");
    assert.equal(wrong.allowed, false);
    if (!wrong.allowed) assert.equal(wrong.status, 401);

    const raw = await readFile(file, "utf8");
    assert.match(raw, /gateway-api-key:/);
    assert.doesNotMatch(raw, new RegExp(rotated.apiKey));

    const reloaded = new GatewayAccessController(file, secrets, logger);
    await reloaded.init();
    assert.equal(
      reloaded.authorize(`Bearer ${rotated.apiKey}`).allowed,
      true,
    );

    await reloaded.disable();
    assert.equal(reloaded.snapshot().enabled, false);
    assert.equal(reloaded.authorize(undefined).allowed, true);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("configured but missing gateway key fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-access-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();
    const file = join(dir, "gateway-access.json");
    const secrets = new MemorySecretStore();

    const first = new GatewayAccessController(file, secrets, logger);
    await first.init();
    const rotated = await first.rotate();

    const raw = JSON.parse(await readFile(file, "utf8")) as {
      apiKeySecretId: string;
    };
    await secrets.delete(raw.apiKeySecretId);

    const reloaded = new GatewayAccessController(file, secrets, logger);
    await reloaded.init();

    assert.equal(reloaded.snapshot().enabled, true);
    assert.equal(reloaded.snapshot().ready, false);
    const result = reloaded.authorize(`Bearer ${rotated.apiKey}`);
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.status, 503);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
