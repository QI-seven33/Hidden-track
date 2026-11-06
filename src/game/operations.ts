import {
  eligibleClues,
  availableClues,
  previewClue,
  clueTierCap,
  cluesExactlyAt,
  rollClueTier,
} from './clues';
import { nextRandom, shuffled } from './random';
import type { Clue, GameEvent, GameState, Side, Tier } from './types';
export const otherSide = (side: Side): Side => (side === 'a' ? 'b' : 'a');
export const sideName = (side: Side) => (side === 'a' ? '玩家一' : '玩家二');
export function record(s: GameState, event: Omit<GameEvent, 'id'>) {
  s.cardsPlayed ??= {
    a: s.events.filter((e) => e.kind === 'card' && e.side === 'a').length,
    b: s.events.filter((e) => e.kind === 'card' && e.side === 'b').length,
  };
  if (event.kind === 'card' && event.side) s.cardsPlayed[event.side]++;
  s.events.push({ ...event, id: s.nextEventId++ });
  if (s.events.length > 400) s.events.splice(0, s.events.length - 400);
}
export function randomIndex(s: GameState, length: number) {
  const [r, next] = nextRandom(s.rng);
  s.rng = next;
  return Math.floor(r * length);
}
export function draw(s: GameState, side: Side, count: number) {
  const p = s.players[side];
  let actual = 0;
  for (let i = 0; i < count; i++) {
    if (!p.deck.length && p.discard.length) {
      [p.deck, s.rng] = shuffled(p.discard, s.rng);
      p.discard = [];
      record(s, {
        kind: 'system',
        side,
        title: '弃牌堆洗回',
        text: `${sideName(side)}的弃牌堆洗回牌库。`,
      });
    }
    const c = p.deck.pop();
    if (c) {
      p.hand.push(c);
      actual++;
    }
  }
  if (actual)
    record(s, {
      kind: 'draw',
      side,
      title: '摸牌',
      amount: actual,
      text: `${sideName(side)}摸了 ${actual} 张牌。`,
    });
}
export function addPressure(
  s: GameState,
  side: Side,
  amount: number,
  cause?: string,
) {
  const p = s.players[side];
  const actual = Math.max(0, Math.min(amount, p.pressureCap - p.pressure));
  p.pressure += actual;
  if (actual)
    record(s, {
      kind: 'pressure',
      side,
      title: '压力增加',
      amount: actual,
      text: `${sideName(side)}压力 +${actual}%。`,
    });
  // 压力是唯一的输法，所以每一次加压都要留下「谁干的」，
  // 结算页才解释得清是被打爆的、猜错罚爆的，还是自己买线索买爆的。
  if (actual && cause) {
    s.pressureTally ??= {};
    s.pressureTally[side] = {
      cause,
      amount: actual,
      turn: s.turn,
      // 这一下正好顶到上限：结算时用它当「最后一击」，跨回合也不会串味。
      fatal: p.pressure >= p.pressureCap,
    };
  }
  tryRescue(s, side);
}
/** All pressure reductions, including rescue, respect the current relief lock. */
export function tryRescue(s: GameState, side: Side) {
  const p = s.players[side];
  if (
    p.effects.rescueAt80 &&
    p.pressure >= 80 &&
    p.effects.noReliefUntil < s.turn
  ) {
    p.effects.rescueAt80 = false;
    p.pressure = Math.min(50, p.pressureCap);
    record(s, {
      kind: 'system',
      side,
      title: '返场',
      text: `${sideName(side)}触发一次返场：压力回到 ${p.pressure}，摸 2 张牌。`,
    });
    draw(s, side, 2);
  }
}
export const progressionTier = (s: GameState): Tier =>
  s.round >= 4 ? 4 : s.round >= 3 ? 3 : s.round >= 2 ? 2 : 1;
/**
 * 歌名中的字是唯一需要现场随机取值的线索：不只给一个字，
 * 还要说清是第几个字，否则「窗」一个字根本无从下手。
 */
function materializeClue(s: GameState, side: Side, clue: Clue): Clue {
  if (clue.id !== 'titleCharacter') return clue;
  const target = s.catalog.find(
    (c) => c.id === s.players[otherSide(side)].songId,
  )!;
  const chars = [...target.title];
  const spots = chars
    .map((char, index) => ({ char, index }))
    .filter((spot) => /[\p{L}\p{N}]/u.test(spot.char));
  if (!spots.length) return clue;
  const spot = spots[randomIndex(s, spots.length)]!;
  const value = `歌名的第 ${spot.index + 1} 个字是「${spot.char}」`;
  return { ...clue, value, text: value };
}
export function gainClue(
  s: GameState,
  side: Side,
  tier: Tier = progressionTier(s),
  withPressure = true,
  requested?: 'lyric' | 'preview',
  capOverride?: Tier,
): boolean {
  let options = eligibleClues(s, side, tier, capOverride);
  const cap = Math.min(capOverride ?? clueTierCap(s, side), 4);
  const target = s.catalog.find(
    (c) => c.id === s.players[otherSide(side)].songId,
  )!;
  if (requested && cap < 4) options = [];
  else if (requested === 'preview') {
    const preview = target.previewAvailable ? previewClue(s, side) : undefined;
    options = preview ? [preview] : [];
  } else if (requested === 'lyric')
    options = availableClues(s, side).filter((c) => c.id.startsWith('lyric-'));
  if (!options.length) {
    record(s, {
      kind: 'system',
      side,
      title: '没有新线索',
      text: `${sideName(side)}未获得新线索：可用资料不足或已获取，不增加线索压力。`,
    });
    return false;
  }
  const choices = options.filter((c) => c.tier === options[0]!.tier);
  const clue = materializeClue(s, side, {
    ...choices[randomIndex(s, choices.length)]!,
  });
  return awardClue(s, side, clue, withPressure, capOverride);
}
/**
 * 掷档取信息。搜索用本回合行，分享用下一回合行（round + 1）。
 * 抽到的档位没有剩余事实时按 clues.ts 的兜底顺序退档，不会给空奖励。
 */
export function gainStageClue(
  s: GameState,
  side: Side,
  withPressure = true,
  rowsAhead: 0 | 1 = 0,
  capOverride?: Tier,
): boolean {
  const tier = rollClueTier(s, side, s.round + rowsAhead, capOverride);
  return gainClue(s, side, tier, withPressure, undefined, capOverride);
}
/**
 * 两条同档信息「生成」一条高一档的信息：原料保留展示、只锁一次，
 * 生成物可以继续参与下一次生成。不额外收费——成本已经在原料里付过。
 */
function fuseOnce(s: GameState, side: Side): boolean {
  const p = s.players[side];
  const cap = Math.min(clueTierCap(s, side), 4) as Tier;
  for (let t = 1; t <= 3; t++) {
    const next = (t + 1) as Tier;
    if (next > cap) continue;
    const materials = p.clues.filter((c) => c.tier === t && !c.spent);
    if (materials.length < 2) continue;
    const pool = cluesExactlyAt(s, side, next, cap);
    if (!pool.length) continue;
    materials[0]!.spent = true;
    materials[1]!.spent = true;
    const clue = materializeClue(s, side, {
      ...pool[randomIndex(s, pool.length)]!,
      fused: true,
    });
    registerClue(s, side, clue);
    p.effects.clueCount++;
    record(s, {
      kind: 'clue',
      side,
      title: '信息生成',
      clue,
      text: `${sideName(side)}用两条${['', '基础', '进阶', '关键', '终极'][t]}信息生成了一条${['', '基础', '进阶', '关键', '终极'][next]}信息。`,
    });
    return true;
  }
  return false;
}
/** 连锁合成：生成物可以继续当原料，因此一次奖励可能连跳两档。 */
export function fuseClues(s: GameState, side: Side) {
  if (!s.rules.fusion) return;
  for (let n = 0; n < 4 && fuseOnce(s, side); n++);
}
/**
 * 线索真正进列表时的记账：歌词推进游标、试听同步已解锁段数。
 * 抽卡与合成都必须走这里，否则合成出来的歌词会让游标停在原地、
 * 下一次又抽到同一句（旧版两条一模一样的「街灯下的橱窗」就是这么来的）。
 */
export function registerClue(s: GameState, side: Side, clue: Clue) {
  const p = s.players[side];
  p.clues.push(clue);
  if (clue.id.startsWith('lyric-')) p.lyricCursor++;
  if (clue.id.startsWith('preview-')) {
    p.previewSegments = 0;
    while (p.clues.some((c) => c.id === 'preview-' + p.previewSegments))
      p.previewSegments++;
  }
}
/** 找到最近一步属于该玩家的出牌标题，用于解释压力来源。 */
export function lastPlayedTitle(s: GameState, side: Side): string {
  for (let i = s.events.length - 1; i >= 0 && i > s.events.length - 6; i--) {
    const e = s.events[i]!;
    if (e.kind === 'card' && e.side === side && !e.responded && e.title)
      return e.title;
  }
  return '';
}
/** All information rewards share pressure, acquisition hooks and redacted feedback. */
export function awardClue(
  s: GameState,
  side: Side,
  clue: Clue,
  withPressure = true,
  capOverride?: Tier,
) {
  const p = s.players[side];
  if (clue.tier > Math.min(capOverride ?? clueTierCap(s, side), 4))
    return false;
  registerClue(s, side, clue);
  const base =
    withPressure && p.effects.freeCluesUntilRound < s.round
      ? s.rules.cluePressure[clue.tier]
      : 0;
  const paid =
    p.effects.freeCluesUntilRound >= s.round
      ? 0
      : base + p.effects.infoPressureTax;
  // 线索压力是自愿支付的成本，也是最常见的「把自己打爆」死法，来源要记清楚。
  addPressure(
    s,
    side,
    paid,
    paid > 0
      ? `为${['', '基础', '进阶', '关键', '终极'][clue.tier]}线索支付 ${paid} 点压力`
      : undefined,
  );
  p.effects.clueCount++;
  if (p.effects.cluesRelief && p.effects.clueCount % 2 === 0)
    reducePressure(s, side, 5 * p.effects.cluesRelief);
  record(s, {
    kind: 'clue',
    side,
    title: '获得线索',
    clue,
    text: `${sideName(side)}获得一条${['', '基础', '进阶', '关键', '终极'][clue.tier]}线索。`,
  });
  fuseClues(s, side);
  return true;
}
export function heal(s: GameState, side: Side, amount: number) {
  const p = s.players[side];
  const actual = Math.max(0, Math.min(amount, p.maxEnergy - p.energy));
  p.energy += actual;
  if (actual)
    record(s, {
      kind: 'heal',
      side,
      title: '回复行动点',
      amount: actual,
      text: `${sideName(side)}回复 ${actual} 点行动点。`,
    });
}
/** AP disruption is separate from pressure damage, and never grants information. */
export function applyEnergyLoss(
  s: GameState,
  side: Side,
  amount: number,
  _attacker?: Side,
  _damage = false,
) {
  const p = s.players[side];
  const actual = Math.max(0, Math.min(amount, p.energy));
  p.energy -= actual;
  if (!actual) return;
  record(s, {
    kind: 'damage',
    side,
    title: '失去行动点',
    amount: actual,
    text: `${sideName(side)}失去 ${actual} 点行动点。`,
  });
}
/** 共鸣只扣当前已备好的行动点，绝不再给下个回合记一笔债。 */
export function interceptApLoss(s: GameState, side: Side) {
  applyEnergyLoss(s, side, 1);
}
export function dealDamage(
  s: GameState,
  side: Side,
  amount: number,
  attacker: Side,
  mul = 1,
) {
  const p = s.players[side],
    a = s.players[attacker];
  if (p.shields > 0) {
    p.shields--;
    record(s, {
      kind: 'response',
      side,
      title: '伤害免疫',
      text: sideName(side) + '免疫了此次伤害。',
    });
    return;
  }
  const total = amount + a.damageBonus;
  a.damageBonus = 0;
  const pressure = Math.max(
    0,
    Math.round(
      s.rules.damagePressure * total * (1 + a.effects.damageMul) * mul,
    ),
  );
  if (pressure > 0) {
    a.effects.damageThisTurn = true;
    const card = lastPlayedTitle(s, attacker);
    addPressure(
      s,
      side,
      pressure,
      `被${card ? `《${card}》` : '攻击'}打中 ${pressure} 点压力`,
    );
    heal(s, attacker, a.effects.damageApRefund);
    if (a.effects.damageClues && p.pressure < p.pressureCap)
      gainClue(s, attacker, 1);
    record(s, {
      kind: 'damage',
      side,
      title: '受到攻击',
      amount: pressure,
      text: `${sideName(side)}受到 ${pressure} 点压力攻击。`,
    });
  }
}
export function discardCard(
  s: GameState,
  side: Side,
  instanceId: string,
): boolean {
  const p = s.players[side],
    index = p.hand.findIndex((c) => c.id === instanceId);
  if (index < 0 || (p.hand[index]!.lockedUntilTurn ?? 0) >= s.turn)
    return false;
  const removed = p.hand.splice(index, 1)[0]!;
  if (!removed.generated) p.discard.push(removed);
  record(s, {
    kind: 'discard',
    side,
    title: '弃牌',
    text: `${sideName(side)}弃置了 1 张牌。`,
  });
  return true;
}
export function consumeCard(s: GameState, side: Side, instanceId: string) {
  const p = s.players[side],
    index = p.hand.findIndex((c) => c.id === instanceId);
  if (index < 0) throw new Error('卡牌不在手中');
  const removed = p.hand.splice(index, 1)[0]!;
  if (!removed.generated) p.discard.push(removed);
}

export function reducePressure(s: GameState, side: Side, amount: number) {
  const p = s.players[side];
  if (p.effects.noReliefUntil >= s.turn) {
    record(s, {
      kind: 'pressure',
      side,
      title: '减压被禁止',
      text: sideName(side) + '当前不能减少压力。',
    });
    return;
  }
  const actual = Math.min(p.pressure, amount);
  p.pressure -= actual;
  if (actual)
    record(s, {
      kind: 'pressure',
      side,
      title: '压力降低',
      amount: -actual,
      text: sideName(side) + '压力 -' + actual + '%。',
    });
}
