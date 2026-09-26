import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeJsonWithBackup } from "./atomic-write.ts";
import { CoreLogger } from "./logger.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mcp-gate-atomic-"));
}

test("first write leaves no backup and creates the file", async () => {
  const dir = await tempDir();
  try {
    await writeJsonWithBackup({ version: 1 }, { directory: dir, fileName: "servers.json" });

    assert.deepEqual(JSON.parse(await readFile(join(dir, "servers.json"), "utf8")), {
      version: 1,
    });

    const backupsDirNames = await readdir(join(dir, "backups")).catch(() => []);
    assert.equal(backupsDirNames.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("each subsequent write keeps one backup per previous state", async () => {
  const dir = await tempDir();
  try {
    await writeJsonWithBackup({ n: 1 }, { directory: dir, fileName: "servers.json" });
    await writeJsonWithBackup({ n: 2 }, { directory: dir, fileName: "servers.json" });
    await writeJsonWithBackup({ n: 3 }, { directory: dir, fileName: "servers.json" });

    assert.equal(JSON.parse(await readFile(join(dir, "servers.json"), "utf8")).n, 3);

    const backups = (await readdir(join(dir, "backups"))).sort();
    assert.equal(backups.length, 2, `expected backups for n=1 and n=2, got ${backups}`);

    const contents = await Promise.all(
      backups.map((name) =>
        readFile(join(dir, "backups", name), "utf8").then((raw) => JSON.parse(raw).n),
      ),
    );
    assert.equal(new Set(contents).size, 2);
    assert.ok(contents.includes(1));
    assert.ok(contents.includes(2));
    assert.ok(!contents.includes(3), "backup must capture the previous state, not the new one");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rotation keeps only the newest maxBackups", async () => {
  const dir = await tempDir();
  try {
    for (let i = 1; i <= 8; i += 1) {
      await writeJsonWithBackup({ n: i }, {
        directory: dir,
        fileName: "tool-policy.json",
        maxBackups: 3,
      });
    }

    const backups = await readdir(join(dir, "backups"));
    assert.equal(backups.length, 3);

    const values = await Promise.all(
      backups.map((name) =>
        readFile(join(dir, "backups", name), "utf8").then((raw) => JSON.parse(raw).n),
      ),
    );
    assert.deepEqual(values.sort(), [5, 6, 7], "should keep the three states before the last");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("backups are scoped per file stem", async () => {
  const dir = await tempDir();
  try {
    // Two writes to servers.json: the first creates it, the second backs it up.
    await writeJsonWithBackup({ a: 1 }, { directory: dir, fileName: "servers.json" });
    await writeJsonWithBackup({ a: 2 }, { directory: dir, fileName: "servers.json" });
    // profiles.json does not exist yet, so this writes without a backup.
    await writeJsonWithBackup({ b: 1 }, { directory: dir, fileName: "profiles.json" });

    const names = await readdir(join(dir, "backups"));
    assert.equal(names.length, 1);
    assert.ok(names[0].startsWith("servers."), `expected servers.* backup, got ${names[0]}`);
    assert.ok(!names.some((name) => name.startsWith("profiles.")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unreadable target is backed up without aborting the write", async () => {
  const dir = await tempDir();
  try {
    const target = join(dir, "gateway-access.json");
    await writeFile(target, "{ this is not json", "utf8");

    await writeJsonWithBackup(
      { apiKeySecretId: null, lanEnabled: false },
      { directory: dir, fileName: "gateway-access.json" },
    );

    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
      apiKeySecretId: null,
      lanEnabled: false,
    });

    const backups = await readdir(join(dir, "backups"));
    assert.equal(backups.length, 1);
    const raw = await readFile(join(dir, "backups", backups[0]), "utf8");
    assert.equal(raw, "{ this is not json", "malformed content must be preserved verbatim");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed backup still lets the write land", async () => {
  const dir = await tempDir();
  const logger = new CoreLogger(join(dir, "core.jsonl"));
  await logger.init();

  try {
    const target = join(dir, "servers.json");
    await writeFile(target, '{"old":true}', "utf8");
    // A directory where the backup file should go forces copyFile to fail.
    const backupsDir = join(dir, "backups");
    await rm(backupsDir, { recursive: true, force: true }).catch(() => undefined);
    const path = await import("node:path");
    await (await import("node:fs/promises")).mkdir(backupsDir, { recursive: true });

    // Use a timestamp-stamped name and pre-create it as a directory. Two writes
    // in the same millisecond would collide, so drive that deterministically by
    // seeding a directory for the timestamp the next write is likely to use.
    const stamp = Date.now();
    await (await import("node:fs/promises")).mkdir(
      path.join(backupsDir, `servers.${stamp}.bak`),
      { recursive: true },
    );

    for (let i = 0; i < 5; i += 1) {
      await writeJsonWithBackup({ attempt: i }, {
        directory: dir,
        fileName: "servers.json",
        logger,
      });
    }

    assert.ok(JSON.parse(await readFile(target, "utf8")), "new content must still be written");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
