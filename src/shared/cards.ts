import type { CardDefinition, CardId, CardInstance, Side } from '../game/types';
export const CARD_KINDS = {
  attack: { label: '攻击', symbol: 'ATK' },
  defense: { label: '响应', symbol: 'RES' },
  information: { label: '信息', symbol: 'INF' },
  special: { label: '功能', symbol: 'ACT' },
};
const card = (
  id: CardId,
  title: string,
  kind: CardDefinition['kind'],
  timing: CardDefinition['timing'],
  copies: number,
  cost: number,
  short: string,
  description = short,
): CardDefinition => ({
  id,
  title,
  kind,
  timing,
  copies,
  cost,
  short,
  description,
  tag: '基础',
  art: 0,
});
/** Provisional content configuration; adding cards does not require a loadout system. */
export const CARDS: readonly CardDefinition[] = [
  card(
    'strike',
    '封麦',
    'attack',
    'play',
    5,
    1,
    '使对手压力 +20',
    '命中使对手压力 +20。只能主动打出，受击时不能当响应牌；攻击不获得线索。',
  ),
  card(
    'rest',
    '和声',
    'defense',
    'rest',
    2,
    0,
    '回复 1 点行动点',
    '自己出牌阶段免费使用，回复 1 点行动点，不超过上限。行动点已满时不可使用。',
  ),
  card(
    'breathe',
    '奏鸣',
    'special',
    'play',
    2,
    1,
    '自身压力 -20',
    '自身压力 −20。压力为 0 或禁止减压时不可使用。',
  ),
  card('pause', '蓝调', 'defense', 'attackResponse', 2, 0, '抵消此次攻击'),
  card(
    'information',
    '引子',
    'information',
    'play',
    2,
    1,
    '按本阶段概率抽 1 条线索',
    '按本轮概率抽 1 条线索：基础/进阶/关键，第 4 轮起含终极。按抽到档位支付 6/11/16/20 压力；该档无剩余资料时顺延相邻档。不限制每回合使用次数。',
  ),
  card(
    'intercept',
    '共鸣',
    'special',
    'play',
    2,
    1,
    '对手弃 1 张，或失去 1 行动点',
    '对手二选一：随机弃 1 张手牌，或失去 1 点当前行动点。无可弃手牌时直接扣行动点。行动点最低为 0，不记入下一回合重复扣除。',
  ),
  card('drawOne', '进拍', 'special', 'play', 2, 0, '摸 1 张牌'),
  card(
    'probe',
    '升 Key',
    'information',
    'play',
    2,
    2,
    '用下一轮的概率抽 1 条线索',
    '按下一轮概率抽 1 条线索，档位上限比本阶段高 1 级，第 3 轮起可出终极。按实际档位支付压力，额外 +5 压力。',
  ),
  card(
    'rps',
    '猜先',
    'information',
    'play',
    2,
    1,
    '猜拳赢家获得本阶段确定线索',
    '双方秘密出石头/剪刀/布，平局重猜。赢家获得 1 条本阶段固定档位线索（不掷档位），并支付对应压力。',
  ),
];
export const CARD_BY_ID = Object.fromEntries(
  CARDS.map((c) => [c.id, c]),
) as Record<CardId, CardDefinition>;
export function buildDeck(side: Side): CardInstance[] {
  return CARDS.flatMap((c) =>
    Array.from({ length: c.copies }, (_, i) => ({
      id: side + '-' + c.id + '-' + i,
      cardId: c.id,
    })),
  );
}
