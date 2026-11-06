import { eventPool, eventUnavailable } from './event-eligibility';
import { STAGE_EVENT_BY_ID } from '../shared/stage-events';
import {
  addPressure,
  gainClue,
  gainStageClue,
  heal,
  otherSide,
  randomIndex,
  record,
  reducePressure,
} from './operations';
import { nextTurnOf } from './passives';
import type { GameState, Side } from './types';
export function resolveEvent(s: GameState, side: Side, id: string, depth = 0) {
  if (eventUnavailable(s, side, id)) return;
  const p = s.players[side],
    target = otherSide(side),
    e = p.effects;
  if (!p.seenEvents.includes(id)) p.seenEvents.push(id);
  p.eventHistory.push({
    id,
    round: s.round,
    origin: depth ? 'bonus' : 'choice',
  });
  record(s, {
    kind: 'system',
    side,
    title: '事件结算',
    text: `${side === 'a' ? '玩家一' : '玩家二'}：${STAGE_EVENT_BY_ID[id]!.title} · ${STAGE_EVENT_BY_ID[id]!.description}`,
  });
  switch (id) {
    case 's-gold-tune':
    case 'g-prismatic-tune':
    case 'p-harmonic-gift': {
      const bonusRarity =
        id === 's-gold-tune'
          ? 'gold'
          : id === 'g-prismatic-tune'
            ? 'prismatic'
            : 'any';
      // Lazy, depth-first grants: each next roll sees all preceding effects.
      // Per-player history and seen-pool exclusion bound all recursive chains.
      s.eventQueue.unshift(
        ...Array.from(
          { length: id === 'p-harmonic-gift' ? 2 : 1 },
          () => ({ side, eventId: '', depth: depth + 1, bonusRarity }) as const,
        ),
      );
      break;
    }
    case 's-fifth-movement':
      e.roundFive = 1;
      break;
    case 's-flowing-score':
      e.morphLeft = true;
      break;
    case 's-roaring-pressure':
      addPressure(s, target, 15, '事件「轰鸣增压」+15 点压力');
      break;
    case 's-silence-chain':
      s.players[target].effects.noReliefUntil = Math.max(
        s.players[target].effects.noReliefUntil,
        nextTurnOf(s, target),
      );
      break;
    case 's-hidden-record':
      e.handLimitDelta++;
      break;
    case 's-slow-breath':
      e.slowBreath = true;
      break;
    case 'g-wound-echo':
      e.damageClues = 1;
      break;
    case 'g-rest-shelter':
      p.shields++;
      break;
    case 'g-long-breath':
      e.regenPressure = 1;
      e.regenAppliedRound = s.round;
      reducePressure(s, side, 5);
      break;
    case 'g-extra-listen':
      p.guessesRemaining++;
      break;
    case 'g-missing-beat':
      s.players[target].effects.drawPenalty++;
      break;
    case 'g-noise-free':
      e.freeCluesUntilRound = s.round;
      break;
    case 'g-dice-law': {
      const roll = randomIndex(s, 6) + 1;
      record(s, {
        kind: 'system',
        side,
        title: '掷骰定律',
        text: `掷出 ${roll} 点。`,
      });
      gainClue(s, side, roll <= 3 ? 1 : roll <= 5 ? 2 : 3);
      break;
    }
    case 'p-tight-threshold': {
      const enemy = s.players[target];
      enemy.pressureCap = 85;
      enemy.pressure = Math.min(enemy.pressure, 85);
      addPressure(s, target, 0);
      break;
    }
    case 'p-endless-score':
      e.noDiscardPhase = true;
      break;
    case 'p-dual-resonance':
      e.dualResonance = true;
      break;
    case 'p-pressure-swap': {
      const enemy = s.players[target],
        previous = p.pressure;
      p.pressure = Math.min(enemy.pressure, p.pressureCap);
      enemy.pressure = Math.min(previous, enemy.pressureCap);
      record(s, {
        kind: 'system',
        side,
        title: '变奏轮回',
        text: '双方当前压力已交换。',
      });
      addPressure(s, side, 0);
      addPressure(s, target, 0);
      break;
    }
    case 'a1':
      e.apBonus++;
      heal(s, side, 1);
      break;
    case 'a2':
      e.freeFirstAttack = true;
      break;
    case 'a3':
      e.restBonus++;
      break;
    case 'a4':
      e.carryApEnabled = true;
      break;
    case 'a5':
      p.extraDraw++;
      e.handLimitDelta -= 2;
      break;
    case 'a6':
      e.tier3Downgrade = true;
      break;
    case 'b1':
      e.damageApRefund++;
      break;
    case 'b2':
      e.infoCostDelta--;
      e.infoPressureTax++;
      break;
    case 'b3':
      e.pauseClue = true;
      break;
    case 'b4':
      gainStageClue(s, side);
      gainStageClue(s, target);
      // 合唱是「一起唱」，自己额外松一口气；减压同样受禁止减压约束。
      reducePressure(s, side, 10);
      break;
    case 'b5':
      e.damageMul -= 0.15;
      e.attackApRefund++;
      break;
    case 'b6':
      e.freeGuessPerRound = true;
      break;
    case 'c1':
      e.guessMissDelta -= 10;
      break;
    case 'c2':
      p.guessesRemaining++;
      e.guessMissDelta += 12;
      break;
    case 'c3':
      e.blindGuesses++;
      break;
    case 'c4': {
      const t = s.players[target].effects;
      t.tier3BlockFromRound = s.round + 1;
      t.tier3BlockUntilRound = s.round + 1;
      break;
    }
    case 'c5': {
      // 0.8：与「线索是记忆、不收回」和合成原料标记保持一致——
      // 不再把旧线索删掉，而是把它们标记为已消耗（不能再用作合成原料），
      // 相当于用两张废牌换一次深挖的资格，压力照付。
      const spent = p.clues.filter((c) => c.tier < 4 && !c.spent).slice(0, 2);
      for (const c of spent) c.spent = true;
      if (spent.length < 2) {
        record(s, {
          kind: 'system',
          side,
          title: '视听置换未能生效',
          text: '可用于置换的非终极线索不足两条，本次置换只支付了压力。',
        });
      }
      gainClue(s, side, 4);
      break;
    }
    case 'c6':
      e.rescueAt80 = true;
      addPressure(s, side, 0);
      break;
  }
}
export function resolveQueuedEvent(
  s: GameState,
  side: Side,
  id: string,
  depth = 0,
  bonusRarity?: 'silver' | 'gold' | 'prismatic' | 'any',
) {
  if (bonusRarity) {
    const pool = eventPool(
      s,
      side,
      bonusRarity === 'any' ? undefined : bonusRarity,
    );
    if (!pool.length) {
      record(s, {
        kind: 'system',
        side,
        title: '随机事件池耗尽',
        text: '没有未出现且可结算的事件，不重复发放旧事件。',
      });
      return;
    }
    const colors = [...new Set(pool.map((e) => e.rarity))];
    const color =
      bonusRarity === 'any'
        ? colors[randomIndex(s, colors.length)]!
        : bonusRarity;
    const sameColor = pool.filter((e) => e.rarity === color);
    id = sameColor[randomIndex(s, sameColor.length)]!.id;
  }
  const definition = STAGE_EVENT_BY_ID[id];
  if (!definition) return;
  const reason = eventUnavailable(s, side, id);
  if (reason) {
    record(s, {
      kind: 'system',
      side,
      title: '事件条件已变化',
      text: `${definition.title}：${reason}，自动替换同色未出现的可用事件。`,
    });
    const pool = eventPool(s, side, definition.rarity);
    if (!pool.length) {
      record(s, {
        kind: 'system',
        side,
        title: '事件跳过',
        text: '没有可替换的未出现同色事件。',
      });
      return;
    }
    id = pool[randomIndex(s, pool.length)]!.id;
  }
  resolveEvent(s, side, id, depth);
}
