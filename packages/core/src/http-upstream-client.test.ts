import assert from "node:assert/strict";
import test from "node:test";
import { HttpAgentPool } from "./http-upstream-client.ts";

test("HTTP Agent pool reuses agents while leases are active and evicts idle agents", async () => {
  const pool = new HttpAgentPool();

  const first = pool.acquire(10_000);
  const second = pool.acquire(10_000);
  assert.strictEqual(first.agent, second.agent);

  await first.release();

  const third = pool.acquire(10_000);
  assert.strictEqual(third.agent, second.agent);

  await second.release();

  const fourth = pool.acquire(10_000);
  assert.notStrictEqual(fourth.agent, third.agent);

  await third.release();
  await fourth.release();
});

test("HTTP Agent pool keeps different timeout values isolated", async () => {
  const pool = new HttpAgentPool();

  const short = pool.acquire(5_000);
  const long = pool.acquire(60_000);

  assert.notStrictEqual(short.agent, long.agent);

  await short.release();
  await long.release();
});
