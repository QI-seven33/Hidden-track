import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QQMusic, songFromQQ } from '../src/server/music/qq';
import { musicProfile } from '../src/server/music/profile';
import { testConfig } from './helpers';
import { availableClues } from '../src/game/clues';
import { createGame } from '../src/game/engine';
import { SONGS } from '../src/game/catalog';

const track = {
  song_mid: 'mid',
  song_id: 1,
  song_name: '测试歌曲',
  language: '国语',
  genre: 'Pop 流行',
  bpm: 0,
};
function provider(extra: Partial<typeof track> = {}, enabled = true) {
  let publicCalls = 0;
  const qq = new QQMusic(
    testConfig({ qqAppId: '123', qqAppKey: 'key', qqPublicMetadata: enabled }),
    async (input) => {
      if (String(input).includes('musicu.fcg')) {
        publicCalls++;
        assert.ok(enabled, 'disabled public source must never be requested');
        return new Response(
          JSON.stringify({
            song: {
              code: 0,
              data: {
                track_info: { id: 1, mid: 'mid', bpm: 76 },
                info: {
                  lan: { content: [{ value: '粤语' }] },
                  genre: { content: [{ value: 'Pop' }] },
                },
              },
            },
          }),
        );
      }
      const command = new URL(String(input)).searchParams.get('opi_cmd');
      return new Response(
        JSON.stringify(
          command === 'fcg_music_custom_get_song_info_batch.fcg'
            ? { ret: 0, songlist: [{ ...track, ...extra }] }
            : { ret: 100002 },
        ),
      );
    },
  );
  return { qq, publicCalls: () => publicCalls };
}
const context = { device: 'test', ip: '127.0.0.1' };

test('official language and genre labels preserve exact bilingual provider text', () => {
  for (const genre of ['Pop 流行', 'Alternative 另类']) {
    const song = songFromQQ({ ...track, genre });
    assert.equal(song.genre, genre);
    assert.equal(song.language, '国语');
    assert.equal(song.sources[0]?.label, 'QQ 音乐比赛 OpenAPI');
  }
  assert.equal(
    songFromQQ({ ...track, language: '', genre: '' }).language,
    undefined,
  );
});

test('official tags remain known even when an optional BPM supplement has different web labels', async () => {
  const { qq, publicCalls } = provider();
  const song = await qq.gameSong('qq:mid', context);
  assert.equal(publicCalls(), 1);
  for (const field of ['language', 'genre'] as const) {
    assert.equal(song.evidence?.facts[field]?.status, 'known');
    assert.equal(song.evidence?.facts[field]?.selected?.source, 'qq_openapi');
    assert.equal(song.evidence?.facts[field]?.candidates.length, 1);
  }
  assert.equal(song.genre, 'Pop 流行');
  assert.equal(song.bpm, 76);
  assert.equal(song.evidence?.facts.bpm?.selected?.source, 'qq_public_web');
  const game = createGame(SONGS[0]!.id, song.id, 42, {}, [SONGS[0]!, song]);
  const language = availableClues(game, 'a').find(
    (clue) => clue.id === 'language',
  );
  assert.equal(language?.value, '国语');
  assert.equal(language?.source.label, 'QQ 音乐比赛 OpenAPI');
});

test('complete official selection metadata avoids public requests and experimental source labels', async () => {
  const { qq, publicCalls } = provider({ bpm: 120 });
  const song = await qq.gameSong('qq:mid', context);
  assert.equal(publicCalls(), 0);
  assert.equal(song.bpm, 120);
  assert.ok(!song.sources.some((source) => source.label.includes('实验')));
});

test('fallbacks apply per missing field; public disable does not block authorized official tags', async () => {
  const partial = await provider({ genre: '' }).qq.gameSong('qq:mid', context);
  assert.equal(partial.language, '国语');
  assert.equal(partial.genre, 'Pop');
  assert.equal(
    partial.evidence?.facts.language?.selected?.source,
    'qq_openapi',
  );
  assert.equal(
    partial.evidence?.facts.genre?.selected?.source,
    'qq_public_web',
  );
  const { qq, publicCalls } = provider({}, false);
  const official = await qq.gameSong('qq:mid', context);
  assert.equal(publicCalls(), 0);
  assert.equal(official.genre, 'Pop 流行');
  assert.equal(official.evidence?.facts.genre?.status, 'known');
  assert.ok(!official.evidence?.allowedSources.includes('qq_public_web'));
  const missing = await provider(
    { language: '', genre: '' },
    false,
  ).qq.gameSong('qq:mid', context);
  assert.equal(missing.language, undefined);
  assert.equal(missing.evidence?.facts.language?.status, 'unknown');
});

test('readable profiles credit official tags and only claim experimental supplementation when used', () => {
  const summary = songFromQQ(track);
  const profile = musicProfile(
    summary,
    { song: track, web: { languages: ['粤语'], genres: ['Pop'] } },
    false,
  );
  for (const label of ['单曲语言', '单曲流派']) {
    assert.equal(
      profile.facts.find((fact) => fact.label === label)?.note,
      '来源：比赛 OpenAPI',
    );
    assert.ok(!profile.missing.includes(label));
  }
  assert.equal(
    profile.facts.find((fact) => fact.label === '单曲流派')?.value,
    'Pop 流行',
  );
  assert.equal(profile.metadataNotice, undefined);
});
