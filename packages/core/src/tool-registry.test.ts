import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry } from "./tool-registry.ts";

test("tool registry creates explicit namespaced routes", () => {
  const registry = new ToolRegistry();
  registry.replaceServerTools("srv-1", "github", [
    { name: "create_issue", description: "Create issue" },
    { name: "list repos" },
  ]);

  const routes = registry.list();
  assert.deepEqual(routes.map((route) => route.publicName), [
    "github__create_issue",
    "github__list_repos",
  ]);
  assert.equal(registry.resolve("github__create_issue")?.originalName, "create_issue");
});

test("tool registry avoids collisions without parsing public names", () => {
  const registry = new ToolRegistry();
  registry.replaceServerTools("srv-1", "db", [{ name: "query" }]);
  registry.replaceServerTools("srv-2", "db", [{ name: "query" }]);

  assert.deepEqual(registry.list().map((route) => route.publicName), [
    "db__query",
    "db__query__2",
  ]);
});

test("disabled tools are hidden from normal list", () => {
  const registry = new ToolRegistry();
  registry.replaceServerTools("srv-1", "git", [{ name: "delete_repo" }]);

  assert.equal(registry.setEnabled("git__delete_repo", false), true);
  assert.equal(registry.list().length, 0);
  assert.equal(registry.list({ includeDisabled: true }).length, 1);
});


test("tool registry preserves enabled state when a server refreshes tools", () => {
  const registry = new ToolRegistry();
  registry.replaceServerTools("srv-1", "git", [
    { name: "delete_repo" },
    { name: "list_repo" },
  ]);

  registry.setEnabled("git__delete_repo", false);
  registry.replaceServerTools("srv-1", "git", [
    { name: "delete_repo", description: "updated" },
    { name: "list_repo" },
  ]);

  assert.equal(
    registry.resolve("git__delete_repo")?.enabled,
    false,
  );
  assert.equal(
    registry.resolve("git__list_repo")?.enabled,
    true,
  );
});

test("tool registry emits change events only for observable changes", () => {
  const registry = new ToolRegistry();
  let changed = 0;
  const unsubscribe = registry.onChanged(() => {
    changed += 1;
  });

  registry.replaceServerTools("srv-1", "git", [{ name: "status" }]);
  assert.equal(changed, 1);

  registry.setEnabled("git__status", false);
  assert.equal(changed, 2);

  registry.setEnabled("git__status", false);
  assert.equal(changed, 2);

  registry.removeServer("missing");
  assert.equal(changed, 2);

  registry.removeServer("srv-1");
  assert.equal(changed, 3);

  registry.clear();
  assert.equal(changed, 3);

  unsubscribe();
  registry.replaceServerTools("srv-2", "db", [{ name: "query" }]);
  assert.equal(changed, 3);
});
