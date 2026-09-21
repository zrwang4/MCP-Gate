import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreLogger } from "./logger.ts";
import { ToolPolicyStore } from "./tool-policy-store.ts";
import { ToolRegistry } from "./tool-registry.ts";

test("tool policy persists disabled tools across registry recreation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-tool-policy-"));
  try {
    const logger = new CoreLogger(join(dir, "core.jsonl"));
    await logger.init();

    const file = join(dir, "tool-policy.json");
    const policy = new ToolPolicyStore(file, logger);
    await policy.init();
    await policy.setEnabled("srv-1", "delete_repo", false);

    const reloadedPolicy = new ToolPolicyStore(file, logger);
    await reloadedPolicy.init();

    const registry = new ToolRegistry(reloadedPolicy);
    registry.replaceServerTools("srv-1", "github", [
      { name: "delete_repo" },
      { name: "list_repos" },
    ]);

    assert.equal(registry.resolve("github__delete_repo")?.enabled, false);
    assert.equal(registry.resolve("github__list_repos")?.enabled, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
