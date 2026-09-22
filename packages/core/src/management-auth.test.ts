import assert from "node:assert/strict";
import test from "node:test";
import {
  constantTimeEqual,
  isManagementRequestAuthorized,
} from "./management-auth.ts";

test("management token authorizes matching token only", () => {
  assert.equal(
    isManagementRequestAuthorized(
      { "x-mcp-gate-token": "secret-token" },
      "secret-token",
    ),
    true,
  );
  assert.equal(
    isManagementRequestAuthorized(
      { "x-mcp-gate-token": "wrong-token" },
      "secret-token",
    ),
    false,
  );
  assert.equal(
    isManagementRequestAuthorized(
      { "x-mcp-gate-client": "desktop" },
      "secret-token",
    ),
    false,
  );
});

test("legacy desktop header remains available only without configured token", () => {
  assert.equal(
    isManagementRequestAuthorized(
      { "x-mcp-gate-client": "desktop" },
      null,
    ),
    true,
  );
  assert.equal(isManagementRequestAuthorized({}, null), false);
});

test("constant time comparison handles different lengths", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});
