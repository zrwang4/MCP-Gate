import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreLogger } from "./logger.ts";
import { ProfileStore } from "./profile-store.ts";

test("profile store persists profiles and active profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-profiles-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const file = join(dir, "profiles.json");
    const store = new ProfileStore(file, logger);
    await store.init();

    const profile = await store.create("Coding", ["a", "b", "a"]);
    assert.deepEqual(profile.serverIds, ["a", "b"]);

    await store.setActive(profile.id);

    const reloaded = new ProfileStore(file, logger);
    await reloaded.init();
    assert.equal(reloaded.activeProfileId, profile.id);
    assert.deepEqual(reloaded.getActive()?.serverIds, ["a", "b"]);

    await reloaded.removeServer("a");
    assert.deepEqual(reloaded.get(profile.id)?.serverIds, ["b"]);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("removing the active profile clears activeProfileId", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-profiles-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const store = new ProfileStore(join(dir, "profiles.json"), logger);
    await store.init();

    const profile = await store.create("Work", []);
    await store.setActive(profile.id);
    assert.equal(await store.remove(profile.id), true);
    assert.equal(store.activeProfileId, null);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
