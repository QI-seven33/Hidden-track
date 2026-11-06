import type { GameState, PlayerEffects, Side } from './types';
import { CARDS } from '../shared/cards';
import { hasFreeGuess } from './budget';
import {
  draw,
  gainClue,
  randomIndex,
  record,
  reducePressure,
  tryRescue,
} from './operations';
export const newEffects = (): PlayerEffects => ({
  apBonus: 0,
  freeFirstAttack: false,
  freeFirstAttackUsed: false,
  restBonus: 0,
  carryApEnabled: false,
  carryAp: 0,
  handLimitDelta: 0,
  tier3Downgrade: false,
  infoCostDelta: 0,
  infoPressureTax: 0,
  damageApRefund: 0,
  attackApRefund: 0,
  damageMul: 0,
  pauseClue: false,
  guessMissDelta: 0,
  freeGuessPerRound: false,
  freeGuessUsedRound: 0,
  blindGuesses: 0,
  tier3BlockFromRound: 0,
  tier3BlockUntilRound: 0,
  rescueAt80: false,
  noReliefUntil: 0,
  nextUnrespondableUntil: 0,
  turnHandBonusUntil: 0,
  freeInformationUntil: 0,
  freeInformationUsed: false,
  roundFive: 0,
  morphLeft: false,
  damageClues: 0,
  attackBonus: 0,
  regenPressure: 0,
  hideCluesUntilRound: 0,
  cluesRelief: 0,
  clueCount: 0,
  drawPenalty: 0,
  endDamageClueUntil: 0,
  damageThisTurn: false,
  playSecondsPenalty: 0,
  freeCluesUntilRound: 0,
  extraDrawFromRound: 0,
  extraDrawGrantedThisRound: 0,
  skipPlay: 0,
  discardOnPlay: 0,
  growthCards: [],
  roundClues: 0,
  energyGuess: false,
  noDiscardPhase: false,
  slowBreath: false,
  regenAppliedRound: 0,
  dualResonance: false,
});
export const nextTurnOf = (s: GameState, side: Side) =>
  s.active === side ? s.turn : s.turn + 1;
export const handLimit = (s: GameState, side: Side) =>
  Math.max(
    0,
    s.rules.handLimit +
      s.players[side].effects.handLimitDelta +
      (s.players[side].effects.turnHandBonusUntil >= s.turn ? 2 : 0),
  );
export const isLocked = (s: GameState, c: { lockedUntilTurn?: number }) =>
  (c.lockedUntilTurn ?? 0) >= s.turn;
export const availableGuesses = (s: GameState, side: Side) =>
  s.players[side].guessesRemaining +
  s.players[side].effects.blindGuesses +
  (hasFreeGuess(s, side) ? 1 : 0) +
  (s.players[side].temporaryGuesses.untilTurn >= s.turn
    ? s.players[side].temporaryGuesses.count
    : 0);
export function drawTurn(s: GameState, side: Side) {
  const p = s.players[side],
    e = p.effects;
  draw(
    s,
    side,
    Math.max(
      0,
      s.rules.drawPerTurn +
        (p.extraDraw -
          (e.extraDrawFromRound === s.round + 1
            ? e.extraDrawGrantedThisRound
            : 0)) -
        e.drawPenalty,
    ),
  );
  e.drawPenalty = 0;
  if (e.morphLeft && p.hand[0] && !isLocked(s, p.hand[0])) {
    const choices = CARDS.filter((c) => c.id !== p.hand[0]!.cardId);
    p.hand[0].cardId = choices[randomIndex(s, choices.length)]!.id;
    record(s, {
      kind: 'system',
      side,
      title: '手牌变化',
      text: '最左侧手牌已随机变化。',
    });
  }
}
export function ownTurnStart(s: GameState, side: Side) {
  const p = s.players[side],
    e = p.effects;
  tryRescue(s, side);
  if (e.slowBreath && p.turnsStarted > 0 && p.attacksUsed === 0)
    reducePressure(s, side, 5);
  p.attacksUsed = 0;
  p.attackLimit = 99; // Retained only for historical statistics; no quota check.
  p.informationUsed = false;
  p.playedIds = [];
  e.damageThisTurn = false;
  e.freeInformationUsed = false;
  e.freeFirstAttackUsed = false;
  // Energy was readied at our previous turn end. Opponent disruption persists.
  if (e.regenPressure > 0 && e.regenAppliedRound !== s.round) {
    e.regenAppliedRound = s.round;
    reducePressure(s, side, 5);
  }
  if (p.temporaryGuesses.untilTurn < s.turn)
    p.temporaryGuesses = { count: 0, untilTurn: 0 };
  p.turnsStarted++;
}
export function roundStart(s: GameState) {
  for (const side of ['a', 'b'] as const) {
    const p = s.players[side],
      e = p.effects;
    if (s.round === 5 && e.roundFive) {
      for (let i = 0; i < e.roundFive * 2; i++) gainClue(s, side, 3);
      e.roundFive = 0;
    }
    for (let i = 0; i < e.roundClues; i++) gainClue(s, side, 1);
  }
}
export function ownTurnEnd(s: GameState, side: Side) {
  const p = s.players[side],
    e = p.effects;
  e.carryAp = e.carryApEnabled
    ? Math.min(1, Math.floor(s.players[side].energy / 2))
    : 0;
  if (e.endDamageClueUntil >= s.turn && !e.damageThisTurn) gainClue(s, side, 2);
  p.energy = Math.max(
    0,
    Math.min(p.maxEnergy, s.rules.startingEnergy + e.apBonus + e.carryAp),
  );
  e.carryAp = 0;
}

export function playerStatuses(s: GameState, side: Side) {
  const e = s.players[side].effects;
  return [
    ...(e.apBonus ? [`每回合行动点 +${e.apBonus}`] : []),
    ...(e.freeFirstAttack
      ? [e.freeFirstAttackUsed ? '本回合免费攻击已用' : '本回合首张攻击免费']
      : []),
    ...(e.restBonus ? [`和声额外回复 ${e.restBonus} 行动点`] : []),
    ...(e.carryApEnabled ? ['结束回合余下至少 2 行动点，下回合 +1'] : []),
    ...(e.handLimitDelta ? [`手牌上限 ${e.handLimitDelta}`] : []),
    ...(s.players.a.effects.tier3Downgrade || s.players.b.effects.tier3Downgrade
      ? ['双方终极信息降为关键，不向终极补位']
      : []),
    ...(e.infoCostDelta
      ? ['引子、升 Key、猜先费用 -1；每条信息额外 +1 压力']
      : []),
    ...(e.damageApRefund ? ['攻击命中回复 1 行动点'] : []),
    ...(e.attackApRefund
      ? ['攻击压力 -15%（四舍五入）；每次出攻击牌回复 1 行动点']
      : []),
    ...(e.pauseClue
      ? ['蓝调成功抵消攻击后获得本阶段线索，并支付线索压力']
      : []),
    ...(e.freeGuessPerRound
      ? [
          hasFreeGuess(s, side)
            ? '本轮有 1 次免费猜歌（仍承担猜错压力）'
            : '本轮免费猜歌已用',
        ]
      : []),
    ...(e.guessMissDelta
      ? [
          `普通猜错压力调整 ${e.guessMissDelta > 0 ? '+' : ''}${e.guessMissDelta}`,
        ]
      : []),
    ...(e.blindGuesses ? ['盲赌剩余 1 次，猜错总计 +25 压力'] : []),
    ...(e.tier3BlockUntilRound >= s.round && e.tier3BlockUntilRound > 0
      ? [`第 ${e.tier3BlockFromRound} 轮不能获得关键及终极信息`]
      : []),
    ...(e.rescueAt80 ? ['返场待触发：压力达到 80 回到 50，并摸 2 张'] : []),
    ...(e.noReliefUntil >= s.turn ? ['当前禁止减压'] : []),
    ...(e.nextUnrespondableUntil >= s.turn
      ? ['本回合下一张主动牌不可响应']
      : []),
    ...(e.turnHandBonusUntil >= s.turn ? ['本回合手牌上限 +2'] : []),
    ...(e.freeInformationUntil >= s.turn && !e.freeInformationUsed
      ? ['本回合首张信息牌不占次数']
      : []),
    ...(e.roundFive ? ['第5轮获得关键线索'] : []),
    ...(e.morphLeft ? ['每回合摸牌后变化最左手牌'] : []),
    ...(e.damageClues ? ['造成伤害后获得基础线索'] : []),
    ...(e.attackBonus ? ['每回合两次攻击'] : []),
    ...(e.regenPressure ? ['每个自己的回合减压 5，同轮不重复'] : []),
    ...(e.slowBreath ? ['上个自己的回合未出攻击牌，本回合开始减压 5'] : []),
    ...(e.dualResonance ? ['共鸣同时随机弃牌并扣减行动点'] : []),
    ...(e.hideCluesUntilRound >= s.round
      ? ['线索隐藏至第' + e.hideCluesUntilRound + '轮结束']
      : []),
    ...(e.cluesRelief ? ['每两条线索减压' + 5 * e.cluesRelief + '%'] : []),
    ...(e.drawPenalty ? ['下回合摸牌 -' + e.drawPenalty] : []),
    ...(e.playSecondsPenalty
      ? ['出牌时间 -' + e.playSecondsPenalty + '秒（最低10秒）']
      : []),
    ...(e.freeCluesUntilRound >= s.round ? ['本轮信息免压力'] : []),
    ...(e.skipPlay ? ['待跳过出牌阶段 ×' + e.skipPlay] : []),
    ...(e.discardOnPlay ? ['未来' + e.discardOnPlay + '次用牌后随机弃牌'] : []),
    ...(e.roundClues ? ['每轮获得基础信息'] : []),
    ...(e.energyGuess ? ['每损失一点能量获得一次猜歌机会'] : []),
  ];
}
