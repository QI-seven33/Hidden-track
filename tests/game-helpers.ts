import assert from 'node:assert/strict';
import { createGame, transition } from '../src/game/engine';
import { resolveEvent } from '../src/game/event-effects';
import type {
  CardId,
  ClueOdds,
  GameAction,
  GameState,
  Side,
} from '../src/game/types';

/** 单元测试用的确定性抽卡表：完全复刻 0.7.3 的阶梯（基础→进阶→关键→终极）。 */
export const DETERMINISTIC_ODDS: ClueOdds = {
  1: [100, 0, 0, 0],
  2: [0, 100, 0, 0],
  3: [0, 0, 100, 0],
  4: [0, 0, 0, 100],
};
/** 只保留「确定性阶梯」的夹具：关掉自动合成，便于逐条断言线索条数与压力。 */
function createFixture(
  a: CardId[] = [],
  b: CardId[] = [],
  extra: { fusion?: boolean } = {},
) {
  const s = createGame('wish', 'coral', 123, {
    clueOdds: DETERMINISTIC_ODDS,
    fusion: extra.fusion ?? false,
  });
  s.clock = null;
  s.stageEvents.resolved = true;
  s.stageEvents.drawn = true;
  s.stageEvents.selected = { a: 'a3', b: 'a3' };
  for (const side of ['a', 'b'] as const) {
    const p = s.players[side];
    p.deck.push(...p.hand);
    p.hand = [];
    for (const id of side === 'a' ? a : b) {
      const n = p.deck.findIndex((c) => c.cardId === id);
      assert.ok(n >= 0);
      p.hand.push(...p.deck.splice(n, 1));
    }
  }
  return s;
}
export function act(s: GameState, a: GameAction, now = 1000) {
  const r = transition(s, a, now);
  assert.equal(r.error, undefined);
  return r.state;
}
export function setup(a: CardId[] = [], b: CardId[] = []) {
  return createFixture(a, b);
}
/** 合成开启的夹具：验证 0.8 的自动生成链路。 */
export function setupFusion(a: CardId[] = [], b: CardId[] = []) {
  return createFixture(a, b, { fusion: true });
}
export const play = (s: GameState, id: CardId, side: Side = 'a') =>
  act(s, {
    type: 'playCard',
    side,
    instanceId: s.players[side].hand.find((c) => c.cardId === id)!.id,
  });
export const respond = (s: GameState, id?: CardId) => {
  const side = s.response!.defender;
  return act(s, {
    type: 'respond',
    side,
    instanceId: id
      ? s.players[side].hand.find((c) => c.cardId === id)!.id
      : null,
  });
};
export function event(s: GameState, id: string, side: Side = 'a') {
  s = structuredClone(s);
  resolveEvent(s, side, id);
  return s;
}
