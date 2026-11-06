import { availableClues, eligibleClues, clueTierCap } from './clues';
import { STAGE_EVENT_BY_ID, STAGE_EVENTS } from '../shared/stage-events';
import { progressionTier, otherSide } from './operations';
import type { GameState, Side } from './types';
export function eventUnavailable(
  s: GameState,
  side: Side,
  id: string,
  trail: ReadonlySet<string> = new Set(),
): string | undefined {
  if (!STAGE_EVENT_BY_ID[id]) return '此事件不属于 0.7 事件池';
  const p = s.players[side],
    enemy = s.players[otherSide(side)],
    e = p.effects;
  if (p.eventHistory.some((h) => h.id === id)) return '已经获得此事件';
  if (id === 'a1' && s.rules.startingEnergy + e.apBonus >= p.maxEnergy)
    return '回合行动点已达上限';
  if (id === 'a6' && (e.tier3Downgrade || enemy.effects.tier3Downgrade))
    return '静场已经生效';
  if (
    id === 'b4' &&
    (!eligibleClues(s, side, progressionTier(s)).length ||
      !eligibleClues(s, otherSide(side), progressionTier(s)).length)
  )
    return '双方必须都有可用线索';
  if (
    id === 'c1' &&
    p.guessesRemaining + e.blindGuesses === 0 &&
    !e.freeGuessPerRound &&
    p.temporaryGuesses.count === 0
  )
    return '已没有可以减免代价的猜歌机会';
  if (id === 'c4' && s.rules.maxRounds > 0 && s.round >= s.rules.maxRounds)
    return '下一轮无法封锁关键与终极信息';
  if (
    id === 'c5' &&
    (p.clues.filter((c) => c.tier < 4 && !c.spent).length < 2 ||
      clueTierCap(s, side) < 4 ||
      !availableClues(s, side).some((c) => c.tier === 4))
  )
    return '需要两条未消耗的非终极线索及可获得的新终极线索';
  if (id === 'c6' && p.pressureCap < 80) return '压力上限不足 80，无法触发返场';
  if (
    id === 's-fifth-movement' &&
    (s.round >= 5 || (s.rules.maxRounds > 0 && s.rules.maxRounds < 5))
  )
    return '本局已经没有第 5 轮触发时机';
  if (id === 'p-tight-threshold' && enemy.pressureCap <= 85)
    return '对手压力上限已经不高于 85';
  if (id === 'p-pressure-swap') {
    if (p.pressure === enemy.pressure) return '双方压力相同，无需交换';
    if (
      (Math.min(enemy.pressure, p.pressureCap) < p.pressure &&
        e.noReliefUntil >= s.turn) ||
      (Math.min(p.pressure, enemy.pressureCap) < enemy.pressure &&
        enemy.effects.noReliefUntil >= s.turn)
    )
      return '禁止减压期间不能通过交换降低压力';
  }
  if (id === 'g-dice-law' && !eligibleClues(s, side, 1).length)
    return '已经没有可奖励的新线索';
  if (
    id === 's-gold-tune' ||
    id === 'g-prismatic-tune' ||
    id === 'p-harmonic-gift'
  ) {
    if (trail.has(id)) return '随机事件链不能重复同一事件';
    const next = new Set([...trail, id]);
    const rarity =
      id === 's-gold-tune'
        ? 'gold'
        : id === 'g-prismatic-tune'
          ? 'prismatic'
          : undefined;
    if (
      eventPool(s, side, rarity, 0, next).length <
      (id === 'p-harmonic-gift' ? 2 : 1)
    )
      return '没有足够的未出现可用事件';
  }
}
export function eventPool(
  s: GameState,
  side: Side,
  rarity?: string,
  _depth = 0,
  trail: ReadonlySet<string> = new Set(),
) {
  const reserved = s.eventQueue
    .filter((e) => e.side === side)
    .map((e) => e.eventId);
  return STAGE_EVENTS.filter(
    (e) =>
      (!rarity || e.rarity === rarity) &&
      !trail.has(e.id) &&
      !s.players[side].seenEvents.includes(e.id) &&
      !reserved.includes(e.id) &&
      !eventUnavailable(s, side, e.id, trail),
  );
}
