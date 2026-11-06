import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { Rooms } from '../src/server/rooms';
import { AppError } from '../src/server/errors';

const secret = '22'.repeat(32);

test('换位要先申请，对方同意才真的换座位', () => {
  const store = new Store(':memory:', secret);
  const rooms = new Rooms(store);
  const created = rooms.create('s-a', '甲', 'fixture', false);
  const id = created.room.id;
  rooms.join(id, created.invite, 's-b', '乙');

  let view = rooms.view(rooms.get(id), 's-a');
  assert.equal(view.me, 'a');
  assert.equal(view.swapAsk, undefined);

  view = rooms.requestSwap(id, 's-a', view.version);
  assert.equal(view.swapAsk?.from, 'a');
  // 只是申请，座位还没动：申请人仍然是先手。
  assert.equal(rooms.view(rooms.get(id), 's-a').me, 'a');
  assert.equal(rooms.view(rooms.get(id), 's-b').me, 'b');

  // 申请人不能替对方点头。
  assert.throws(
    () => rooms.respondSwap(id, 's-a', true, rooms.get(id).version),
    AppError,
  );

  // 拒绝：申请消失，座位不变。
  let after = rooms.respondSwap(id, 's-b', false, rooms.get(id).version);
  assert.equal(after.swapAsk, undefined);
  assert.equal(after.me, 'b');
  assert.equal(rooms.view(rooms.get(id), 's-a').me, 'a');

  // 同意：两边座位互换，先手跟着换。
  rooms.requestSwap(id, 's-a', rooms.get(id).version);
  after = rooms.respondSwap(id, 's-b', true, rooms.get(id).version);
  assert.equal(after.swapAsk, undefined);
  assert.equal(after.me, 'a');
  assert.equal(rooms.view(rooms.get(id), 's-a').me, 'b');

  // 换完还能换回来。
  rooms.requestSwap(id, 's-b', rooms.get(id).version);
  after = rooms.respondSwap(id, 's-a', true, rooms.get(id).version);
  assert.equal(after.me, 'a');
  assert.equal(rooms.view(rooms.get(id), 's-b').me, 'b');
  store.close();
});

test('没有申请时不能表态，重复申请只算一次', () => {
  const store = new Store(':memory:', secret);
  const rooms = new Rooms(store);
  const created = rooms.create('s-a', '甲', 'fixture', false);
  const id = created.room.id;
  rooms.join(id, created.invite, 's-b', '乙');
  assert.throws(
    () => rooms.respondSwap(id, 's-b', true, rooms.get(id).version),
    AppError,
  );
  const first = rooms.requestSwap(id, 's-a', rooms.get(id).version);
  const again = rooms.requestSwap(id, 's-a', first.version);
  assert.equal(again.version, first.version);
  assert.equal(again.swapAsk?.at, first.swapAsk?.at);
  store.close();
});

test('练习房没有真人点头，电脑过一拍自己答应', async () => {
  const store = new Store(':memory:', secret);
  const rooms = new Rooms(store);
  const created = rooms.create('solo', '甲', 'fixture', true);
  const id = created.room.id;
  const before = rooms.view(rooms.get(id), 'solo');
  assert.equal(before.me, 'a');
  const asked = rooms.requestSwap(id, 'solo', before.version);
  assert.equal(asked.swapAsk?.from, 'a');
  // 电脑延时同意，期间座位不动。
  assert.equal(rooms.view(rooms.get(id), 'solo').me, 'a');
  await new Promise((r) => setTimeout(r, 1400));
  const done = rooms.view(rooms.get(id), 'solo');
  assert.equal(done.swapAsk, undefined);
  assert.equal(done.me, 'b');
  store.close();
});
