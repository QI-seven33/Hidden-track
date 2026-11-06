import { resolveQueuedEvent } from './event-effects';
import {
  newEffects,
  ownTurnStart,
  ownTurnEnd,
  roundStart,
  drawTurn,
  isLocked,
  handLimit,
  nextTurnOf,
  availableGuesses,
} from './passives';
import { updateClock } from './timing';
import { CARD_BY_ID, buildDeck } from '../shared/cards';
import {
  cardViewDefinition,
  cardCost,
  hasFreeGuess,
  guessMissCost,
} from './budget';
import {
  beginStage,
  chooseEvent,
  refreshEvents,
  waitingForEvents,
  isEventRound,
} from './stage-events';
import { SONGS, getSong } from './catalog';
import { isCorrectAnswer, validateAnswer } from './answers';
import { CARD_EFFECTS } from './effects';
import {
  dealDamage,
  addPressure,
  randomIndex,
  applyEnergyLoss,
  consumeCard,
  discardCard,
  gainClue,
  gainStageClue,
  progressionTier,
  heal,
  interceptApLoss,
  otherSide,
  record,
  sideName,
} from './operations';
import { dealOpening, validateOpening, type OpeningOptions } from './opening';
import { DEFAULT_RULES } from '../shared/rules';
import type {
  CardInstance,
  GameAction,
  GameRules,
  GameState,
  GuessAnswer,
  Player,
  Side,
  Song,
  Transition,
} from './types';

export function createGame(
  a: string,
  b: string,
  seed: number,
  overrides: Partial<GameRules> = {},
  catalog: readonly Song[] = SONGS,
  opening: OpeningOptions = { mode: 'random' },
  now = 0,
): GameState {
  if (!catalog.some((c) => c.id === a) || !catalog.some((c) => c.id === b))
    throw new Error('曲目不存在');
  const rules = {
    ...DEFAULT_RULES,
    ...overrides,
    cluePressure: { ...DEFAULT_RULES.cluePressure, ...overrides.cluePressure },
    clueOdds: { ...DEFAULT_RULES.clueOdds, ...overrides.clueOdds },
  };
  validateOpening(opening, rules.initialHand);
  const makePlayer = (side: Side, songId: string): Player => {
    return {
      songId,
      energy: rules.startingEnergy,
      pressure: 0,
      pressureCap: rules.pressureLimit,
      hand: [],
      deck: buildDeck(side),
      discard: [],
      clues: [],
      activeGuessUsed: false,
      turnsStarted: 0,
      attacksUsed: 0,
      attackLimit: 99,
      informationUsed: false,
      playedIds: [],
      maxEnergy: rules.maxEnergy,
      guessesRemaining: 1,
      temporaryGuesses: { count: 0, untilTurn: 0 },
      previewSegments: 0,
      lyricCursor: 0,
      effects: newEffects(),
      seenEvents: [],
      eventHistory: [],
      refreshes: 0,
      repeatNext: 0,
      damageBonus: 0,
      shields: 0,
      extraDraw: 0,
    };
  };
  const s: GameState = {
    schemaVersion: 12,
    catalog: structuredClone(catalog),
    rules,
    round: 1,
    turn: 1,
    firstSide: 'a',
    active: 'a',
    phase: 'playing',
    players: { a: makePlayer('a', a), b: makePlayer('b', b) },
    rng: seed >>> 0,
    events: [],
    nextEventId: 1,
    pending: null,
    response: null,
    forcedSides: [],
    guesses: {},
    outcome: null,
    endingTurn: false,
    queue: [],
    rps: null,
    eventQueue: [],
    nextGeneratedId: 1,
    clock: null,
    stageEvents: {
      stage: 1,
      round: 0,
      freeRefresh: { a: [], b: [] },
      resolved: false,
      drawn: false,
      rarity: 'silver',
      offers: { a: [], b: [] },
      selected: {},
    },
  };
  dealOpening(s, opening);
  startTurn(s);
  updateClock(s, now);
  return s;
}
function startTurn(s: GameState) {
  if (s.active === s.firstSide) {
    // Resolve both event choices before this turn's passives, for either seat.
    if (!isEventRound(s.round)) ownTurnStart(s, s.active);
    roundStart(s);
    beginStage(s);
    if (s.stageEvents.resolved) resume(s);
  } else {
    ownTurnStart(s, s.active);
    drawTurn(s, s.active);
  }
  record(s, {
    kind: 'turn',
    side: s.active,
    title: '第 ' + s.round + ' 轮',
    text: sideName(s.active) + '开始回合。',
  });
  if (s.active !== s.firstSide) resume(s);
}
function finish(
  s: GameState,
  winner: Side | 'draw',
  reason: NonNullable<GameState['outcome']>['reason'],
  text: string,
) {
  s.phase = 'finished';
  s.outcome = { winner, reason, text };
  s.pending = null;
  s.response = null;
  s.rps = null;
  s.queue = [];
  s.eventQueue = [];
  s.endingTurn = false;
  record(s, { kind: 'system', title: '底牌揭晓', text });
}
/** Pressure is the only loss resource. Resolve it before any further player input. */
function settle(s: GameState) {
  if (s.phase !== 'playing') return;
  const forced = (['a', 'b'] as const).filter(
    (p) => s.players[p].pressure >= s.players[p].pressureCap,
  );
  if (forced.length) {
    // 压力到顶是唯一的输法，但「怎么到的顶」五花八门：被攻击、猜错被罚，
    // 或者自己花钱买线索买爆。结算文案必须说清楚，否则玩家只会觉得莫名其妙。
    const burst =
      forced.length === 1 ? s.pressureTally?.[forced[0]!] : undefined;
    // 只有真正把人顶到上限的那一下才算「最后一击」，早就过期的来源不写。
    const cause = burst?.fatal && burst.cause ? burst.cause : undefined;
    finish(
      s,
      forced.length === 2 ? 'draw' : otherSide(forced[0]!),
      'pressureGuess',
      forced.length === 2
        ? '双方压力同时到顶，本局平局。'
        : `${sideName(forced[0]!)}压力到顶${cause ? `（${cause}）` : ''}，对方获胜。`,
    );
    if (s.outcome && cause) s.outcome.cause = cause;
  }
}
function completeEndTurn(s: GameState) {
  settle(s);
  if (s.phase !== 'playing' || s.response || s.pending || s.rps) return;
  ownTurnEnd(s, s.active);
  settle(s);
  if (s.phase !== 'playing') return;
  s.endingTurn = false;
  const roundEnded = s.active !== s.firstSide;
  if (roundEnded && s.rules.maxRounds > 0 && s.round >= s.rules.maxRounds) {
    s.phase = 'finalGuess';
    s.forcedSides = ['a', 'b'];
    s.guesses = {};
    return;
  }
  s.active = otherSide(s.active);
  s.turn++;
  if (roundEnded) s.round++;
  startTurn(s);
}
function resume(s: GameState) {
  settle(s);
  if (s.phase !== 'playing') return;
  let budget = 128;
  while (
    s.phase === 'playing' &&
    !s.response &&
    !s.pending &&
    !s.rps &&
    s.eventQueue.length &&
    budget-- > 0
  ) {
    const e = s.eventQueue.shift()!;
    resolveQueuedEvent(s, e.side, e.eventId, e.depth, e.bonusRarity);
    settle(s);
  }
  if (budget <= 0) throw new Error('事件嵌套超过结算上限');
  if (
    s.phase !== 'playing' ||
    s.eventQueue.length ||
    s.pending ||
    waitingForEvents(s)
  )
    return;
  if (s.stageEvents.resolved && !s.stageEvents.drawn) {
    if (isEventRound(s.round)) ownTurnStart(s, s.firstSide);
    settle(s);
    if (s.phase !== 'playing') return;
    drawTurn(s, s.firstSide);
    s.stageEvents.drawn = true;
  }
  while (s.phase === 'playing' && !s.response && !s.pending && !s.rps) {
    const next = s.queue.shift();
    if (!next) break;
    resolveCard(s, next.side, next.cardId, next.unrespondable);
    settle(s);
  }
  settle(s);
  if (
    s.phase === 'playing' &&
    !s.response &&
    !s.pending &&
    !s.rps &&
    !s.queue.length &&
    s.players[s.active].effects.skipPlay > 0
  ) {
    s.players[s.active].effects.skipPlay--;
    s.endingTurn = true;
    finishHand(s);
  } else if (
    s.endingTurn &&
    s.phase === 'playing' &&
    !s.response &&
    !s.pending &&
    !s.rps
  )
    completeEndTurn(s);
}
function finishHand(s: GameState) {
  const p = s.players[s.active];
  const excess = p.effects.noDiscardPhase
    ? 0
    : p.hand.filter((c) => !c.generated).length - handLimit(s, s.active);
  const discardable = p.hand.filter(
    (c) => !c.generated && !isLocked(s, c),
  ).length;
  const remaining = Math.min(excess, discardable);
  if (remaining > 0)
    s.pending = {
      choiceId: s.nextEventId++,
      kind: 'discardOwn',
      actor: s.active,
      target: s.active,
      remaining,
    };
  else completeEndTurn(s);
}
export function cardUnavailableReason(
  s: GameState,
  side: Side,
  card: CardInstance,
): string | undefined {
  if (s.phase !== 'playing')
    return s.phase === 'finished' ? '对局已结束' : '请先完成猜歌';
  const p = s.players[side],
    def = CARD_BY_ID[card.cardId];
  if (isLocked(s, card)) return '此牌已被事件封锁';
  if (!def || !p.hand.some((c) => c.id === card.id && c.cardId === card.cardId))
    return '卡牌不在手中';
  if (s.response) {
    if (s.response.defender !== side) return '等待对方响应';
    if (s.response.kind === 'attack') {
      if (card.cardId === 'pause') return undefined;
      // 封麦只负责进攻：受击时不能当响应打出。
      return '此时只能使用蓝调';
    }
    return card.cardId === 'rest' ? undefined : '此时只能使用濒死自救牌';
  }
  if (waitingForEvents(s)) return '请等待双方选择阶段事件';
  if (s.pending || s.rps) return '请先完成当前选择';
  if (s.active !== side) return '等待自己的回合';
  if (s.endingTurn) return '本回合出牌阶段已结束';
  if (def.timing !== 'play' && def.timing !== 'rest') return '等待对应响应时机';
  if (p.energy < cardCost(s, side, card.cardId)) return '行动点不足';
  return CARD_EFFECTS[card.cardId].canPlay?.(s, side);
}
function resolveCard(
  s: GameState,
  side: Side,
  cardId: NonNullable<GameState['response']>['cardId'],
  unrespondable = false,
) {
  if (!cardId) return;
  if (CARD_BY_ID[cardId].kind === 'attack') {
    if (unrespondable) {
      dealDamage(s, otherSide(side), 1, side);
      if (s.response?.kind === 'dying') {
        const w = s.response;
        s.response = null;
        applyEnergyLoss(s, w.defender, w.damage, w.attacker, true);
      }
    } else
      s.response = {
        windowId: s.nextEventId++,
        kind: 'attack',
        attacker: side,
        defender: otherSide(side),
        cardId,
        damage: 1,
      };
  } else CARD_EFFECTS[cardId].apply(s, side);
}
function respond(
  s: GameState,
  side: Side,
  instanceId: string | null,
): string | undefined {
  const w = s.response;
  if (!w || w.defender !== side) return '当前无需你响应';
  const card = instanceId
    ? s.players[side].hand.find((c) => c.id === instanceId)
    : undefined;
  if (instanceId && !card) return '响应牌不在手中';
  if (card) {
    const error = cardUnavailableReason(s, side, card);
    if (error) return error;
    const definition = cardViewDefinition(s, side, card.cardId);
    consumeCard(s, side, card.id);
    record(s, {
      kind: 'card',
      side,
      definition,
      cardId: card.cardId,
      responded: true,
      title: CARD_BY_ID[card.cardId].title,
      text: `${sideName(side)}响应《${CARD_BY_ID[card.cardId].title}》。`,
    });
  }
  s.response = null;
  if (w.kind === 'attack') {
    if (card?.cardId === 'pause')
      record(s, {
        kind: 'response',
        side,
        title: '蓝调',
        text: '此次攻击被蓝调抵消。',
      });
    else dealDamage(s, side, w.damage, w.attacker);
    if (card?.cardId === 'pause' && s.players[side].effects.pauseClue)
      gainStageClue(s, side);
  } else {
    applyEnergyLoss(s, side, w.damage, w.attacker, w.isDamage);
    if (card) heal(s, side, 1);
  }
  resume(s);
}
function submitGuess(
  s: GameState,
  side: Side,
  answer: GuessAnswer,
): string | undefined {
  const error = validateAnswer(answer);
  if (error) return error;
  const clean = {
    title: answer.title.trim(),
    ...(answer.artist?.trim() ? { artist: answer.artist.trim() } : {}),
  };
  if (s.phase === 'playing' || !s.forcedSides.includes(side)) {
    const p = s.players[side];
    if (availableGuesses(s, side) <= 0) return '主动猜歌机会已用完';
    const missPressure = guessMissCost(s, side);
    if (hasFreeGuess(s, side)) p.effects.freeGuessUsedRound = s.round;
    else if (p.effects.blindGuesses > 0) p.effects.blindGuesses--;
    else if (
      p.temporaryGuesses.untilTurn >= s.turn &&
      p.temporaryGuesses.count > 0
    )
      p.temporaryGuesses.count--;
    else p.guessesRemaining--;
    p.activeGuessUsed = availableGuesses(s, side) === 0;
    const correct = isCorrectAnswer(
      clean,
      getSong(s.players[otherSide(side)].songId, s.catalog),
    );
    record(s, {
      kind: 'guess',
      side,
      title: '主动猜歌',
      text: `${sideName(side)}猜《${clean.title}》${correct ? '，猜中了。' : '，未中，继续对局。'}`,
      // 双方都要看到「猜了什么、没中」，所以把结果与歌名一起带上。
      ...(correct ? {} : { guessMiss: true, guessTitle: clean.title }),
    });
    if (correct)
      finish(s, side, 'activeGuess', `${sideName(side)}猜中了对手底牌。`);
    else {
      addPressure(s, side, missPressure, `猜歌猜错被罚 ${missPressure} 点压力`);
      settle(s);
    }
    return;
  }
  // 压力到顶已改为直接判负，此分支仅保留给 finalGuess（maxRounds）使用。
  if (!s.forcedSides.includes(side) || s.guesses[side])
    return '当前无需提交或答案已锁定';
  s.guesses[side] = clean;
  if (!s.forcedSides.every((p) => s.guesses[p])) return;
  const correct = s.forcedSides.filter((p) =>
    isCorrectAnswer(
      s.guesses[p]!,
      getSong(s.players[otherSide(p)].songId, s.catalog),
    ),
  );
  const winner =
    s.forcedSides.length === 1
      ? correct.length
        ? side
        : otherSide(side)
      : correct.length === 1
        ? correct[0]!
        : 'draw';
  finish(
    s,
    winner,
    s.phase === 'finalGuess' ? 'finalGuess' : 'pressureGuess',
    winner === 'draw'
      ? '双方猜歌结果相同，本局平局。'
      : `${sideName(winner)}在最终猜歌结算中获胜。`,
  );
}
function applyTransition(current: GameState, action: GameAction): Transition {
  if (current.phase === 'finished')
    return { state: current, error: '对局已结束' };
  if (current.phase !== 'playing' && action.type !== 'guess')
    return { state: current, error: '请先完成最终猜歌' };
  const s: GameState = {
    ...structuredClone({ ...current, catalog: undefined }),
    catalog: current.catalog,
  };
  const side = action.side,
    p = s.players[side],
    fail = (error: string): Transition => ({ state: current, error });
  if (action.type === 'guess') {
    const error = submitGuess(s, side, action.answer);
    return error ? fail(error) : { state: s };
  }
  if (action.type === 'refreshEvents') {
    const error = refreshEvents(s, side, action.eventId);
    return error ? fail(error) : { state: s };
  }
  if (action.type === 'rps') {
    if (!s.rps || s.rps.moves[side]) return fail('当前不能提交或已经锁定猜拳');
    s.rps.moves[side] = action.move;
    const a = s.rps.moves.a,
      b = s.rps.moves.b;
    if (a && b) {
      if (a === b) {
        s.rps.round++;
        s.rps.moves = {};
        record(s, {
          kind: 'system',
          title: '猜拳平局',
          text: '双方猜拳平局，请重新选择。',
        });
      } else {
        const winner: Side =
          { rock: 'scissors', scissors: 'paper', paper: 'rock' }[a] === b
            ? 'a'
            : 'b';
        s.rps = null;
        gainClue(s, winner, progressionTier(s));
        record(s, {
          kind: 'system',
          title: '猜拳结果',
          text: sideName(winner) + '赢得猜拳。',
        });
        resume(s);
      }
    }
    return { state: s };
  }
  if (action.type === 'chooseOption') {
    if (s.pending?.kind !== 'intercept' || s.pending.actor !== side)
      return fail('当前无需你选择');
    if (action.option === 'discard' && !p.hand.some((c) => !isLocked(s, c)))
      return fail('没有手牌可弃，请选择失去行动点');
    s.pending = null;
    if (action.option === 'discard') {
      const options = p.hand.filter((c) => !isLocked(s, c));
      discardCard(s, side, options[randomIndex(s, options.length)]!.id);
    } else interceptApLoss(s, side);
    resume(s);
    return { state: s };
  }
  if (action.type === 'chooseLocks') {
    const c = s.pending;
    if (c?.kind !== 'lock' || c.actor !== side) return fail('当前没有封锁选择');
    if (
      new Set(action.indices).size !== c.remaining ||
      action.indices.some(
        (i) =>
          !Number.isInteger(i) ||
          i < 0 ||
          i >= s.players[c.target].hand.length ||
          isLocked(s, s.players[c.target].hand[i]!),
      )
    )
      return fail('请选择指定数量的不同可封锁手牌');
    for (const i of action.indices)
      s.players[c.target].hand[i]!.lockedUntilTurn =
        nextTurnOf(s, c.target) + 2;
    s.pending = null;
    resume(s);
    return { state: s };
  }
  if (action.type === 'useGrowth') {
    if (
      s.active !== side ||
      s.phase !== 'playing' ||
      waitingForEvents(s) ||
      s.response ||
      s.pending ||
      s.rps ||
      s.endingTurn
    )
      return fail('等待自己的出牌阶段');
    const i = p.effects.growthCards.findIndex(
      (c) => c.id === action.instanceId,
    );
    if (i < 0) return fail('成长能力不存在');
    const c = p.effects.growthCards.splice(i, 1)[0]!,
      level = Math.min(2, s.round - c.round);
    for (let n = 0; n < (level === 1 ? 1 : 2); n++)
      gainClue(s, side, level === 0 ? 1 : 3);
    resume(s);
    return { state: s };
  }
  if (action.type === 'chooseEvent') {
    const error = chooseEvent(s, side, action.eventId);
    if (!error) resume(s);
    return error ? fail(error) : { state: s };
  }
  if (waitingForEvents(s)) return fail('请等待双方选择阶段事件');
  if (action.type === 'respond') {
    const error = respond(s, side, action.instanceId);
    return error ? fail(error) : { state: s };
  }
  if (action.type === 'chooseDiscard') {
    const choice = s.pending;
    if (!choice || choice.kind !== 'discardOwn' || choice.actor !== side)
      return fail('当前没有手牌选择');
    const target = s.players[choice.target];
    const card = target.hand.find((c) => c.id === action.instanceId);
    if (!card || isLocked(s, card) || card.generated)
      return fail('请选择可弃置手牌');
    discardCard(s, side, card.id);
    choice.remaining--;
    if (!choice.remaining) s.pending = null;
    resume(s);
    return { state: s };
  }
  if (
    s.phase !== 'playing' ||
    s.active !== side ||
    s.pending ||
    s.rps ||
    s.response ||
    s.endingTurn
  )
    return fail('当前不能出牌或结束回合');
  if (action.type === 'endTurn') {
    s.endingTurn = true;
    finishHand(s);
    return { state: s };
  }
  const card = p.hand.find((c) => c.id === action.instanceId);
  if (!card) return fail('卡牌不在手中');
  const error = cardUnavailableReason(s, side, card);
  if (error) return fail(error);
  const definition = cardViewDefinition(s, side, card.cardId);
  p.energy -= cardCost(s, side, card.cardId);
  if (card.cardId === 'strike') {
    p.effects.freeFirstAttackUsed = true;
    heal(s, side, p.effects.attackApRefund);
  }
  consumeCard(s, side, card.id);
  p.playedIds.push(card.cardId);
  if (CARD_BY_ID[card.cardId].kind === 'attack') p.attacksUsed++;
  if (CARD_BY_ID[card.cardId].kind === 'information' && !card.generated) {
    if (
      p.effects.freeInformationUntil >= s.turn &&
      !p.effects.freeInformationUsed
    )
      p.effects.freeInformationUsed = true;
    else p.informationUsed = true;
  }
  record(s, {
    kind: 'card',
    side,
    definition,
    cardId: card.cardId,
    title: CARD_BY_ID[card.cardId].title,
    text: `${sideName(side)}打出《${CARD_BY_ID[card.cardId].title}》。`,
  });
  const repeats = card.generated ? 0 : p.repeatNext;
  if (!card.generated) p.repeatNext = 0;
  const unrespondable = p.effects.nextUnrespondableUntil >= s.turn;
  p.effects.nextUnrespondableUntil = 0;
  if (p.effects.discardOnPlay > 0) {
    p.effects.discardOnPlay--;
    const options = p.hand.filter((c) => !isLocked(s, c));
    if (options.length)
      discardCard(s, side, options[randomIndex(s, options.length)]!.id);
  }
  for (let i = 0; i <= repeats; i++)
    s.queue.push({ side, cardId: card.cardId, unrespondable });
  resume(s);
  return { state: s };
}

export function transition(
  current: GameState,
  action: GameAction,
  now = Date.now(),
): Transition {
  const result = applyTransition(current, action);
  if (!result.error) updateClock(result.state, now);
  return result;
}

/** Only the server's local fixture developer endpoint calls this; no new player action. */
export function settleDeveloperChanges(s: GameState) {
  if (s.pending?.kind === 'discardOwn') {
    const p = s.players[s.pending.target];
    s.pending.remaining = Math.min(
      Math.max(
        0,
        p.hand.filter((c) => !c.generated).length -
          handLimit(s, s.pending.target),
      ),
      p.hand.filter((c) => !c.generated && !isLocked(s, c)).length,
    );
    if (!s.pending.remaining) s.pending = null;
  }
  resume(s);
}
