import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Store } from "../src/server/store";
import { Rooms } from "../src/server/rooms";
import { SONGS } from "../src/game/catalog";
import { DEFAULT_RULES } from "../src/shared/rules";
import { AppError } from "../src/server/errors";
import { RULESET } from "../src/server/ruleset";

test("room views filter hidden state; only a legal reveal exposes the opponent song", () => {
  const store = new Store(":memory:", "11".repeat(32));
  const rooms = new Rooms(store);
  try {
    const created = rooms.create("session-a", "甲", "fixture", false);
    const id = created.room.id;
    rooms.join(id, created.invite, "session-b", "乙");
    assert.throws(() => rooms.view(rooms.get(id), "outsider"), AppError);
    let view = rooms.select(id, "session-a", SONGS[0]!, 1);
    view = rooms.select(id, "session-b", SONGS[1]!, view.version);
    view = rooms.start(id, "session-a", view.version);
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes("珊瑚海"));
    assert.ok(!serialized.includes("梁心颐"));
    for (const field of [
      "catalog",
      "rng",
      "inviteHash",
      "session-a",
      "session-b",
      '"deck":',
    ])
      assert.ok(!serialized.includes(field));
    const action = {
      id: randomUUID(),
      version: view.version,
      action: { type: "guess" as const, answer: { title: "珊瑚海" } },
    };
    const finished = rooms.act(id, "session-a", action);
    assert.equal(finished.room.status, "finished");
    assert.ok(JSON.stringify(finished.room).includes("珊瑚海"));
    const replay = rooms.act(id, "session-a", action);
    assert.equal(replay.replayed, true);
    assert.equal(replay.room.version, finished.room.version);
    assert.throws(
      () =>
        rooms.act(id, "session-a", {
          ...action,
          action: { type: "guess", answer: { title: "other" } },
        }),
      /不同内容/,
    );
  } finally {
    rooms.close();
    store.close();
  }
});
test("new rule versions clear readiness and stale commands are rejected", () => {
  const store = new Store(":memory:", "11".repeat(32));
  const rooms = new Rooms(store);
  try {
    const created = rooms.create("a", "甲", "fixture", false),
      id = created.room.id;
    rooms.join(id, created.invite, "b", "乙");
    rooms.select(id, "a", SONGS[0]!, 1);
    rooms.select(id, "b", SONGS[1]!, 2);
    const updated = rooms.rules(id, "a", { ...DEFAULT_RULES, maxRounds: 3 }, 3);
    assert.equal(updated.canStart, false);
    assert.ok(updated.players.every((p) => !p.ready));
    assert.throws(() => rooms.start(id, "a", 4), /确认当前规则/);
    rooms.ready(id, "a", 4);
    rooms.ready(id, "b", 5);
    const started = rooms.start(id, "a", 6);
    assert.throws(
      () =>
        rooms.act(id, "a", {
          id: randomUUID(),
          version: 0,
          action: { type: "endTurn" },
        }),
      /状态已更新/,
    );
    assert.equal(started.rules.maxRounds, 3);
  } finally {
    rooms.close();
    store.close();
  }
});
test("SQLite restores room versions, private state and encrypted OAuth after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "tencent-music-test-"));
  const path = join(dir, "db.sqlite");
  const key = "22".repeat(32);
  let store = new Store(path, key);
  let rooms = new Rooms(store);
  try {
    store.createSession("a", "甲");
    store.setAuth("a", {
      openId: "openid",
      accessToken: "secret-test-token",
      expiresAt: Date.now() + 100000,
    });
    const row = store.db
      .prepare("SELECT auth FROM sessions WHERE id=?")
      .get("a") as { auth: string };
    assert.ok(!row.auth.includes("secret-test-token"));
    const created = rooms.create("a", "甲", "fixture", false);
    rooms.select(created.room.id, "a", SONGS[0]!, 0);
    rooms.close();
    store.close();
    store = new Store(path, key);
    rooms = new Rooms(store);
    assert.equal(rooms.view(rooms.get(created.room.id), "a").version, 1);
    assert.equal(store.getAuth("a")?.accessToken, "secret-test-token");
  } finally {
    rooms.close();
    store.close();
    assert.equal(resolve(dirname(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("tencent-music-test-"));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new rooms pin a supported ruleset and keep match fingerprints out of player views", () => {
  const store = new Store(":memory:", "11".repeat(32));
  const rooms = new Rooms(store);
  try {
    const { room, invite } = rooms.create("a", "甲", "fixture", false);
    assert.deepEqual(rooms.get(room.id).ruleset, RULESET);
    rooms.join(room.id, invite, "b", "乙");
    rooms.select(room.id, "a", SONGS[0]!, 1);
    rooms.select(room.id, "b", SONGS[1]!, 2);
    const view = rooms.start(room.id, "a", 3);
    const stored = rooms.get(room.id);
    assert.ok(stored.match?.catalogHash);
    assert.ok(!JSON.stringify(view).includes(stored.match!.catalogHash));
    assert.ok(!JSON.stringify(view).includes("evidence"));
    stored.ruleset!.revision++;
    rooms.save(stored);
    assert.throws(() => rooms.get(room.id), /其他版本的规则/);
    assert.ok(store.getRoom(room.id));
    delete stored.ruleset;
    rooms.save(stored);
    assert.throws(() => rooms.get(room.id), /其他版本的规则/);
  } finally {
    rooms.close();
    store.close();
  }
});

test("the same recording cannot silently use one player’s conflicting snapshot", () => {
  const store = new Store(":memory:", "11".repeat(32));
  const rooms = new Rooms(store);
  try {
    const { room, invite } = rooms.create("a", "甲", "fixture", false);
    rooms.join(room.id, invite, "b", "乙");
    rooms.select(room.id, "a", SONGS[0]!, 1);
    rooms.select(room.id, "b", { ...SONGS[0]!, year: 1900 }, 2);
    assert.throws(() => rooms.start(room.id, "a", 3), /资料不一致/);
    assert.equal(rooms.get(room.id).version, 3);
    rooms.select(room.id, "b", structuredClone(SONGS[0]!), 3);
    const started = rooms.start(room.id, "a", 4);
    assert.equal(started.status, "playing");
    assert.equal(rooms.get(room.id).game?.catalog.length, 1);
  } finally {
    rooms.close();
    store.close();
  }
});

test("old draft records are retained and rejected instead of being interpreted with new rules", () => {
  const store = new Store(":memory:", "11".repeat(32)),
    rooms = new Rooms(store);
  try {
    const created = rooms.create("a", "甲", "fixture", false),
      room = rooms.get(created.room.id);
    room.ruleset!.revision = 1;
    rooms.save(room);
    assert.throws(() => rooms.get(room.id), /其他版本的规则/);
    assert.ok(store.getRoom(room.id));
  } finally {
    rooms.close();
    store.close();
  }
});
