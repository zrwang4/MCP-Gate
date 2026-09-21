import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets } from "./logger.ts";

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
