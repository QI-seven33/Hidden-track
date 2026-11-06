import type { Song } from '../../game/types';
import { text, object, type QQMusic, type QQData } from './qq';
import type { QQAuth } from '../store';
/** Count only identity-checked individual artist classifications. Groups are unknown. */
export async function artistGender(
  qq: QQMusic,
  raw: QQData,
  song: Song,
  ctx: { ip: string; device: string; auth?: QQAuth },
): Promise<string | undefined> {
  const entries = [
    { name: raw.singer_name, id: raw.singer_id, mid: raw.singer_mid },
    ...(Array.isArray(raw.singer) ? raw.singer : []),
    ...(Array.isArray(raw.singer_list) ? raw.singer_list : []),
    ...(Array.isArray(raw.other_singer_list) ? raw.other_singer_list : []),
  ].map((v) => {
    const r = object(v);
    return {
      name: text(r.name || r.singer_name),
      id: text(r.id || r.singer_id),
      mid: text(r.mid || r.singer_mid),
    };
  });
  if (!song.artists.length || song.artists.length > 12) return;
  let male = 0,
    female = 0;
  for (const name of song.artists) {
    const r = entries.find((r) => r.name === name && (r.id || r.mid));
    if (!r) return;
    try {
      const data = await qq.call(
        'fcg_music_custom_get_singer_info.fcg',
        {
          ...(r.mid ? { singer_mid: r.mid } : { singer_id: r.id }),
          num_per_page: 1,
          page_index: 0,
          wiki: 0,
          fav_state: 0,
        },
        ctx,
        { allowError: true },
      );
      if (
        text(data.ret) !== '0' ||
        text(data.singer_name) !== name ||
        !(
          (r.id && text(data.singer_id) === r.id) ||
          (r.mid && text(data.singer_mid) === r.mid)
        )
      )
        return;
      if (data.type === 0) male++;
      else if (data.type === 1) female++;
      else return;
    } catch {
      return;
    }
  }
  return [male ? male + ' 男' : '', female ? female + ' 女' : '']
    .filter(Boolean)
    .join('、');
}
function timed(value: unknown) {
  const result: { time: number; value: string }[] = [];
  for (const line of text(value).split(/\r?\n/)) {
    const times = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d+))?\]/g)];
    const content = line
      .replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d+)?\])+/, '')
      .trim();
    for (const t of times)
      result.push({
        time: Math.round(
          (+t[1]! * 60 + +t[2]! + Number('0.' + (t[3] || '0'))) * 1000,
        ),
        value: content,
      });
  }
  return result;
}
export function shortTranslations(
  raw: QQData,
  song: Song,
  hints: string[],
): Record<string, string> {
  if (text(raw.song_id) !== song.providerId) return {};
  const original = timed(raw.song_lyric),
    translated = timed(raw.song_translate_lyric),
    out: Record<string, string> = {};
  const forbidden = [
    song.title,
    song.translatedTitle,
    ...song.artists,
    song.album,
  ].filter(Boolean) as string[];
  for (const hint of hints) {
    const line = original.find((l) => l.value.startsWith(hint));
    if (!line) continue;
    const exact = translated.filter((t) => t.time === line.time);
    if (exact.length !== 1) continue;
    const value = exact[0]!.value;
    if (
      !/[\u3400-\u9fff]/u.test(value) ||
      /[:：<>]|https?:|www\.|作词|作曲|翻译|译者/i.test(value) ||
      forbidden.some((v) =>
        value.toLocaleLowerCase().includes(v.toLocaleLowerCase()),
      )
    )
      continue;
    out[hint] = [...value.split(/\s+/).slice(0, 10).join(' ')]
      .slice(0, 24)
      .join('');
  }
  return out;
}
