import type { Rarity } from '../shared/stage-events';
import { progressionTier, record } from './operations';
import { shuffled } from './random';
import { eventPool } from './event-eligibility';
import type { GameState, Side } from './types';
export const isEventRound = (round: number) => [1, 3, 4].includes(round);
function roll(s: GameState, side: Side, rarity: Rarity, count = 3) {
  let pool = eventPool(s, side, rarity).map((e) => e.id);
  [pool, s.rng] = shuffled(pool, s.rng);
  const picked = pool.slice(0, count);
  s.players[side].seenEvents.push(...picked);
  return picked;
}
function ready(s: GameState) {
  if ((['a', 'b'] as const).every((side) => !!s.stageEvents.selected[side])) {
    for (const side of [
      s.firstSide,
      s.firstSide === 'a' ? 'b' : 'a',
    ] as Side[]) {
      const eventId = s.stageEvents.selected[side]!;
      if (eventId !== 'skip') s.eventQueue.push({ side, eventId, depth: 0 });
    }
    s.stageEvents.resolved = true;
  }
}
export function beginStage(s: GameState) {
  if (s.stageEvents.round === s.round) return;
  const node = [1, 3, 4].indexOf(s.round);
  if (node < 0) {
    s.stageEvents = {
      stage: progressionTier(s),
      round: s.round,
      freeRefresh: { a: [], b: [] },
      rarity: 'silver',
      offers: { a: [], b: [] },
      selected: { a: 'skip', b: 'skip' },
      resolved: true,
      drawn: false,
    };
    return;
  }
  const rarity = (['silver', 'gold', 'prismatic'] as const)[node]!;
  const offers = { a: roll(s, 'a', rarity), b: roll(s, 'b', rarity) };
  s.stageEvents = {
    stage: progressionTier(s),
    round: s.round,
    freeRefresh: {
      a: offers.a.map(() => 1),
      b: offers.b.map(() => 1),
    },
    rarity,
    offers,
    selected: {},
    resolved: false,
    drawn: false,
  };
  for (const side of ['a', 'b'] as const)
    if (!s.stageEvents.offers[side].length) {
      s.stageEvents.selected[side] = 'skip';
      record(s, {
        kind: 'system',
        side,
        title: '事件池耗尽',
        text:
          (side === 'a' ? '玩家一' : '玩家二') +
          '本轮没有符合条件且未出现的同色事件，自动跳过。',
      });
    }
  record(s, {
    kind: 'system',
    title: '阶段事件',
    text: '双方选择一个事件；每张选项各有一次免费刷新。',
  });
  ready(s);
}
export function waitingForEvents(s: GameState) {
  return (
    !s.stageEvents.resolved &&
    (['a', 'b'] as const).some((p) => !s.stageEvents.selected[p])
  );
}
export function chooseEvent(
  s: GameState,
  side: Side,
  eventId: string,
): string | undefined {
  if (
    s.phase !== 'playing' ||
    s.stageEvents.resolved ||
    s.stageEvents.selected[side] ||
    !s.stageEvents.offers[side].includes(eventId)
  )
    return '请选择本轮有效事件';
  s.stageEvents.selected[side] = eventId;
  ready(s);
}
export function canRefreshEvent(s: GameState, side: Side, eventId: string) {
  const index = s.stageEvents.offers[side].indexOf(eventId);
  return (
    s.phase === 'playing' &&
    waitingForEvents(s) &&
    !s.stageEvents.selected[side] &&
    index >= 0 &&
    (s.stageEvents.freeRefresh[side][index]! > 0 ||
      s.players[side].refreshes > 0) &&
    eventPool(s, side, s.stageEvents.rarity).length > 0
  );
}
export function refreshEvents(
  s: GameState,
  side: Side,
  eventId: string,
): string | undefined {
  if (!canRefreshEvent(s, side, eventId))
    return '此选项无法刷新：次数不足或同色可用事件已耗尽';
  const i = s.stageEvents.offers[side].indexOf(eventId);
  const replacement = roll(s, side, s.stageEvents.rarity, 1)[0]!;
  if (s.stageEvents.freeRefresh[side][i]! > 0)
    s.stageEvents.freeRefresh[side][i]!--;
  else s.players[side].refreshes--;
  s.stageEvents.offers[side][i] = replacement;
  record(s, {
    kind: 'system',
    side,
    title: '刷新事件',
    text: (side === 'a' ? '玩家一' : '玩家二') + '刷新了一个事件选项。',
  });
}
