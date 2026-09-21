import assert from "node:assert/strict";
import test from "node:test";
import { MemorySecretStore } from "./secret-store.ts";

test("memory secret store supports set/get/delete without exposing values", async () => {
  const store = new MemorySecretStore();

  assert.equal(await store.get("missing"), null);
  await store.set("http-auth:test", "Bearer super-secret");
  assert.equal(await store.get("http-auth:test"), "Bearer super-secret");
  assert.equal(await store.delete("http-auth:test"), true);
  assert.equal(await store.get("http-auth:test"), null);
});
