import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/server/store';
import { Rooms } from '../src/server/rooms';
import { SONGS } from '../src/game/catalog';
import { DEFAULT_RULES } from '../src/shared/rules';
import { developerPatchSchema } from '../src/shared/developer';
import { makeApp } from '../src/server/app';
import { guest, testConfig } from './helpers';

function fixture() {
  const store = new Store(':memory:', '11'.repeat(32));
  const rooms = new Rooms(store, true);
  const created = rooms.create('owner', '开发测试', 'fixture', true);
  const id = created.room.id;
  const close = () => {
    rooms.close();
    store.close();
  };
  return { store, rooms, id, close };
}
test('developer rule edits are versioned, idempotent, persisted and leave global defaults intact', () => {
  const { rooms, id, close } = fixture();
  try {
    const before = structuredClone(DEFAULT_RULES);
    const command = {
      id: randomUUID(),
      version: 0,
      patch: {
        rules: {
          ...DEFAULT_RULES,
          initialHand: 0,
          maxEnergy: 25,
          startingEnergy: 20,
          pressureLimit: 160,
          handLimit: 0,
          drawPerTurn: 0,
        },
      },
    };
    const result = rooms.develop(id, 'owner', command);
    assert.equal(result.room.rules.maxEnergy, 25);
    assert.equal(result.room.rules.pressureLimit, 160);
    assert.equal(result.room.developer?.used, true);
    assert.deepEqual(DEFAULT_RULES, before);
    assert.equal(rooms.develop(id, 'owner', command).replayed, true);
    assert.equal(rooms.get(id).version, result.room.version);
    assert.throws(
      () =>
        rooms.develop(id, 'owner', {
          ...command,
          patch: { rules: { ...DEFAULT_RULES } },
        }),
      /不同内容/,
    );
    assert.throws(
      () => rooms.develop(id, 'owner', { ...command, id: randomUUID() }),
      /已更新/,
    );
    const raw = rooms.get(id);
    assert.equal(raw.developer?.used, true);
  } finally {
    close();
  }
});
test('developer live edits use normal pressure settlement and resume clocks, without hidden card data', () => {
  const { rooms, id, close } = fixture();
  try {
    let view = rooms.select(id, 'owner', SONGS[0]!, 0);
    view = rooms.start(id, 'owner', view.version);
    // A stable play phase isolates adjustment semantics from random event effects.
    const raw = rooms.get(id),
      s = raw.game!;
    s.stageEvents.resolved = true;
    s.stageEvents.drawn = true;
    s.pending = null;
    s.response = null;
    s.rps = null;
    s.queue = [];
    s.eventQueue = [];
    rooms.save(raw);
    const values = view.developer!.players!;
    const result = rooms.develop(id, 'owner', {
      id: randomUUID(),
      version: view.version,
      patch: {
        paused: true,
        rules: { ...DEFAULT_RULES, handLimit: 1 },
        players: {
          a: {
            ...values.a,
            energy: 7,
            maxEnergy: 9,
            pressure: 65,
            pressureCap: 120,
            refreshes: 8,
          },
        },
      },
    });
    view = result.room;
    assert.equal(view.developer?.paused, true);
    assert.equal(view.players[0]!.energy, 7);
    assert.equal(view.game?.handLimit, 1);
    assert.equal(rooms.get(id).game?.clock, null);
    assert.ok(!JSON.stringify(view.developer).includes('songId'));
    assert.ok(!JSON.stringify(view.developer).includes('"hand"'));
    const v = rooms.get(id).version;
    assert.throws(
      () =>
        rooms.develop(id, 'owner', {
          id: randomUUID(),
          version: v,
          patch: {
            players: {
              a: { ...view.developer!.players!.a, energy: 10, maxEnergy: 2 },
            },
          },
        }),
      /不能超过上限/,
    );
    assert.equal(rooms.get(id).version, v);
    assert.equal(rooms.get(id).game?.players.a.energy, 7);
    view = rooms.develop(id, 'owner', {
      id: randomUUID(),
      version: v,
      patch: {
        paused: false,
        players: { a: { ...view.developer!.players!.a, pressure: 120 } },
      },
    }).room;
    assert.equal(view.game?.phase, 'finished');
    assert.equal(view.game?.outcome?.reason, 'pressureGuess');
    assert.equal(view.game?.mustGuess, false);
    assert.equal(view.game?.clock, undefined);
    assert.ok(view.game?.log.some((e) => e.title === '开发者调整'));
  } finally {
    close();
  }
});
test('developer edits cannot enter QQ, invited-human, disabled or non-owner rooms', () => {
  const { store, rooms, id, close } = fixture();
  try {
    const command = {
      id: randomUUID(),
      version: 0,
      patch: { rules: DEFAULT_RULES },
    };
    assert.throws(() => rooms.develop(id, 'outsider', command), /不是这个房间/);
    const disabled = new Rooms(store);
    assert.throws(() => disabled.develop(id, 'owner', command), /仅供本机练习/);
    disabled.close();
    const qq = rooms.create('owner', '甲', 'qq', false);
    assert.throws(
      () => rooms.develop(qq.room.id, 'owner', command),
      /仅供本机练习/,
    );
    const human = rooms.create('owner', '甲', 'fixture', false);
    rooms.join(human.room.id, human.invite, 'guest', '乙');
    assert.throws(
      () => rooms.develop(human.room.id, 'owner', { ...command, version: 1 }),
      /仅供本机练习/,
    );
    assert.throws(
      () => rooms.develop(human.room.id, 'guest', { ...command, version: 1 }),
      /仅供本机练习/,
    );
    assert.equal(
      rooms.view(rooms.get(human.room.id), 'owner').developer,
      undefined,
    );
  } finally {
    close();
  }
});
test('developer input rejects unknown fields, fractions and unsafe bounds', () => {
  assert.equal(
    developerPatchSchema.safeParse({
      rules: { ...DEFAULT_RULES, handLimit: 1000 },
    }).success,
    false,
  );
  assert.equal(
    developerPatchSchema.safeParse({
      rules: { ...DEFAULT_RULES, maxEnergy: 4.5 },
    }).success,
    false,
  );
  assert.equal(
    developerPatchSchema.safeParse({
      rules: { ...DEFAULT_RULES, pressureLimit: 0 },
    }).success,
    false,
  );
  assert.equal(
    developerPatchSchema.safeParse({ rules: { ...DEFAULT_RULES, unknown: 1 } })
      .success,
    false,
  );
  assert.equal(developerPatchSchema.safeParse({ catalog: [] }).success, false);
});
test('HTTP developer endpoint follows session, origin and local development gating', async () => {
  for (const production of [false, true]) {
    const { app } = await makeApp({ config: testConfig({ production }) });
    try {
      const headers = await guest(app, '测试');
      const created = (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers,
          payload: { mode: 'fixture', bot: true },
        })
      ).json();
      const url = '/api/rooms/' + created.room.id + '/developer';
      const payload = {
        id: randomUUID(),
        version: 0,
        patch: { rules: { ...DEFAULT_RULES, handLimit: 8 } },
      };
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { ...headers, origin: 'https://evil.test' },
            payload,
          })
        ).statusCode,
        403,
      );
      const response = await app.inject({
        method: 'POST',
        url,
        headers,
        payload,
      });
      assert.equal(response.statusCode, production ? 403 : 200);
      if (!production) assert.equal(response.json().room.rules.handLimit, 8);
      const meta = (await app.inject({ url: '/api/meta' })).json();
      assert.equal(meta.developer, !production);
    } finally {
      await app.close();
    }
  }
});
