import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfficialSceneReader } from '../src/server/music/official-scenes';
import { makeApp } from '../src/server/app';
import { testConfig } from './helpers';

const directory = {
  ret: 0,
  group_list: [
    {
      group_id: 1001,
      title: '心情',
      subCategory: [
        { sub_id: 2001, subtitle: '伤感' },
        { sub_id: 2002, subtitle: '快乐' },
      ],
    },
  ],
};
test('official associations share an anonymous snapshot, bind both recording IDs, and retain overlapping categories', async () => {
  const calls: string[] = [];
  const reader = new OfficialSceneReader(async (command) => {
    calls.push(command);
    return command.endsWith('category.fcg')
      ? directory
      : {
          ret: 0,
          songlist: [
            { song_id: '123', song_mid: 'mid' },
            { song_id: '123', song_mid: 'mid' },
            { song_id: '999', song_mid: 'another' },
            { song_id: 9007199254740992, song_mid: 'unsafe' },
          ],
        };
  });
  const [a, b] = await Promise.all([
    reader.get('mid', '123'),
    reader.get('mid', '999'),
  ]);
  assert.equal(calls.length, 3);
  assert.equal(a.status, 'complete');
  assert.equal(a.scannedLists, 2);
  assert.equal(a.matches.length, 2);
  assert.equal(a.recordingCount, 2);
  assert.deepEqual(b.matches, []);
  await reader.get('another', '999');
  assert.equal(calls.length, 3);
  assert.deepEqual(
    (await reader.get('unsafe', '9007199254740992')).matches,
    [],
  );
});
test('partial official associations retain positive evidence and retry failures without claiming absence', async () => {
  let now = 0,
    fail = true;
  const reader = new OfficialSceneReader(
    async (command, args) => {
      if (command.endsWith('category.fcg')) return directory;
      if (args.sub_id === '2002' && fail) throw Error('Unavailable');
      return { ret: 0, songlist: [{ song_mid: 'mid', song_id: 123 }] };
    },
    () => now,
  );
  const partial = await reader.get('mid', '123');
  assert.equal(partial.status, 'partial');
  assert.equal(partial.scannedLists, 1);
  assert.equal(partial.matches.length, 1);
  fail = false;
  now = 31_000;
  assert.equal((await reader.get('mid', '123')).status, 'complete');
  const denied = new OfficialSceneReader(async () => ({
    ret: 0,
    vcheck: 1,
    group_list: directory.group_list,
  }));
  assert.equal((await denied.get('mid', '123')).status, 'unavailable');
});
test('official list scope and scan limits fail closed on wrong category responses', async () => {
  const reader = new OfficialSceneReader(async (command) =>
    command.endsWith('category.fcg')
      ? directory
      : { ret: 0, sub_id: 9999, songlist: [{ song_id: 123, song_mid: 'mid' }] },
  );
  assert.deepEqual((await reader.get('mid', '123')).matches, []);
  assert.equal((await reader.get('mid', '123')).status, 'unavailable');
  let scans = 0;
  const bounded = new OfficialSceneReader(async (command) =>
    command.endsWith('category.fcg')
      ? {
          ret: 0,
          group_list: [
            {
              group_id: 1,
              title: '场景',
              subCategory: Array.from({ length: 40 }, (_, i) => ({
                sub_id: i + 1,
                subtitle: `分类${i}`,
              })),
            },
          ],
        }
      : (scans++, { ret: 0, songlist: [] }),
  );
  const result = await bounded.get('mid', '123');
  assert.equal(scans, 32);
  assert.equal(result.totalLists, 40);
  assert.equal(result.status, 'partial');
});
test('association HTTP route uses official commands anonymously and never returns account or unrelated songs', async () => {
  const calls: string[] = [];
  const { app } = await makeApp({
    config: testConfig({
      qqAppId: '123',
      qqAppKey: 'private-key',
      qqPublicMetadata: true,
    }),
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'qplaycloud.y.qq.com');
      assert.equal(url.searchParams.has('qqmusic_access_token'), false);
      const command = url.searchParams.get('opi_cmd') || '';
      calls.push(command);
      const data = command.endsWith('info_batch.fcg')
        ? {
            ret: 0,
            songlist: [{ song_id: 123, song_mid: 'mid', song_name: '曲目' }],
          }
        : command.endsWith('category.fcg')
          ? directory
          : {
              ret: 0,
              songlist: [
                { song_id: 123, song_mid: 'mid' },
                {
                  song_id: 456,
                  song_mid: 'other',
                  song_title: '不应出现在响应中的歌名',
                },
              ],
            };
      return new Response(JSON.stringify(data));
    },
  });
  try {
    const response = await app.inject({
      url: '/api/music/official-associations?id=qq:mid',
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.json().matches.length, 2);
    assert.ok(!response.body.includes('private-key'));
    assert.ok(!response.body.includes('不应出现在响应中的歌名'));
    assert.equal(calls.length, 4);
  } finally {
    await app.close();
  }
});
