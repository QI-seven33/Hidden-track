import assert from 'node:assert/strict';
import { cardCost } from '../src/game/budget';
import { SONGS } from '../src/game/catalog';
import {
  cardUnavailableReason,
  createGame,
  transition,
} from '../src/game/engine';
import { availableGuesses, isLocked } from '../src/game/passives';
import { nextRandom } from '../src/game/random';
import { waitingForEvents } from '../src/game/stage-events';
import { timeoutAction } from '../src/game/timing';
import type { CardId, GameAction, GameRules, Side } from '../src/game/types';

// Recognition probabilities below are strategy assumptions, not fitted human data.
// Only this harness's recognition oracle can see the target title, after recognition.
export interface SimOptions {
  /** 出牌权重覆盖：用来比较「只打人」和「只找线索」两条路线。 */
  weights?: Partial<Record<CardId, number>>;
}
export function simulate(
  seed: number,
  familiarity: number,
  limit = 0,
  overrides: Partial<GameRules> = {},
  opts: SimOptions = {},
) {
  const catalog = SONGS.slice(0, 2).map((song) => ({
    ...song,
    genre: '模拟流派',
    artistGender: '1 男',
    duration: 240,
    lyricHint: '模拟歌词，不是真实上游结果',
    lyricHints: ['模拟歌词，不是真实上游结果'],
    previewAvailable: true,
  }));
  let s = createGame(
    catalog[0]!.id,
    catalog[1]!.id,
    seed,
    { maxRounds: limit, ...overrides },
    catalog,
  );
  let rng = (seed ^ 0x77777777) >>> 0,
    steps = 0,
    cards = 0,
    fusions = 0,
    strikeDefenses = 0;
  // 0.8 评估用的观测计数：不改变任何规则行为，只记录实际用牌。
  const plays: Record<string, number> = {};
  // 压力来源归因：每次动作前后对比压力差，按动作类型归类。只用于统计，不参与规则。
  const pressureBy = { attack: 0, clue: 0, guess: 0, other: 0 };
  let pauseResponses = 0,
    unblockedHits = 0;
  const tier4Round: Record<Side, number | null> = { a: null, b: null };
  const known = { a: new Set<string>(), b: new Set<string>() },
    recognized = { a: false, b: false };
  const choices = new Set<number>(),
    turns = new Set<number>(),
    eventIds = new Set<string>(),
    eventsBySide: Record<Side, string[]> = { a: [], b: [] };
  const random = () => {
    const [r, n] = nextRandom(rng);
    rng = n;
    return r;
  };
  const pick = <T>(values: T[]) =>
    values[Math.floor(random() * values.length)]!;
  function action(): GameAction {
    if (s.phase !== 'playing') return timeoutAction(s)!;
    for (const side of ['a', 'b'] as const)
      for (const clue of s.players[side].clues) {
        if (known[side].has(clue.id)) continue;
        known[side].add(clue.id);
        const p =
          clue.tier === 4
            ? familiarity
            : clue.tier === 3
              ? familiarity * 0.3
              : clue.tier === 2
                ? familiarity * 0.09
                : familiarity * 0.006;
        if (random() < p) recognized[side] = true;
      }
    const solvers = (['a', 'b'] as const).filter(
      (side) => recognized[side] && availableGuesses(s, side) > 0,
    );
    if (solvers.length) {
      const side = pick(solvers);
      return {
        type: 'guess',
        side,
        answer: {
          title: catalog.find(
            (c) => c.id === s.players[side === 'a' ? 'b' : 'a'].songId,
          )!.title,
        },
      };
    }
    if (waitingForEvents(s)) {
      const side = pick(
        (['a', 'b'] as const).filter((side) => !s.stageEvents.selected[side]),
      );
      return {
        type: 'chooseEvent',
        side,
        eventId: pick(s.stageEvents.offers[side]),
      };
    }
    if (s.rps) {
      const side = s.rps.moves.a ? 'b' : 'a';
      return {
        type: 'rps',
        side,
        move: pick(['rock', 'paper', 'scissors'] as const as (
          'rock' | 'paper' | 'scissors'
        )[]),
      };
    }
    if (s.response) {
      const side = s.response.defender;
      const hand = s.players[side].hand;
      const usable = (c: (typeof hand)[number]) =>
        !cardUnavailableReason(s, side, c);
      // 切歌只能进攻，唯一响应是暂停（免费且全抵消），见到就用。
      const pause = hand.find((c) => c.cardId === 'pause' && usable(c));
      if (pause) return { type: 'respond', side, instanceId: pause.id };
      return { type: 'respond', side, instanceId: null };
    }
    if (s.pending) {
      const side = s.pending.actor;
      if (s.pending.kind === 'intercept')
        return {
          type: 'chooseOption',
          side,
          option:
            s.players[side].hand.some((c) => !isLocked(s, c)) && random() < 0.6
              ? 'discard'
              : 'damage',
        };
      return timeoutAction(s)!;
    }
    const side = s.active,
      p = s.players[side];
    turns.add(s.turn);
    // '有取舍' means a useful card currently costs more AP than available, not proof of fun.
    if (
      p.hand.some(
        (c) =>
          cardCost(s, side, c.cardId) > p.energy &&
          c.cardId !== 'pause' &&
          (c.cardId !== 'breathe' || p.pressure > 0),
      )
    )
      choices.add(s.turn);
    const legal = p.hand.filter((c) => !cardUnavailableReason(s, side, c));
    if (!legal.length) return { type: 'endTurn', side };
    const weights: Record<string, number> = {
      strike: 8,
      rest: 5,
      breathe: p.pressure >= 40 ? 11 : 3,
      information: 7,
      probe: 6,
      rps: 2,
      intercept: 4,
      drawOne: 5,
      ...opts.weights,
    };
    const scored = legal
      .map((card) => ({ card, value: weights[card.cardId]! + random() * 6 }))
      .sort((a, b) => b.value - a.value);
    return { type: 'playCard', side, instanceId: scored[0]!.card.id };
  }
  // 0.8：合成已经是引擎内自动结算，模拟器只统计次数，不再手工触发。
  const countFusions = () => {
    for (const side of ['a', 'b'] as const) {
      const n = s.players[side].clues.filter((c) => c.fused).length;
      fusions = Math.max(fusions, n);
    }
  };
  // 已出牌在 transition 之后就找不到了，所以按「动作前的手牌」判断这张牌是什么。
  let pendingCard: { id: string; cardId: CardId } | undefined;
  function cardSource(instanceId: string): keyof typeof pressureBy {
    const c = pendingCard?.id === instanceId ? pendingCard : undefined;
    if (!c) return 'other';
    if (c.cardId === 'strike') return 'attack';
    if (
      c.cardId === 'information' ||
      c.cardId === 'probe' ||
      c.cardId === 'rps'
    )
      return 'clue';
    return 'other';
  }
  while (s.phase !== 'finished' && steps < 2500) {
    const a = action();
    assert.ok(a, `missing action seed=${seed}`);
    pendingCard =
      a.type === 'playCard'
        ? s.players[a.side].hand.find((c) => c.id === a.instanceId)
        : undefined;
    if (a.type === 'playCard') {
      const c = s.players[a.side].hand.find((x) => x.id === a.instanceId);
      if (c) plays[c.cardId] = (plays[c.cardId] ?? 0) + 1;
    }
    if (a.type === 'respond') {
      const c = a.instanceId
        ? s.players[a.side].hand.find((x) => x.id === a.instanceId)
        : undefined;
      if (c?.cardId === 'pause') pauseResponses++;
      if (!c && s.response?.kind === 'attack') unblockedHits++;
    }
    const before = { a: s.players.a.pressure, b: s.players.b.pressure };
    const attackWindow = s.response?.kind === 'attack';
    const r = transition(s, a, steps * 100 + 1000);
    assert.equal(
      r.error,
      undefined,
      `seed=${seed} step=${steps} action=${a.type}`,
    );
    s = r.state;
    steps++;
    {
      const da = s.players.a.pressure - before.a,
        db = s.players.b.pressure - before.b;
      // 攻击的伤害在响应窗口才结算，所以响应动作产生的压力也归到攻击线上。
      const source =
        a.type === 'playCard'
          ? cardSource(a.instanceId)
          : a.type === 'respond'
            ? attackWindow
              ? ('attack' as const)
              : ('other' as const)
            : a.type === 'guess'
              ? ('guess' as const)
              : a.type === 'rps' || a.type === 'chooseEvent'
                ? ('clue' as const)
                : ('other' as const);
      pressureBy[source] += Math.max(0, da) + Math.max(0, db);
    }
    countFusions();
    if (a.type === 'playCard') cards++;
    assert.notEqual(s.phase, 'forcedGuess', `seed=${seed}`);
    for (const side of ['a', 'b'] as const) {
      const p = s.players[side],
        all = [...p.hand, ...p.deck, ...p.discard].filter((c) => !c.generated);
      assert.equal(all.length, 21, `card conservation seed=${seed}`);
      assert.equal(new Set(all.map((c) => c.id)).size, 21);
      assert.ok(
        Number.isInteger(p.energy) && p.energy >= 0 && p.energy <= p.maxEnergy,
      );
      assert.ok(
        Number.isInteger(p.pressure) &&
          p.pressure >= 0 &&
          p.pressure <= p.pressureCap,
      );
      assert.ok(p.guessesRemaining >= 0 && p.effects.blindGuesses >= 0);
      assert.equal(
        new Set(p.eventHistory.map((e) => e.id)).size,
        p.eventHistory.length,
      );
      for (const e of p.eventHistory) {
        assert.ok([1, 3, 4].includes(e.round));
        eventIds.add(e.id);
      }
      eventsBySide[side] = p.eventHistory.map((e) => e.id);
      if (tier4Round[side] === null && p.clues.some((c) => c.tier === 4))
        tier4Round[side] = s.round;
      if (s.round === 1) assert.ok(p.clues.every((c) => c.tier < 3));
      // 终极信息：搜索自第 4 轮起，分享自第 3 轮起可换到，第 2 轮前绝不可能。
      if (s.round <= 2) assert.ok(p.clues.every((c) => c.tier < 4));
    }
    if (s.phase === 'finished') {
      assert.ok(s.outcome);
      assert.equal(s.clock, null);
      assert.equal(s.response, null);
      assert.equal(s.pending, null);
    }
  }
  assert.equal(
    s.phase,
    'finished',
    `nonterminating seed=${seed}, round=${s.round}, steps=${steps}`,
  );
  return {
    seed,
    round: s.round,
    steps,
    cards,
    winner: s.outcome!.winner,
    reason: s.outcome!.reason,
    decisionTurns: choices.size,
    totalTurns: turns.size,
    fusions,
    strikeDefenses,
    plays,
    pauseResponses,
    unblockedHits,
    tier4Round,
    pressureBy,
    eventIds: [...eventIds],
    eventsBySide,
  };
}
