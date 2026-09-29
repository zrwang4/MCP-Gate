import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { restoreConfigurationFiles, validateBackupBundle } from "./management-route-backup.ts";

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


test("configuration restore rolls back files already replaced when a later write fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-gate-backup-transaction-"));
  try {
    const servers = join(dir, "servers.json");
    const profiles = join(dir, "profiles.json");
    await writeFile(servers, '{"version":1,"servers":[{"name":"old"}]}');
    await writeFile(profiles, '{"version":1,"profiles":[{"name":"old-profile"}]}');

    let writes = 0;
    const writer = async (
      value: unknown,
      options: { directory: string; fileName: string },
    ): Promise<void> => {
      writes += 1;
      if (writes === 2) throw new Error("injected restore failure");
      await writeFile(
        join(options.directory, options.fileName),
        JSON.stringify(value),
      );
    };

    await assert.rejects(
      restoreConfigurationFiles(
        [
          { path: servers, value: { version: 1, servers: [{ name: "new" }] } },
          { path: profiles, value: { version: 1, profiles: [{ name: "new-profile" }] } },
        ],
        undefined,
        writer as never,
      ),
      /injected restore failure/,
    );

    assert.deepEqual(
      JSON.parse(await readFile(servers, "utf8")),
      { version: 1, servers: [{ name: "old" }] },
    );
    assert.deepEqual(
      JSON.parse(await readFile(profiles, "utf8")),
      { version: 1, profiles: [{ name: "old-profile" }] },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
