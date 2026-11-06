import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/server/config';
import {
  QQMusic,
  CAPABILITIES,
  probe,
  type Capability,
} from '../src/server/music/qq';
const config = loadConfig();
const qq = new QQMusic(config);
const context = {
  ip: config.qqTestIp || '127.0.0.1',
  device: 'music-card-local-probe',
};
const capabilities = process.argv.slice(2) as Capability[];
const results = [];
const requested = capabilities.length
  ? capabilities
  : (['search'] as Capability[]);
for (const capability of requested) {
  if (!(capability in CAPABILITIES)) throw new Error('不支持的能力名');
  const result = await probe(
    qq,
    capability,
    {
      query: '周杰伦',
      songMid: process.env.PROBE_SONG_MID || '',
      albumMid: process.env.PROBE_ALBUM_MID || '',
      singerMid: process.env.PROBE_SINGER_MID || '',
    },
    context,
  );
  results.push(result);
  console.log(
    JSON.stringify({
      capability,
      status: result.status,
      code: result.code,
      elapsedMs: result.elapsedMs,
      message: result.message,
      fields: result.fields,
    }),
  );
}
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/qq-capabilities.json',
  JSON.stringify(
    { checkedAt: new Date().toISOString(), configured: qq.configured, results },
    null,
    2,
  ),
);
