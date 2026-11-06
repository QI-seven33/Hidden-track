import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceSnapshot,
  resolveFact,
  usableFact,
} from '../src/game/evidence';
import type { MusicEvidence } from '../src/shared/music-evidence';
import { SONGS } from '../src/game/catalog';
import { createGame } from '../src/game/engine';
import { eligibleClues } from '../src/game/clues';
import { QQMusic } from '../src/server/music/qq';
import { songEvidence } from '../src/server/music/evidence';
import { testConfig } from './helpers';

const entity = { scope: 'recording' as const, id: 'qq:mid' };
const at = '2026-10-28T00:00:00.000Z';
const row = (extra: Partial<MusicEvidence> = {}): MusicEvidence => ({
  entity,
  field: 'language',
  source: 'qq_openapi',
  observedAt: at,
  basis: 'song.language',
  value: '国语',
  ...extra,
});

test('facts require exact entity and scope; empty tags and zero BPM stay unknown', () => {
  for (const bad of [
    row({ entity: { scope: 'album', id: entity.id } }),
    row({ entity: { ...entity, id: 'qq:other' } }),
    row({ value: '' }),
  ])
    assert.equal(
      resolveFact('language', entity, [bad], ['qq_openapi']).status,
      'unknown',
    );
  for (const bpm of [0, -1, NaN, Infinity, 501])
    assert.equal(
      resolveFact(
        'bpm',
        entity,
        [row({ field: 'bpm', value: bpm })],
        ['qq_openapi'],
      ).status,
      'unknown',
    );
  assert.equal(
    resolveFact(
      'albumLanguage',
      entity,
      [row({ field: 'albumLanguage' })],
      ['qq_openapi'],
    ).status,
    'unknown',
  );
});

test('source preference never hides conflicts or becomes a truth probability', () => {
  const input = [row({ source: 'qq_public_web', value: '粤语' }), row()];
  const snapshot = evidenceSnapshot(
    entity,
    input,
    ['qq_openapi', 'qq_public_web'],
    at,
  );
  assert.equal(snapshot.facts.language?.status, 'conflict');
  assert.equal(snapshot.facts.language?.selected?.source, 'qq_openapi');
  assert.equal(usableFact(snapshot, 'language'), undefined);
  assert.equal(
    evidenceSnapshot(entity, input, ['qq_openapi'], at).facts.language?.status,
    'known',
  );
  const names = resolveFact(
    'composers',
    entity,
    [
      row({ field: 'composers', value: ['乙', '甲'] }),
      row({
        field: 'composers',
        source: 'qq_lyric_credit',
        value: ['甲', '乙', '甲'],
      }),
    ],
    ['qq_openapi', 'qq_lyric_credit'],
  );
  assert.equal(names.status, 'known');
  input[1]!.value = 'changed';
  assert.equal(snapshot.facts.language?.selected?.value, '国语');
});

test('new clues consume frozen evidence, skip conflicts, and retain safe source labels', () => {
  const target = {
    ...structuredClone(SONGS[1]!),
    ...entity,
    id: entity.id,
    provider: 'qq' as const,
    language: 'legacy merged value',
  };
  target.evidence = evidenceSnapshot(
    entity,
    [row({ source: 'qq_public_web' })],
    ['qq_public_web'],
    at,
  );
  const game = createGame(SONGS[0]!.id, target.id, 42, {}, [SONGS[0]!, target]);
  const clues = eligibleClues(game, 'a', 1);
  assert.equal(clues.length, 1);
  assert.equal(clues[0]?.value, '国语');
  assert.match(clues[0]!.source.label, /实验/);
  assert.equal(clues[0]!.source.url, '');
  game.catalog[1]!.evidence = evidenceSnapshot(
    entity,
    [row(), row({ source: 'qq_public_web', value: '粤语' })],
    ['qq_openapi', 'qq_public_web'],
    at,
  );
  assert.equal(eligibleClues(game, 'a', 1).length, 0);
});

test('evidence preserves cached observation times, rejects mismatched web/credit identities and excludes raw media', () => {
  const base = {
    ...SONGS[0]!,
    id: 'qq:mid',
    provider: 'qq' as const,
    providerMid: 'mid',
    providerId: '1',
    language: undefined,
  };
  const web = {
    mid: 'mid',
    id: '1',
    languages: ['国语'],
    genres: ['Pop'],
    source: 'qq_public_web' as const,
    extraFacts: [],
    observedAt: at,
  };
  const snapshot = songEvidence(
    base,
    269,
    web,
    [
      {
        role: '作词',
        names: ['错误作者'],
        songId: '2',
        source: 'qq_lyric_credit',
      },
    ],
    '2026-10-28T01:00:00Z',
    true,
  );
  assert.equal(snapshot.facts.language?.selected?.observedAt, at);
  assert.equal(snapshot.facts.lyricists?.status, 'unknown');
  assert.equal(snapshot.facts.duration?.selected?.value, 269);
  assert.equal(
    songEvidence(base, 0, { ...web, id: '2' }, [], at, true).facts.language
      ?.status,
    'unknown',
  );
  assert.equal(
    songEvidence(base, 0, web, [], at, false).facts.language?.status,
    'unknown',
  );
});

test('official detail selects the requested recording instead of the first response row', async () => {
  const other = { song_id: 2, song_mid: 'other', song_name: '错误版本' };
  let onlyWrong = false;
  const qq = new QQMusic(
    testConfig({ qqAppId: '123', qqAppKey: 'key' }),
    async () =>
      new Response(
        JSON.stringify({
          ret: 0,
          songlist: onlyWrong
            ? [other]
            : [other, { song_id: 1, song_mid: 'mid', song_name: '正确版本' }],
        }),
      ),
  );
  const context = { ip: '127.0.0.1', device: 'test' };
  assert.equal((await qq.detail('qq:mid', context)).song.title, '正确版本');
  onlyWrong = true;
  await assert.rejects(qq.detail('qq:mid', context), /未取得/);
});
