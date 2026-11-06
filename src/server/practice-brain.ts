import { randomInt } from 'node:crypto';
import { FACT_TEMPLATES } from '../game/clues';
import { usableFact } from '../game/evidence';
import { availableGuesses } from '../game/passives';
import { guessMissCost } from '../game/budget';
import type { Clue, GameState, Side, Song } from '../game/types';
import type { PlayerAction } from '../shared/protocol';

/**
 * 人机练习里电脑的「猜歌脑子」。
 *
 * 设计目标是**故意笨**：练习模式要留出体验空间，电脑不该是个解题器。
 * 实测（300 局机器人对打，第 4 轮取样）证明「用全部线索」的命中率是 94%，
 * 等于给电脑装了答案；所以这里刻意只让它记住第一条线索：
 *
 * | 它用的线索条数 | 第 4 轮平均候选 | 均匀乱猜的命中率 |
 * |---|---|---|
 * | 1 条 | 5.3 首 | 41% |
 * | 2 条 | 2.8 首 | 69% |
 * | 全部 | 1.3 首 | 94% |
 *
 * 调手感时只动这三个常量：`GUESS_MIN_ROUND`（几轮才想起来）、
 * `GUESS_CLUE_LIMIT`（记性有多好）、`GUESS_PRESSURE_FLOOR`（快到顶就不赌）。
 *
 * 它始终只用自己已经拿到的线索，从不读对手底牌。
 */
export const GUESS_MIN_ROUND = 4;
export const GUESS_CLUE_LIMIT = 1;
/** 猜错要付 25 点压力；自己压力到这条线以上就不赌了，免得自杀式送人头。 */
export const GUESS_PRESSURE_FLOOR = 75;

const isDeaf = (id: string) =>
  id.startsWith('lyric-') || id.startsWith('preview-');

/** 与 clues.ts 的 availableClues 保持同一套取值口径，避免两边算法漂移。 */
function clueValueFor(song: Song, id: string): string | undefined {
  const template = FACT_TEMPLATES.find((f) => f.id === id);
  if (!template) return undefined;
  const fact =
    song.evidence && template.field
      ? usableFact(song.evidence, template.field)
      : undefined;
  if (song.evidence && !fact) return undefined;
  return template.value(
    fact && template.field ? { ...song, [template.field]: fact.value } : song,
  );
}

/** 这条线索是否仍然指向这首歌；算不出值的线索一律当作「不能用它排除」。 */
function stillHolds(song: Song, clue: Clue): boolean {
  if (isDeaf(clue.id)) return true;
  if (clue.id === 'titleCharacter') {
    const hit = /歌名的第 (\d+) 个字是「(.+?)」/.exec(clue.value);
    return hit ? [...song.title][Number(hit[1]) - 1] === hit[2] : true;
  }
  const value = clueValueFor(song, clue.id);
  return value === undefined || value === clue.value;
}

/**
 * 电脑按「自己还记得的那几条线索」筛出来的候选池。
 * 只取最早拿到的 `clueLimit` 条：后面的它听过就忘了，这正是它猜不准的原因。
 */
export function guessCandidates(
  game: GameState,
  side: Side,
  clueLimit = GUESS_CLUE_LIMIT,
): Song[] {
  const clues = game.players[side].clues.slice(0, Math.max(0, clueLimit));
  if (!clues.length) return [];
  return game.catalog.filter((song) => clues.every((c) => stillHolds(song, c)));
}

export function botGuess(
  game: GameState,
  side: Side,
): PlayerAction | undefined {
  if (game.phase !== 'playing' || game.active !== side) return;
  if (game.round < GUESS_MIN_ROUND) return;
  const p = game.players[side];
  // 只花自己那份永久猜歌机会；海克斯给的临时次数它也想不到要用。
  if (p.guessesRemaining <= 0 || availableGuesses(game, side) <= 0) return;
  const miss = guessMissCost(game, side);
  if (p.pressure >= GUESS_PRESSURE_FLOOR || p.pressure + miss >= p.pressureCap)
    return;
  const candidates = guessCandidates(game, side);
  if (!candidates.length) return;
  // 不看哪首最像，等概率挑一首：这就是「赌」。
  return {
    type: 'guess',
    answer: { title: candidates[randomInt(candidates.length)]!.title },
  };
}
