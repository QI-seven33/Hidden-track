import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame } from '../src/game/engine';
import {
  clueTierCap,
  cluesExactlyAt,
  effectiveClueOdds,
  rollClueTier,
  shareCap,
} from '../src/game/clues';
import { gainClue, gainStageClue } from '../src/game/operations';
import { setup, setupFusion, play, respond } from './game-helpers';

/** 夹具曲目补齐到四档齐备，否则基础档只有 1–2 条、终极档为空。 */
function enrich<T extends { catalog: readonly object[] }>(s: T): T {
  for (const song of s.catalog)
    Object.assign(song, {
      genre: '模拟流派',
      artistGender: '1 男',
      duration: 240,
      lyricHint: '模拟歌词，不是真实上游结果',
      lyricHints: ['模拟歌词，不是真实上游结果'],
      previewAvailable: true,
    });
  return s;
}
function liveGame(seed: number, round: number) {
  const s = createGame('wish', 'coral', seed);
  s.round = round;
  return enrich(s);
}
/** 统计若干次掷档的分布（每次都用干净状态，避免资料池被抽空干扰）。 */
function sample(round: number, rolls: number) {
  const hits = [0, 0, 0, 0];
  for (let i = 0; i < rolls; i++) {
    const s = liveGame(1000 + i * 13, round);
    hits[rollClueTier(s, 'a', round) - 1]!++;
  }
  return hits.map((n) => (n / rolls) * 100);
}
const near = (actual: number, expected: number, tol = 6) =>
  Math.abs(actual - expected) <= tol;

test('每轮实测分布贴近云顶映射表（已扣除档位上限，1000 次）', () => {
  for (const round of [1, 2, 3, 4] as const) {
    const probe = liveGame(7, round);
    const expected = effectiveClueOdds(probe, round);
    const got = sample(round, 1000);
    got.forEach((pct, i) => {
      assert.ok(
        near(pct, expected[i]!),
        `第 ${round} 轮第 ${i + 1} 档：实测 ${pct.toFixed(1)}% vs 理论 ${expected[i]}%`,
      );
    });
  }
});

test('第 1 轮上限是 2 档：关键信息的 15% 被吸收进进阶，而不是被丢掉', () => {
  const got = sample(1, 1200);
  assert.equal(got[2], 0, '第 1 轮不可能出现关键信息');
  assert.equal(got[3], 0);
  assert.deepEqual(effectiveClueOdds(liveGame(7, 1), 1), [55, 45, 0, 0]);
});

test('分享按「下一轮」的表抽，但档位上限仍是本阶段 +1', () => {
  const s = createGame('wish', 'coral', 31);
  s.round = 1;
  assert.equal(shareCap(s, 'a'), 2);
  s.round = 2;
  assert.equal(shareCap(s, 'a'), 3);
  s.round = 3;
  assert.equal(shareCap(s, 'a'), 4);
  const hits = [0, 0, 0, 0];
  for (let i = 0; i < 600; i++) {
    const g = createGame('wish', 'coral', 5000 + i * 11);
    g.round = 1;
    hits[rollClueTier(g, 'a', g.round + 1, shareCap(g, 'a')) - 1]!++;
  }
  assert.equal(hits[2], 0, '第 1 轮分享仍然摸不到关键');
  assert.equal(hits[3], 0);
  assert.ok(hits[1]! / 600 > 0.5, '分享的进阶率必须高过搜索的 45%');
});

test('抽到的档位没有剩余资料时顺延到相邻档，不出现空奖励', () => {
  const s = liveGame(41, 4);
  // 第 4 档一共 7 条：6 段试听 + 1 条歌词，全部拿走后必须退档。
  for (let i = 0; i < 7; i++) assert.equal(gainClue(s, 'a', 4, false), true);
  assert.equal(cluesExactlyAt(s, 'a', 4).length, 0);
  assert.equal(rollClueTier(s, 'a', 4) < 4, true, '第 4 档已空，必须退档');
  assert.equal(gainStageClue(s, 'a', false), true);
});

test('两条同档信息自动生成一条高一档：原料保留并锁一次，产物可继续参与', () => {
  const s = enrich(setupFusion());
  s.round = 2;
  assert.equal(gainClue(s, 'a', 1, false), true);
  assert.equal(s.players.a.clues.length, 1);
  assert.equal(gainClue(s, 'a', 1, false), true);
  const clues = s.players.a.clues;
  assert.equal(clues.length, 3);
  assert.equal(clues.filter((c) => c.tier === 1 && c.spent).length, 2);
  const fused = clues.find((c) => c.fused)!;
  assert.ok(fused, '应存在合成产物');
  assert.equal(fused.tier, 2);
  // 原料不会从线索栏消失。
  assert.equal(clues.filter((c) => c.tier === 1 && !c.fused).length, 2);
});

test('合成受轮次上限约束：第 1 轮不能靠合成越过 2 档', () => {
  const s = enrich(setupFusion());
  s.round = 1;
  for (let i = 0; i < 4; i++) gainClue(s, 'a', 1, false);
  assert.equal(clueTierCap(s, 'a'), 2);
  assert.ok(s.players.a.clues.every((c) => c.tier <= 2));
  for (let i = 0; i < 2; i++) gainClue(s, 'a', 2, false);
  assert.ok(s.players.a.clues.every((c) => c.tier <= 2));
});

test('已消耗的原料不会第二次参与合成，产物会继续往上走', () => {
  const s = enrich(setupFusion());
  s.round = 2;
  gainClue(s, 'a', 1, false);
  gainClue(s, 'a', 1, false);
  assert.equal(s.players.a.clues.filter((c) => c.spent).length, 2);
  gainClue(s, 'a', 1, false);
  gainClue(s, 'a', 1, false);
  const clues = s.players.a.clues;
  // 4 条基础 → 2 条进阶 → 1 条关键，全部连锁完成。
  assert.equal(clues.filter((c) => c.tier === 1).length, 4);
  assert.equal(clues.filter((c) => c.tier === 2).length, 2);
  assert.equal(clues.filter((c) => c.tier === 3).length, 1);
  assert.equal(clues.filter((c) => !c.spent && !c.fused).length, 0);
  // 每条线索最多被消耗一次。
  assert.equal(clues.filter((c) => c.tier === 1).every((c) => c.spent), true);
});

test('合成出来的歌词也不会重复：同一句只出现一次，用尽后不再产出', () => {
  const s = enrich(setupFusion());
  s.round = 4;
  for (const song of s.catalog)
    Object.assign(song, {
      lyricHint: '第一句歌词',
      lyricHints: ['第一句歌词', '第二句歌词', '第三句歌词'],
      previewAvailable: true,
    });
  for (let i = 0; i < 60; i++) gainClue(s, 'a', 3, false);
  const lyrics = s.players.a.clues.filter((c) => c.id.startsWith('lyric-'));
  assert.equal(lyrics.length, 3);
  assert.equal(new Set(lyrics.map((c) => c.value)).size, 3);
  // 合成产物同样占用了那一句，连同原料一起算在「已产出」里。
  assert.ok(lyrics.some((c) => c.fused));
  assert.equal(gainClue(s, 'a', 4, false), false);
});

test('关闭 fusion 时线索只按抽卡结果累积', () => {
  const s = setup();
  s.round = 2;
  gainClue(s, 'a', 1, false);
  gainClue(s, 'a', 1, false);
  assert.equal(s.players.a.clues.length, 2);
  assert.ok(s.players.a.clues.every((c) => !c.spent && !c.fused));
});

test('切歌不再提供任何防守价值', () => {
  let s = setup(['strike'], ['strike']);
  s = play(s, 'strike');
  assert.equal(s.response?.kind, 'attack');
  const before = s.players.b.pressure;
  s = respond(s);
  assert.equal(s.players.b.pressure, before + 20);
  assert.equal(s.players.b.hand.filter((c) => c.cardId === 'strike').length, 1);
});
