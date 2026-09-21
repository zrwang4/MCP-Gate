import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreLogger } from "./logger.ts";
import {
  applyMcpClientConfig,
  previewMcpClientConfig,
  toPublicMcpImportPreview,
} from "./mcp-config-import.ts";
import { ServerRegistry } from "./server-registry.ts";
import { MemorySecretStore } from "./secret-store.ts";

test("MCP config preview parses stdio and HTTP without exposing secrets", () => {
  const preview = previewMcpClientConfig({
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@example/github-mcp"],
        env: {
          MODE: "production",
          GITHUB_TOKEN: "gh-secret",
        },
      },
      remote: {
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer remote-secret",
        },
      },
    },
  });

  assert.equal(preview.issues.length, 0);
  assert.equal(preview.candidates.length, 2);

  const publicPreview = toPublicMcpImportPreview(preview);
  assert.deepEqual(
    publicPreview.candidates.find((item) => item.sourceName === "github")
      ?.plainEnvKeys,
    ["MODE"],
  );
  assert.deepEqual(
    publicPreview.candidates.find((item) => item.sourceName === "github")
      ?.secretEnvKeys,
    ["GITHUB_TOKEN"],
  );
  assert.equal(
    publicPreview.candidates.find((item) => item.sourceName === "remote")
      ?.hasAuthorization,
    true,
  );
  assert.doesNotMatch(JSON.stringify(publicPreview), /gh-secret|remote-secret/);
});

test("MCP config preview rejects unsupported headers and interpolation", () => {
  const preview = previewMcpClientConfig({
    mcpServers: {
      remote: {
        url: "https://example.com/mcp",
        headers: {
          "X-API-Key": "secret",
        },
      },
      local: {
        command: "npx",
        env: {
          API_TOKEN: "${env:API_TOKEN}",
        },
      },
    },
  });

  assert.equal(preview.candidates.length, 0);
  assert.equal(preview.issues.length, 2);
  assert.match(preview.issues[0]?.message ?? "", /unsupported HTTP header/);
  assert.match(preview.issues[1]?.message ?? "", /config interpolation/);
});

test("MCP config apply stores sensitive env in SecretStore and skips duplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-import-"));
  let logger: CoreLogger | null = null;
  try {
    logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const file = join(dir, "servers.json");
    const registry = new ServerRegistry(file, logger);
    await registry.init();
    const secrets = new MemorySecretStore();

    const input = {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@example/github-mcp"],
          env: {
            MODE: "production",
            GITHUB_TOKEN: "gh-secret",
          },
        },
      },
    };

    const first = await applyMcpClientConfig(
      input,
      registry,
      secrets,
      logger,
    );
    assert.equal(first.imported.length, 1);
    assert.equal(first.failed.length, 0);

    const server = registry.list()[0];
    assert.equal(server?.transport, "stdio");
    if (server?.transport === "stdio") {
      assert.deepEqual(server.env, { MODE: "production" });
      assert.ok(server.envSecretIds?.GITHUB_TOKEN);
      assert.equal(
        await secrets.get(server.envSecretIds?.GITHUB_TOKEN ?? ""),
        "gh-secret",
      );
    }

    const raw = await readFile(file, "utf8");
    assert.doesNotMatch(raw, /gh-secret/);

    const second = await applyMcpClientConfig(
      input,
      registry,
      secrets,
      logger,
    );
    assert.equal(second.imported.length, 0);
    assert.equal(second.skipped.length, 1);
  } finally {
    await logger?.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
