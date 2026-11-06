import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Rooms } from '../src/server/rooms';
import { Store } from '../src/server/store';
import { getSong } from '../src/game/catalog';
import { setup, play, respond } from './game-helpers';
import { GameBoard } from '../src/client/GameBoard';
import { GuessDialog } from '../src/client/GuessDialog';
import { SongReveal } from '../src/client/SongReveal';
import { insideStage } from '../src/client/presentation/useHandPointer';
function fixture() {
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store, true);
  let v = rooms.create('a', '甲', 'fixture', true).room;
  v = rooms.select(v.id, 'a', getSong('wish'), v.version, true);
  v = rooms.start(v.id, 'a', v.version);
  const r = rooms.get(v.id);
  r.developer = { used: true, paused: true };
  rooms.save(r);
  return {
    rooms,
    store,
    r,
    view: () => rooms.view(r, 'a'),
    close: () => {
      rooms.close();
      store.close();
    },
  };
}
test('event progress exposes only opponent lock status; discard zones use real public counts', () => {
  const f = fixture();
  try {
    const g = f.r.game!;
    g.stageEvents.selected.b = g.stageEvents.offers.b[0];
    const v = f.view();
    assert.equal(v.game!.stageEvent.opponentSelected, true);
    assert.equal(v.game!.stageEvent.selected, undefined);
    assert.ok(!('opponentOffers' in v.game!.stageEvent));
    assert.equal(
      v.players.find((p) => p.seat === 'b')!.discardCount,
      g.players.b.discard.length,
    );
  } finally {
    f.close();
  }
});
test('result played-card totals survive the 80-entry log window', () => {
  const f = fixture();
  try {
    const g = f.r.game!;
    g.events = [];
    delete g.cardsPlayed; // Legacy records without the new cumulative counter still render correctly.
    for (let i = 1; i <= 101; i++)
      g.events.push({
        id: i,
        kind: i <= 21 ? 'card' : 'system',
        side: 'a',
        cardId: i <= 21 ? 'strike' : undefined,
        text: '测试',
        title: '测试',
      });
    const v = f.view();
    assert.equal(v.game!.log.length, 80);
    assert.equal(v.game!.stats!.cardsPlayed, 21);
  } finally {
    f.close();
  }
});
test('new table renders live card price, pressure cap, unavailable reason and both deck counts', () => {
  const f = fixture();
  try {
    const g = setup(['strike', 'pause', 'information']);
    g.players.a.energy = 0;
    g.players.a.pressureCap = 85;
    g.players.a.pressure = 40;
    f.r.game = g;
    const v = f.view(),
      html = renderToStaticMarkup(
        createElement(GameBoard, { room: v, busy: false, action: () => {} }),
      );
    assert.ok(html.includes('md-duel'));
    assert.ok(!html.includes('original-demo-table'));
    assert.ok(html.includes('aria-valuemax="85"'));
    assert.ok(html.includes('行动点不足'));
    assert.ok(html.includes('/art/duel-20261101/strike.webp'));
    assert.ok(html.includes('data-motion-card'));
  } finally {
    f.close();
  }
});
test('guess dialog displays current event-adjusted miss cost rather than prototype literals', () => {
  const f = fixture();
  try {
    const v = f.view();
    v.game!.guessMissPressure = 37;
    v.game!.guessesRemaining = 4;
    const html = renderToStaticMarkup(
      createElement(GuessDialog, {
        room: v,
        busy: false,
        open: false,
        close: () => {},
        action: () => {},
      }),
    );
    assert.ok(html.includes('37'));
    assert.ok(html.includes('确认猜歌'));
    assert.ok(!html.includes('猜错压力 +20'));
  } finally {
    f.close();
  }
});
test('pressure win never claims a guessed song; reveal uses actual song and current round', () => {
  const f = fixture();
  try {
    const g = f.r.game!;
    g.phase = 'finished';
    g.round = 7;
    g.outcome = {
      winner: 'a',
      reason: 'pressureGuess',
      text: '对手压力到顶，对方获胜。',
    };
    const v = f.view(),
      html = renderToStaticMarkup(
        createElement(SongReveal, {
          room: v,
          rematch: () => {},
          notice: '',
          back: () => {},
        }),
      );
    assert.equal(v.game!.stageEvent.waiting, false);
    assert.ok(html.includes('这一局，你赢了'));
    assert.ok(!html.includes('你听懂了他藏的歌'));
    // 电脑底牌已改为随机抽取，不能再假设它是 wish 或 coral，
    // 只能按本局真实的对手底牌来断言结算页展示的是实际歌曲。
    const botSong = v.game!.revealed!.find((s) => s.seat === 'b')!.song;
    assert.ok(html.includes(botSong.title));
    assert.ok(html.includes('对局轮次'));
  } finally {
    f.close();
  }
});
test('drag commits only within the actual stage rectangle including its edges', () => {
  const r = { left: 10, right: 110, top: 20, bottom: 80 };
  assert.equal(insideStage(10, 20, r), true);
  assert.equal(insideStage(110, 80, r), true);
  for (const [x, y] of [
    [9, 30],
    [50, 81],
    [111, 70],
    [50, 19],
    [NaN, 40],
  ])
    assert.equal(insideStage(x!, y!, r), false);
});

test('played-card snapshot keeps actual free-attack cost and damage after consuming its discount', () => {
  let g = setup(['strike'], ['pause']);
  g.players.a.effects.freeFirstAttack = true;
  g.players.a.damageBonus = 0.5;
  g = play(g, 'strike');
  const entry = g.events.findLast((e) => e.kind === 'card')!;
  assert.equal(entry.definition!.cost, 0);
  assert.ok(entry.definition!.description.includes('30'));
  assert.equal(g.players.a.effects.freeFirstAttackUsed, true);
  g = respond(g, 'pause');
  assert.equal(
    g.events.findLast((e) => e.kind === 'card')!.definition!.id,
    'pause',
  );
  assert.equal(entry.definition!.cost, 0);
});
