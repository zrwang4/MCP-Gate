import assert from "node:assert/strict";
import test from "node:test";
import { MutationQueue } from "./mutation-queue.ts";

test("mutation queue runs operations strictly in submission order", async () => {
  const queue = new MutationQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;

  const first = queue.run(async () => {
    events.push("first:start");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    events.push("first:end");
  });

  const second = queue.run(async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("mutation queue releases the lock after a failed operation", async () => {
  const queue = new MutationQueue();
  const events: string[] = [];

  await assert.rejects(
    queue.run(async () => {
      events.push("failed");
      throw new Error("boom");
    }),
    /boom/,
  );

  await queue.run(async () => {
    events.push("recovered");
  });

  assert.deepEqual(events, ["failed", "recovered"]);
});

test("mutation queue reports slow wait or operation time without affecting results", async () => {
  const timings: { waitMs: number; operationMs: number }[] = [];
  const queue = new MutationQueue({
    slowOperationMs: 0,
    onSlowOperation: (timing) => timings.push(timing),
  });

  assert.equal(await queue.run(async () => 42), 42);
  assert.equal(timings.length, 1);
  assert.ok(timings[0].waitMs >= 0);
  assert.ok(timings[0].operationMs >= 0);
});

test("mutation queue ignores errors from slow-operation diagnostics", async () => {
  const queue = new MutationQueue({
    slowOperationMs: 0,
    onSlowOperation: () => {
      throw new Error("diagnostic failure");
    },
  });

  assert.equal(await queue.run(async () => "still works"), "still works");
});
