import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuditLogger } from "./audit-logger.ts";

test("audit logger records metadata without arguments or results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-audit-"));
  try {
    const file = join(dir, "audit.jsonl");
    const audit = new AuditLogger(file);
    await audit.init();

    audit.record({
      source: "gateway",
      publicName: "github__create_issue",
      serverId: "server-1",
      serverAlias: "github",
      originalName: "create_issue",
      success: true,
      durationMs: 12.4,
    });
    await audit.flush();

    const entry = audit.list()[0];
    assert.equal(entry?.durationMs, 12);
    assert.equal(entry?.success, true);

    const raw = await readFile(file, "utf8");
    assert.doesNotMatch(raw, /arguments|result|super-secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("audit logger redacts secrets from errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-audit-"));
  try {
    const audit = new AuditLogger(join(dir, "audit.jsonl"));
    await audit.init();

    audit.record({
      source: "tester",
      publicName: "remote__query",
      serverId: "server-2",
      serverAlias: "remote",
      originalName: "query",
      success: false,
      durationMs: 3,
      error: "Authorization: Bearer secret-token",
    });

    assert.equal(
      audit.list()[0]?.error,
      "Authorization: Bearer [REDACTED]",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
