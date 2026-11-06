import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PresentationCursor } from '../src/client/presentation/events';
import { SONGS } from '../src/game/catalog';
import { availableClues, titleLength } from '../src/game/clues';
import { createGame, transition } from '../src/game/engine';
import { eventPool } from '../src/game/event-eligibility';
import { gainClue } from '../src/game/operations';
import { beginStage } from '../src/game/stage-events';
import { missingGameFacts } from '../src/server/music/game-eligibility';
import {
  artistGender,
  shortTranslations,
} from '../src/server/music/game-metadata';
import { QQMusic } from '../src/server/music/qq';
import { STAGE_EVENTS } from '../src/shared/stage-events';
import { act, setup } from './game-helpers';
import { testConfig } from './helpers';

test('single-slot refresh uses only that card free chance and never offers seen events again', () => {
  let s = createGame('wish', 'coral', 42);
  const old = [...s.stageEvents.offers.a];
  s = act(s, { type: 'refreshEvents', side: 'a', eventId: old[1]! });
  assert.equal(s.stageEvents.offers.a[0], old[0]);
  assert.equal(s.stageEvents.offers.a[2], old[2]);
  assert.ok(!old.includes(s.stageEvents.offers.a[1]!));
  assert.deepEqual(s.stageEvents.freeRefresh.a, [1, 0, 1]);
  const first = s.stageEvents.offers.a[0]!;
  s = act(s, { type: 'refreshEvents', side: 'a', eventId: first });
  assert.deepEqual(s.stageEvents.freeRefresh.a, [0, 0, 1]);
  assert.ok(
    transition(s, {
      type: 'refreshEvents',
      side: 'a',
      eventId: s.stageEvents.offers.a[0]!,
    }).error,
  );
  s.players.a.refreshes = 1;
  s = act(s, {
    type: 'refreshEvents',
    side: 'a',
    eventId: s.stageEvents.offers.a[0]!,
  });
  assert.equal(s.players.a.refreshes, 0);
  const seen = [...s.players.a.seenEvents];
  s.round++;
  beginStage(s);
  assert.ok(s.stageEvents.offers.a.every((id) => !seen.includes(id)));
  assert.ok(
    transition(s, { type: 'refreshEvents', side: 'a', eventId: 'forged' })
      .error,
  );
});
test('all events exhausted skips selection safely and does not resurrect seen bonuses', () => {
  const s = setup();
  s.players.a.seenEvents = STAGE_EVENTS.map((e) => e.id);
  s.players.b.seenEvents = STAGE_EVENTS.map((e) => e.id);
  s.round = 8;
  beginStage(s);
  assert.equal(s.stageEvents.resolved, true);
  assert.deepEqual(s.stageEvents.offers, { a: [], b: [] });
  assert.equal(eventPool(s, 'a').length, 0);
});
test('lyrics are produced once per distinct line; exact clues have new tiers and no old bands', () => {
  const s = setup();
  s.rules.fusion = false;
  s.round = 4;
  const song = s.catalog.find((c) => c.id === 'coral')!;
  song.lyricHint = '这是原创的测试句子';
  song.lyricHints = ['这是原创的测试句子', '第二句必须不一样'];
  const all = availableClues(s, 'a');
  assert.equal(all.find((c) => c.id === 'artist')!.tier, 2);
  assert.ok(!all.some((c) => ['durationBand', 'lengthBand'].includes(c.id)));
  for (let i = 0; i < 40; i++) gainClue(s, 'a', 1, false);
  const lyrics = s.players.a.clues.filter((c) => c.id.startsWith('lyric-'));
  assert.equal(lyrics.length, 2);
  assert.equal(new Set(lyrics.map((c) => c.value)).size, 2);
  // 0.9：歌词不再靠重复同一句无限产出，用尽后就是没有新线索。
  const before = s.players.a.clues.length;
  assert.equal(gainClue(s, 'a', 1), false);
  assert.equal(s.players.a.clues.length, before);
});
test('foreign title length reveals counts only and requires an official translated title', () => {
  const song = {
    ...SONGS[0]!,
    title: 'A quiet night',
    translatedTitle: '宁静之夜',
  };
  assert.equal(titleLength(song), '原文 3 个词 · 官方中文译名 4 个字符');
  assert.equal(titleLength({ ...song, translatedTitle: undefined }), undefined);
  assert.ok(!titleLength(song)!.includes('quiet'));
});
test('lyric translations use exact matching timestamps, recording identity, short excerpts and answer filtering', () => {
  const song = { ...SONGS[0]!, providerId: '42' };
  const raw = {
    song_id: 42,
    song_lyric: '[00:03.50]A quiet road\n[00:07]Another day',
    song_translate_lyric: '[00:03.500]一条安静的小路\n[00:07]' + song.title,
  };
  assert.deepEqual(
    shortTranslations(raw, song, ['A quiet road', 'Another day']),
    { 'A quiet road': '一条安静的小路' },
  );
  assert.deepEqual(
    shortTranslations({ ...raw, song_id: 43 }, song, ['A quiet road']),
    {},
  );
});
test('strict playable-song gate explains missing fields and never accepts unknown artist gender or missing cover', () => {
  const song = {
    ...SONGS[0]!,
    artistGender: '1 男',
    genre: 'Pop 流行',
    duration: 240,
    cover: 'https://y.qq.com/cover.jpg',
    lyricHint: '测试歌词句子',
    lyricHints: ['测试歌词句子'],
    previewAvailable: true,
  };
  assert.deepEqual(missingGameFacts(song), []);
  assert.ok(
    missingGameFacts({ ...song, artistGender: undefined }).includes(
      '署名演唱者性别',
    ),
  );
  assert.ok(
    missingGameFacts({ ...song, cover: undefined }).includes('专辑封面'),
  );
  assert.ok(
    missingGameFacts({ ...song, title: 'Foreign Song' }).includes('歌名长度'),
  );
});
test('official individual artist types are counted per matched credit; groups and mismatched names fail closed', async () => {
  let type = 0,
    wrong = false;
  const qq = new QQMusic(
    testConfig({ qqAppId: 'app', qqAppKey: 'key' }),
    async () =>
      new Response(
        JSON.stringify({
          ret: 0,
          singer_id: 7,
          singer_name: wrong ? '另一个人' : '测试歌手',
          type,
        }),
      ),
  );
  const raw = { singer_name: '测试歌手', singer_id: 7 },
    song = { ...SONGS[0]!, artists: ['测试歌手'] },
    ctx = { ip: '127.0.0.1', device: 'test' };
  assert.equal(await artistGender(qq, raw, song, ctx), '1 男');
  type = 2;
  assert.equal(await artistGender(qq, raw, song, ctx), undefined);
  type = 1;
  wrong = true;
  assert.equal(await artistGender(qq, raw, song, ctx), undefined);
});
test('feedback accepts small reserved sequence gaps but strips arbitrary hidden fields and suppresses reconnect history', () => {
  const c = new PresentationCursor();
  c.next('match1', [{ id: 1, kind: 'turn' }]);
  assert.equal(
    c.next('match1', [{ id: 3, kind: 'damage', amount: 1, side: 'b' }]).length,
    1,
  );
  assert.deepEqual(c.next('match2', [{ id: 3, kind: 'damage' }]), []);
});
test('pressure blocking disables breathe rather than consuming it and printing a false reduction', () => {
  const s = setup(['breathe']);
  s.players.a.pressure = 20;
  s.players.a.effects.noReliefUntil = s.turn;
  const result = transition(s, {
    type: 'playCard',
    side: 'a',
    instanceId: s.players.a.hand[0]!.id,
  });
  assert.ok(result.error);
  assert.equal(result.state.players.a.hand.length, 1);
  assert.equal(result.state.players.a.pressure, 20);
});
