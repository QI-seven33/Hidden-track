import { QQMusic, object, text, number, type QQData } from './qq';
import type { QQAuth } from '../store';
import type { MusicInspection, InspectionSection } from '../../shared/protocol';
import { musicProfile } from './profile';

const hidden =
  /token|secret|app_key|encryptString|auth_code|sdk_qr_code|song_play_url|try_30s_url|trackFiles|ekey|cookie|open_id|unionid/i;
export function diagnosticData(
  value: unknown,
  secrets: string[],
  key = '',
): unknown {
  if (hidden.test(key)) return { present: Boolean(value) };
  if (/lyric/i.test(key) && typeof value === 'string')
    return { characters: value.length, nonEmpty: Boolean(value) };
  if (Array.isArray(value)) return value.map((v) => diagnosticData(v, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, diagnosticData(v, secrets, k)]),
    );
  if (typeof value === 'string') {
    let safe = value;
    for (const secret of secrets)
      if (secret) safe = safe.replaceAll(secret, '[redacted]');
    return safe.replace(
      /https?:\/\/[^\s"'<>]*\?[^\s"'<>]*/g,
      '[url-with-query]',
    );
  }
  return value;
}
export function flattenFields(
  value: unknown,
  path = '',
  rows: { path: string; value: string }[] = [],
): { path: string; value: string }[] {
  if (Array.isArray(value)) {
    rows.push({ path, value: `数组 · ${value.length} 项` });
    value.forEach((v, i) => flattenFields(v, `${path}[${i}]`, rows));
  } else if (value && typeof value === 'object') {
    if (!Object.keys(value).length) rows.push({ path, value: '空对象' });
    for (const [k, v] of Object.entries(value))
      flattenFields(v, path ? `${path}.${k}` : k, rows);
  } else
    rows.push({
      path,
      value:
        value === '' ? '空字符串' : value === null ? 'null' : String(value),
    });
  return rows;
}
export function wikiFacts(xml: string): Record<string, string> {
  const basic = xml.match(/<basic>([\s\S]*?)<\/basic>/)?.[1] || '';
  const unwrap = (v: string) =>
    v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  return Object.fromEntries(
    [
      ...basic.matchAll(
        /<item>\s*<key>([\s\S]*?)<\/key>\s*<value>([\s\S]*?)<\/value>\s*<\/item>/g,
      ),
    ].map((m) => [unwrap(m[1]!), unwrap(m[2]!)]),
  );
}
export async function inspectMusic(
  qq: QQMusic,
  songId: string,
  context: { ip: string; device: string; auth?: QQAuth },
): Promise<MusicInspection> {
  const { song, raw } = await qq.detail(songId, context);
  const sections: InspectionSection[] = [];
  const sources: Record<string, QQData> = {};
  const add = (key: string, title: string, data: QQData) => {
    sources[key] = data;
    const safe = diagnosticData(data, [
      qq.config.qqAppKey,
      qq.config.adminToken,
    ]);
    sections.push({
      key,
      title,
      code: number(data.ret),
      status:
        number(data.ret) === 0 && number(data.vcheck) !== 1
          ? 'success'
          : 'upstream_error',
      rows: flattenFields(safe),
    });
  };
  add('song', '歌曲详情（当前版本）', { ret: 0, ...raw });
  const web = await qq.publicMetadata.get(song.providerMid, song.providerId);
  if (web)
    add('web', 'QQ 音乐公开网页资料（独立实验来源）', { ret: 0, ...web });
  async function read(
    key: string,
    title: string,
    command: string,
    args: Record<string, string | number>,
  ) {
    try {
      const data = await qq.call(command, args, context, { allowError: true });
      add(key, title, data);
      return data;
    } catch (error) {
      sections.push({
        key,
        title,
        status: 'connection_error',
        rows: [
          {
            path: 'error',
            value: error instanceof Error ? error.message : '请求失败',
          },
        ],
      });
      return {};
    }
  }
  try {
    const search = await qq.call(
      'fcg_music_custom_search.fcg',
      { w: song.title, p: 1, num: 20, t: 0 },
      context,
      { allowError: true },
    );
    const list = Array.isArray(search.songlist)
      ? search.songlist
      : Array.isArray(search.list)
        ? search.list
        : [];
    const same = list
      .map(object)
      .find(
        (candidate) =>
          text(candidate.song_mid) === song.providerMid ||
          (song.providerId && text(candidate.song_id) === song.providerId),
      );
    add(
      'search',
      '搜索字段（只合并相同歌曲 ID / MID）',
      same
        ? { ret: number(search.ret), ...same }
        : {
            ret: number(search.ret),
            note: '该搜索页未包含选定版本，不合并其他版本的字段',
          },
    );
  } catch (error) {
    sections.push({
      key: 'search',
      title: '搜索字段',
      status: 'connection_error',
      rows: [
        {
          path: 'error',
          value: error instanceof Error ? error.message : '请求失败',
        },
      ],
    });
  }
  if (song.albumMid)
    await read('album', '专辑详情', 'fcg_music_custom_get_album_detail.fcg', {
      album_mid: song.albumMid,
      page: 0,
      size: 1,
      fav_state: 0,
    });
  if (text(raw.singer_mid)) {
    const singer = await read(
      'singer',
      '主歌手资料与作品',
      'fcg_music_custom_get_singer_info.fcg',
      {
        singer_mid: text(raw.singer_mid),
        num_per_page: 1,
        page_index: 0,
        wiki: 1,
        fav_state: 0,
      },
    );
    const facts = wikiFacts(text(singer.wikiInfo));
    if (Object.keys(facts).length)
      add('wiki', '歌手 Wiki 基本资料（从 XML 结构提取）', {
        ret: 0,
        ...facts,
      });
  }
  await read(
    'lyric',
    '歌词资源状态（不在诊断中保存歌词正文）',
    'fcg_music_custom_get_lyric.fcg',
    { song_mid: song.providerMid || songId.replace(/^qq:/, '') },
  );
  if (song.providerId) {
    await read(
      'chorus',
      '副歌定位（保留接口原始数值）',
      'fcg_music_custom_get_mir_detail.fcg',
      { song_ids: song.providerId },
    );
    await read(
      'versions',
      '同曲其他版本',
      'fcg_music_get_other_version_songs.fcg',
      { song_id: song.providerId },
    );
  }
  await read('similar', '相似歌曲', 'fcg_music_custom_get_similar_song.fcg', {
    song_mid: song.providerMid || songId.replace(/^qq:/, ''),
  });
  return {
    checkedAt: new Date().toISOString(),
    identity: context.auth ? 'authorized' : 'anonymous',
    song,
    profile: diagnosticData(
      musicProfile(song, sources, Boolean(context.auth)),
      [qq.config.qqAppKey, qq.config.adminToken],
    ) as MusicInspection['profile'],
    sections,
  };
}
