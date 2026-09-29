import assert from "node:assert/strict";
import test from "node:test";
import { CoreLogger, redactSecrets } from "./logger.ts";

test("redacts common key=value secrets", () => {
  assert.equal(redactSecrets("token=abc123 password=hunter2"), "token=[REDACTED] password=[REDACTED]");
});

test("redacts JSON-formatted secrets", () => {
  assert.equal(
    redactSecrets('{"token":"abc123","password":"hunter2","safe":"visible"}'),
    '{"token":"[REDACTED]","password":"[REDACTED]","safe":"visible"}',
  );
});

test("redacts authorization headers and query parameters", () => {
  assert.equal(
    redactSecrets("Authorization: Bearer abc123 https://example.test/?token=secret&x=1"),
    "Authorization: Bearer [REDACTED] https://example.test/?token=[REDACTED]&x=1",
  );
});


test("redacts OAuth-style token names", () => {
  assert.equal(
    redactSecrets(
      "access_token=access123 refresh_token=refresh123 id_token=id123 client_secret=secret123",
    ),
    "access_token=[REDACTED] refresh_token=[REDACTED] id_token=[REDACTED] client_secret=[REDACTED]",
  );
});


test("loads persisted log history across restarts and preserves sequence numbers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-logger-"));
  try {
    const file = join(dir, "core.jsonl");
    const first = new (await import("./logger.ts")).CoreLogger(file);
    await first.init();
    first.info("upstream", "connected github");
    first.warn("gateway", "request retry");
    await first.flush();

    const second = new (await import("./logger.ts")).CoreLogger(file);
    await second.init();

    assert.equal(second.list().length, 2);
    assert.equal(second.list()[0]?.seq, 1);
    assert.equal(second.list({ source: "gateway" })[0]?.message, "request retry");
    assert.equal(second.list({ contains: "GITHUB" })[0]?.message, "connected github");

    second.info("core", "ready");
    await second.flush();
    assert.equal(second.list().at(-1)?.seq, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
