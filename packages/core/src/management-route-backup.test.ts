import assert from "node:assert/strict";
import test from "node:test";
import { validateBackupBundle } from "./management-route-backup.ts";

const validBackup = (): {
  version: 1;
  exportedAt: string;
  note: string;
  servers: { version: 1; servers: unknown[] };
  profiles: { version: 1; activeProfileId: string | null; profiles: unknown[] };
  toolPolicy: { version: 1; disabled: Record<string, unknown> };
  gatewayAccess: { version: 1; apiKeySecretId: string | null; lanEnabled: boolean };
  sessionSettings: { version: 1; idleTimeoutMs: number };
} => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  note: "test",
  servers: { version: 1, servers: [] },
  profiles: { version: 1, activeProfileId: null, profiles: [] },
  toolPolicy: { version: 1, disabled: {} },
  gatewayAccess: { version: 1, apiKeySecretId: null, lanEnabled: false },
  sessionSettings: { version: 1, idleTimeoutMs: 30 * 60_000 },
});

test("backup validator accepts a complete configuration bundle", () => {
  const bundle = validateBackupBundle(validBackup());
  assert.equal(bundle.version, 1);
  assert.equal((bundle.sessionSettings as { idleTimeoutMs: number }).idleTimeoutMs, 30 * 60_000);
});

test("backup validator rejects invalid session settings", () => {
  const backup = validBackup();
  backup.sessionSettings = { version: 1, idleTimeoutMs: 30_000 };
  assert.throws(() => validateBackupBundle(backup), /between 1 minute/);
});

test("backup validator rejects a dangling active profile", () => {
  const backup = validBackup();
  backup.profiles = {
    version: 1,
    activeProfileId: "missing",
    profiles: [],
  };
  assert.throws(() => validateBackupBundle(backup), /active profile does not exist/);
});
