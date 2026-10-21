import assert from "node:assert/strict";
import test from "node:test";
import { moveServer, orderServers, parseServerOrder } from "../apps/desktop/src/lib/server-order.ts";

test("saved order tolerates missing, malformed and duplicate IDs", () => {
  for (const raw of [null, "invalid", "{}", "null"]) assert.deepEqual(parseServerOrder(raw), []);
  assert.deepEqual(parseServerOrder('["b",1,"b","a"]'), ["b", "a"]);
});

test("refresh keeps saved order, ignores deleted IDs and appends new servers", () => {
  const servers = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(orderServers(servers, ["b", "removed", "b", "a"]).map(s => s.id), ["b", "a", "c"]);
  assert.deepEqual(servers.map(s => s.id), ["a", "b", "c"]);
});

test("drop inserts before or after targets in both directions without mutation", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(moveServer(order, "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(moveServer(order, "a", "c", false), ["b", "a", "c", "d"]);
  assert.deepEqual(moveServer(order, "d", "b", false), ["a", "d", "b", "c"]);
  assert.deepEqual(moveServer(order, "d", "b", true), ["a", "b", "d", "c"]);
  assert.deepEqual(order, ["a", "b", "c", "d"]);
});

test("dropping on self or a removed item leaves order unchanged", () => {
  const order = ["a", "b"];
  assert.deepEqual(moveServer(order, "a", "a", true), order);
  assert.deepEqual(moveServer(order, "missing", "a", true), order);
  assert.deepEqual(moveServer(order, "a", "missing", false), order);
});
