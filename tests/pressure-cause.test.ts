import assert from 'node:assert/strict';
import test from 'node:test';
import { play, respond, setup } from './game-helpers';

/** 压力到顶是唯一输法，结算必须写清「怎么到的顶」。 */
test('买线索把自己打爆：结算写明是为线索支付的压力', () => {
  const s = setup(['information'], []);
  s.players.a.pressure = 96;
  const next = play(s, 'information');
  assert.equal(next.outcome?.reason, 'pressureGuess');
  assert.equal(next.outcome?.winner, 'b');
  assert.match(next.outcome?.cause ?? '', /线索支付 6 点压力/);
  assert.match(next.outcome?.text ?? '', /压力到顶（.*线索支付.*）/);
});

test('被打爆：结算写明是被哪张牌打中', () => {
  const s = setup(['strike'], []);
  s.players.b.pressure = 85;
  const afterAttack = play(s, 'strike');
  // 被封麦命中后压力到顶，直接进结算，不需要对方响应。
  const next = afterAttack.response ? respond(afterAttack) : afterAttack;
  assert.equal(next.outcome?.reason, 'pressureGuess');
  assert.equal(next.outcome?.winner, 'a');
  assert.match(next.outcome?.cause ?? '', /《封麦》/);
});

test('没有来源时不硬编原因', () => {
  const s = setup(['drawOne'], []);
  s.players.a.pressure = 100;
  // 直接把压力推到上限再触发一次结算：原因缺失时只给基础文案。
  const next = play(s, 'drawOne');
  assert.equal(next.outcome?.reason, 'pressureGuess');
  assert.equal(next.outcome?.cause, undefined);
  assert.match(next.outcome?.text ?? '', /压力到顶，对方获胜/);
});
