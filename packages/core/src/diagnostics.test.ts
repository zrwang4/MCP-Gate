import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeHttpUrl,
  toDiagnosticServerConfig,
} from "./diagnostics.ts";
import type {
  HttpServerConfig,
  StdioServerConfig,
} from "./server-registry.ts";

const base = {
  id: "server-1",
  name: "Example",
  alias: "example",
  enabled: true,
  autoStart: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

test("diagnostic stdio config excludes env values secret ids and args", () => {
  const server: StdioServerConfig = {
    ...base,
    transport: "stdio",
    command: "/usr/bin/npx",
    args: ["--token", "very-secret", "package-name"],
    cwd: "/tmp/project",
    env: {
      MODE: "production",
      INTERNAL_VALUE: "do-not-export",
    },
    envSecretIds: {
      API_TOKEN: "stdio-env:opaque-secret-id",
    },
  };

  const diagnostic = toDiagnosticServerConfig(server);
  const serialized = JSON.stringify(diagnostic);

  assert.equal(diagnostic.transport, "stdio");
  assert.equal(diagnostic.argCount, 3);
  assert.deepEqual(diagnostic.envKeys, ["INTERNAL_VALUE", "MODE"]);
  assert.deepEqual(diagnostic.secretEnvKeys, ["API_TOKEN"]);
  assert.doesNotMatch(serialized, /very-secret|do-not-export|opaque-secret-id/);
});

test("diagnostic HTTP URL removes credentials query and fragment", () => {
  const server: HttpServerConfig = {
    ...base,
    transport: "http",
    url: "https://user:pass@example.com/mcp?token=secret#fragment",
    authSecretId: "http-auth:opaque-id",
  };

  const diagnostic = toDiagnosticServerConfig(server);
  const serialized = JSON.stringify(diagnostic);

  assert.equal(diagnostic.url, "https://example.com/mcp");
  assert.equal(diagnostic.hasAuthorization, true);
  assert.doesNotMatch(serialized, /user|pass|token=secret|opaque-id/);
});

test("sanitizeHttpUrl redacts token-like fallback text", () => {
  assert.equal(
    sanitizeHttpUrl("not-a-url token=secret"),
    "not-a-url token=[REDACTED]",
  );
});
