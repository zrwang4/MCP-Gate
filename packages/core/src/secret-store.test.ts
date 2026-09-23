import assert from "node:assert/strict";
import test from "node:test";
import {
  MemorySecretStore,
  withKeychainTimeout,
} from "./secret-store.ts";

test("memory secret store supports set/get/delete without exposing values", async () => {
  const store = new MemorySecretStore();

  assert.equal(await store.get("missing"), null);
  await store.set("http-auth:test", "Bearer super-secret");
  assert.equal(await store.get("http-auth:test"), "Bearer super-secret");
  assert.equal(await store.delete("http-auth:test"), true);
  assert.equal(await store.get("http-auth:test"), null);
});

test("keychain timeout rejects a hung read instead of blocking forever", async () => {
  const started = Date.now();
  await assert.rejects(
    withKeychainTimeout(
      "read",
      new Promise<string | null>(() => {
        // Never settles, exactly like a Keychain read waiting on an ACL prompt.
      }),
      60,
    ),
    (error: Error) => {
      assert.match(error.name, /KeychainTimeoutError/);
      assert.match(error.message, /timed out after 60ms/);
      return true;
    },
  );
  // Guards against the race resolving early or the timer being left dangling.
  assert.ok(Date.now() - started >= 50, "should not resolve before the timeout");
});

test("keychain timeout passes through a value that resolves in time", async () => {
  const value = await withKeychainTimeout(
    "read",
    Promise.resolve("Bearer ok"),
    1_000,
  );
  assert.equal(value, "Bearer ok");
});
