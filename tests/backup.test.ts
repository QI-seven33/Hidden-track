import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { backupDatabase } from "../deploy/backup.mjs";
import { Store } from "../src/server/store";
import { Rooms } from "../src/server/rooms";
import { SONGS } from "../src/game/catalog";

test("online backup restores committed WAL rooms, deduplication and encrypted authorization using the original secret", async () => {
  const dir = mkdtempSync(join(tmpdir(), "music-foundation-backup-"));
  const secret = "31".repeat(32);
  const store = new Store(join(dir, "live.sqlite"), secret);
  const rooms = new Rooms(store);
  try {
    store.db.exec("PRAGMA wal_autocheckpoint=0");
    store.createSession("a", "甲");
    store.setAuth("a", {
      openId: "test-id",
      accessToken: "test-private-token",
      expiresAt: Date.now() + 60000,
    });
    const { room, invite } = rooms.create("a", "甲", "fixture", false);
    rooms.join(room.id, invite, "b", "乙");
    rooms.select(room.id, "a", SONGS[0]!, 1);
    rooms.select(room.id, "b", SONGS[1]!, 2);
    rooms.start(room.id, "a", 3);
    const command = {
      id: crypto.randomUUID(),
      version: 4,
      action: { type: "guess" as const, answer: { title: SONGS[1]!.title } },
    };
    rooms.act(room.id, "a", command);
    const path = await backupDatabase(
      join(dir, "live.sqlite"),
      join(dir, "backups"),
    );
    const restored = new Store(path, secret);
    const recovered = new Rooms(restored);
    try {
      assert.equal(restored.getAuth("a")?.accessToken, "test-private-token");
      assert.equal(recovered.act(room.id, "a", command).replayed, true);
      assert.equal(
        recovered.get(room.id).match?.catalogHash,
        rooms.get(room.id).match?.catalogHash,
      );
      assert.ok(
        !readFileSync(join(dirname(path), "manifest.json"), "utf8").includes(
          "test-private-token",
        ),
      );
      assert.notEqual(
        await backupDatabase(join(dir, "live.sqlite"), join(dir, "backups")),
        path,
      );
    } finally {
      recovered.close();
      restored.close();
    }
  } finally {
    rooms.close();
    store.close();
    assert.equal(resolve(dirname(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("music-foundation-backup-"));
    rmSync(dir, { recursive: true, force: true });
  }
});
