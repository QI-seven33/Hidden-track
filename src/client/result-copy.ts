import type { Outcome, Side } from '../game/types';

export type ResultKind = 'win' | 'loss' | 'draw';

/** 从我的视角看这局是赢、输还是平。 */
export function resultKind(outcome: Outcome, me: Side): ResultKind {
  if (outcome.winner === 'draw') return 'draw';
  return outcome.winner === me ? 'win' : 'loss';
}

/**
 * 结算标题。横幅和结算卡都必须用这一份，否则同一局会先看到一种说法、
 * 翻页后又是另一种说法——文案一旦分两处写，迟早会打架。
 */
export function resultHeadline(outcome: Outcome, me: Side): string {
  const kind = resultKind(outcome, me);
  if (kind === 'draw') return '这一首，留给你';
  if (outcome.reason === 'activeGuess')
    return kind === 'win' ? '你听懂了他藏的歌' : '他听懂了你的歌';
  return kind === 'win' ? '这一局，你赢了' : '下一次，会听懂的';
}

/**
 * 横幅顶上那行小标签：一句话说清「怎么结束的」。
 * 结算页里这件事只能靠 badge 后的一串说明，手机上基本读不到，
 * 所以结束瞬间必须用一行字先交代清楚。
 */
export function resultKicker(outcome: Outcome, me: Side): string {
  const kind = resultKind(outcome, me);
  if (kind === 'draw') return '双方同时到顶';
  const won = kind === 'win';
  switch (outcome.reason) {
    case 'activeGuess':
      return won ? '你猜中了对手的底牌' : '对手猜中了你的底牌';
    case 'finalGuess':
      return won ? '最终猜歌 · 你赢了' : '最终猜歌 · 你输了';
    case 'energy':
      return won ? '对手能量耗尽' : '能量耗尽';
    case 'pressureGuess':
      return won ? '对手压力到顶' : '你的压力到顶';
    default:
      return won ? '对手认输' : '这局结束了';
  }
}

// 与 src/game/operations.ts 的 sideName 保持一致；这里不直接 import 是为了
// 不把整包线索/随机逻辑拖进客户端 bundle。
const SIDE_TOKEN: Record<Side, string> = { a: '玩家一', b: '玩家二' };

/**
 * 服务端的结束文案是第三人称（「玩家二压力到顶，对方获胜。」），
 * 放在横幅里就有两个「对方」互相打架——玩家得先想清楚自己是玩家几。
 * 这里换成第二人称：你 / 对手。只做模板里的固定替换，不改写句子结构。
 */
export function resultNote(outcome: Outcome, me: Side): string {
  // 猜歌结束的原文是「玩家X猜中了对手底牌。」——机械替换会得到
  // 「对手猜中了对手底牌」这种句子，所以这一支单独写。
  if (outcome.reason === 'activeGuess' && outcome.winner !== 'draw')
    return outcome.winner === me ? '你猜中了对手的底牌。' : '对手猜中了你的底牌。';
  const other: Side = me === 'a' ? 'b' : 'a';
  const mineWon = outcome.winner === me;
  return outcome.text
    .replace(SIDE_TOKEN[me], '你')
    .replace(SIDE_TOKEN[other], '对手')
    .replace('对方', mineWon ? '你' : '对手');
}
