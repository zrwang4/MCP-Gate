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


test("loads persisted audit history across restarts and preserves filters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-audit-"));
  try {
    const file = join(dir, "audit.jsonl");
    const first = new AuditLogger(file);
    await first.init();

    first.record({
      source: "gateway",
      publicName: "github__search",
      serverId: "server-1",
      serverAlias: "github",
      originalName: "search",
      success: true,
      durationMs: 10,
    });
    first.record({
      source: "tester",
      publicName: "github__search",
      serverId: "server-1",
      serverAlias: "github",
      originalName: "search",
      success: false,
      durationMs: 20,
      error: "failed",
    });
    await first.flush();

    const second = new AuditLogger(file);
    await second.init();

    assert.equal(second.list().length, 2);
    assert.equal(second.list({ source: "tester" }).length, 1);
    assert.equal(second.list({ success: false }).length, 1);
    assert.equal(second.list({ serverId: "server-1", publicName: "github__search" }).length, 2);

    const next = second.record({
      source: "gateway",
      publicName: "github__create",
      serverId: "server-2",
      serverAlias: "github",
      originalName: "create",
      success: true,
      durationMs: 4,
    });
    assert.equal(next.seq, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("rotates the active audit file after it crosses the size limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-audit-rotate-"));
  try {
    const file = join(dir, "audit.jsonl");
    const audit = new AuditLogger(file, 2);
    await audit.init();

    audit.record({
      source: "tester",
      publicName: "remote__large",
      serverId: "server-1",
      serverAlias: "remote",
      originalName: "large",
      success: false,
      durationMs: 1,
      error: "x".repeat(5 * 1024 * 1024),
    });
    await audit.flush();

    audit.record({
      source: "tester",
      publicName: "remote__after",
      serverId: "server-1",
      serverAlias: "remote",
      originalName: "after",
      success: true,
      durationMs: 1,
    });
    await audit.flush();

    const rotated = await readFile(file + ".1", "utf8");
    const current = await readFile(file, "utf8");
    assert.match(rotated, /"publicName":"remote__large"/);
    assert.match(current, /remote__after/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
