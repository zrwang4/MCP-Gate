import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadSessionIdleTimeout,
  normalizeSessionIdleTimeout,
  saveSessionIdleTimeout,
} from "./session-settings.ts";

test("session idle timeout accepts the supported range", () => {
  assert.equal(normalizeSessionIdleTimeout(60_000), 60_000);
  assert.equal(normalizeSessionIdleTimeout(24 * 60 * 60_000), 24 * 60 * 60_000);
  assert.throws(() => normalizeSessionIdleTimeout(30_000), /between 1 minute/);
});

test("session idle timeout persists across restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-session-"));
  try {
    const file = join(dir, "session-settings.json");
    assert.equal(await loadSessionIdleTimeout(file, 15 * 60_000), 15 * 60_000);
    await saveSessionIdleTimeout(file, 60 * 60_000);
    assert.equal(await loadSessionIdleTimeout(file, 15 * 60_000), 60 * 60_000);
    assert.match(await readFile(file, "utf8"), /3600000/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
