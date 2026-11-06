import assert from 'node:assert/strict';
import test from 'node:test';
import { cardUnavailableReason, transition } from '../src/game/engine';
import { CARD_BY_ID } from '../src/shared/cards';
import { setup, play, respond } from './game-helpers';

// 封麦只负责进攻：0.7.3 的「攻防两用」已回滚，受击时不能当响应牌打出。
// 唯一响应牌是蓝调（0 费、完全抵消）。

test('封麦在受击窗口不可用，被明确拒绝而不是静默消耗', () => {
  let s = setup(['strike'], ['strike', 'pause']);
  s = play(s, 'strike');
  assert.equal(s.response?.kind, 'attack');
  const strike = s.players.b.hand.find((c) => c.cardId === 'strike')!;
  assert.equal(cardUnavailableReason(s, 'b', strike), '此时只能使用蓝调');
  const r = transition(s, {
    type: 'respond',
    side: 'b',
    instanceId: strike.id,
  });
  assert.equal(r.error, '此时只能使用蓝调');
  assert.equal(
    r.state.players.b.hand.some((c) => c.cardId === 'strike'),
    true,
  );
});

test('不响应则吃满 20 压力，防守方的行动点与手牌都不变', () => {
  let s = setup(['strike'], ['strike']);
  s = play(s, 'strike');
  s = respond(s);
  assert.equal(s.players.b.pressure, 20);
  assert.equal(s.players.b.energy, 3);
  assert.equal(s.players.b.hand.filter((c) => c.cardId === 'strike').length, 1);
});

test('蓝调仍然是零费全免，是唯一的攻击响应', () => {
  let s = setup(['strike'], ['pause']);
  s = play(s, 'strike');
  s = respond(s, 'pause');
  assert.equal(s.players.b.pressure, 0);
  assert.equal(s.players.b.energy, 3);
  assert.equal(
    s.players.b.hand.some((c) => c.cardId === 'pause'),
    false,
  );
});

test('攻击是纯粹的外部性：出手方不承担压力，也不获得线索', () => {
  let s = setup(['strike'], []);
  s = play(s, 'strike');
  s = respond(s);
  assert.equal(s.players.a.pressure, 0);
  assert.equal(s.players.a.clues.length, 0);
  assert.equal(s.players.b.clues.length, 0);
  assert.equal(s.players.a.energy, 2);
});

test('20 压力 5 次到顶，一张封麦只能推进一次', () => {
  let s = setup(['strike'], []);
  s.players.b.pressure = 80;
  s = play(s, 'strike');
  s = respond(s);
  assert.equal(s.players.b.pressure, 100);
  assert.equal(s.phase, 'finished');
  assert.equal(s.outcome!.winner, 'a');
  assert.equal(CARD_BY_ID.strike.kind, 'attack');
});
