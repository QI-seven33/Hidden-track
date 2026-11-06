import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Outcome } from '../src/game/types';
import {
  resultHeadline,
  resultKicker,
  resultKind,
  resultNote,
} from '../src/client/result-copy';

const outcome = (o: Partial<Outcome>): Outcome => ({
  winner: 'a',
  reason: 'pressureGuess',
  text: '甲压力到顶，对方获胜。',
  ...o,
});

test('resultKind 从我的视角判定胜负与平局', () => {
  assert.equal(resultKind(outcome({ winner: 'a' }), 'a'), 'win');
  assert.equal(resultKind(outcome({ winner: 'a' }), 'b'), 'loss');
  assert.equal(resultKind(outcome({ winner: 'b' }), 'b'), 'win');
  assert.equal(resultKind(outcome({ winner: 'draw' }), 'a'), 'draw');
});

test('resultHeadline 与结算页原有文案逐字一致', () => {
  // 这四条是结算页改造前的原始说法，改动它们等于改了玩家看到的结论。
  const cases: [Partial<Outcome>, 'a' | 'b', string][] = [
    [{ winner: 'draw' }, 'a', '这一首，留给你'],
    [{ winner: 'a', reason: 'activeGuess' }, 'a', '你听懂了他藏的歌'],
    [{ winner: 'b', reason: 'activeGuess' }, 'a', '他听懂了你的歌'],
    [{ winner: 'a', reason: 'pressureGuess' }, 'a', '这一局，你赢了'],
    [{ winner: 'b', reason: 'pressureGuess' }, 'a', '下一次，会听懂的'],
    [{ winner: 'b', reason: 'finalGuess' }, 'a', '下一次，会听懂的'],
  ];
  for (const [o, me, want] of cases)
    assert.equal(resultHeadline(outcome(o), me), want);
});

test('resultKicker 说清「怎么结束的」', () => {
  assert.equal(
    resultKicker(outcome({ winner: 'b', reason: 'pressureGuess' }), 'a'),
    '你的压力到顶',
  );
  assert.equal(
    resultKicker(outcome({ winner: 'a', reason: 'pressureGuess' }), 'a'),
    '对手压力到顶',
  );
  assert.equal(
    resultKicker(outcome({ winner: 'b', reason: 'activeGuess' }), 'a'),
    '对手猜中了你的底牌',
  );
  assert.equal(
    resultKicker(outcome({ winner: 'a', reason: 'activeGuess' }), 'a'),
    '你猜中了对手的底牌',
  );
  assert.equal(
    resultKicker(outcome({ winner: 'b', reason: 'finalGuess' }), 'a'),
    '最终猜歌 · 你输了',
  );
  assert.equal(resultKicker(outcome({ winner: 'draw' }), 'a'), '双方同时到顶');
});

test('resultNote 把第三人称换成你 / 对手', () => {
  // 服务端原文：输的一方「玩家X压力到顶（…），对方获胜。」
  const loss = outcome({
    winner: 'b',
    text: '玩家一压力到顶（为关键线索支付 16 点压力），对方获胜。',
  });
  assert.equal(
    resultNote(loss, 'a'),
    '你压力到顶（为关键线索支付 16 点压力），对手获胜。',
  );
  const win = outcome({ winner: 'a', text: '玩家二压力到顶，对方获胜。' });
  assert.equal(resultNote(win, 'a'), '对手压力到顶，你获胜。');
  // 站在 b 的位置看同一局，说法要跟着翻转。
  assert.equal(resultNote(win, 'b'), '你压力到顶，对手获胜。');
  // 平局没有阵营，原样保留。
  const draw = outcome({ winner: 'draw', text: '双方压力同时到顶，本局平局。' });
  assert.equal(resultNote(draw, 'a'), '双方压力同时到顶，本局平局。');
  // 猜歌结束：机械替换会得到「对手猜中了对手底牌」，这一支必须单独写。
  const guess = outcome({
    winner: 'b',
    reason: 'activeGuess',
    text: '玩家二猜中了对手底牌。',
  });
  assert.equal(resultNote(guess, 'a'), '对手猜中了你的底牌。');
  assert.equal(
    resultNote(outcome({ winner: 'a', reason: 'activeGuess', text: '玩家一猜中了对手底牌。' }), 'a'),
    '你猜中了对手的底牌。',
  );
});
