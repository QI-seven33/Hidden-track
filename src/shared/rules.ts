import type { ClueOdds, GameRules } from '../game/types';
/**
 * 信息品质抽卡表（单位 %，每行合计 100）。
 *
 * 参照《云顶之弈》/《金铲铲之战》的商店等级概率，把 5 个费用档压成 4 个信息档
 * （4 费与 5 费合并为「终极」），回合对应等级：
 *
 * | 回合 | 对应等级 | 原始概率 1/2/3/4/5 费 | 本表 基础/进阶/关键/终极 |
 * |---|---|---|---|
 * | 第 1 轮 | 4 级 | 55 / 30 / 15 / 0 / 0 | 55 / 30 / 15 / 0 |
 * | 第 2 轮 | 6 级 | 35 / 35 / 25 / 5 / 0 | 35 / 35 / 25 / 5 |
 * | 第 3 轮 | 8 级 | 15 / 25 / 35 / 20 / 5 | 15 / 25 / 35 / 25 |
 * | 第 4 轮 | 9 级 | 10 / 20 / 25 / 35 / 10 | 10 / 20 / 25 / 45 |
 *
 * 为什么照抄这张表而不是自己拍：
 * 1. 它天然满足「越往后越容易出高档、但任何一档都不会 100%」——正是要拿掉的确定性；
 * 2. 它的档位峰值会移动（银卡在 7–8 级最高、金卡在 9 级最高），对应我们要的
 *    「关键档在第 3 轮最密、终极档只在第 4 轮过半」，而不是全线单调上涨；
 * 3. 玩家对这套曲线有肌肉记忆，看到概率会本能地判断「现在该不该 D」。
 *
 * 分享用「下一回合行」，即提前一级商店；上限仍受轮次阶梯约束，
 * 因此第 1 轮分享拿到的是 6 级表（35/35/25/5）但被 2 档上限截断。
 */
export const DEFAULT_CLUE_ODDS: ClueOdds = {
  1: [55, 30, 15, 0],
  2: [35, 35, 25, 5],
  3: [15, 25, 35, 25],
  4: [10, 20, 25, 45],
};
/** Draft defaults. 0 rounds means no automatic final guess. */
export const DEFAULT_RULES: GameRules = {
  maxRounds: 0,
  maxEnergy: 5,
  startingEnergy: 3,
  initialHand: 4,
  drawPerTurn: 2,
  handLimit: 4,
  pressureLimit: 100,
  damagePressure: 20,
  guessMissPressure: 25,
  cluePressure: { 1: 6, 2: 11, 3: 16, 4: 20 },
  clueOdds: DEFAULT_CLUE_ODDS,
  fusion: true,
};
