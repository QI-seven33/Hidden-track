import { QQMusic, text } from './qq';
import type { QQAuth } from '../store';
import { AppError } from '../errors';
import { readableText } from './profile';

export interface LyricSection {
  label: string;
  kind?: 'original' | 'translation';
  source?: string;
  lines: { text: string; seconds?: number }[];
}
export function plainLyricLines(value: unknown): LyricSection['lines'] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return readableText(value)
    .split(/\r?\n/)
    .flatMap((raw) => {
      if (/^\[(?:ti|ar|al|by|offset|length|re|ve):[^\]]*\]\s*$/i.test(raw))
        return [];
      const time = raw.match(/^\[(\d{1,3}):(\d{2})(?:[.:](\d+))?\]/);
      const content = raw
        .replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d+)?\])+/, '')
        .trim();
      return content
        ? [
            {
              text: content,
              ...(time
                ? {
                    seconds:
                      Number(time[1]) * 60 +
                      Number(time[2]) +
                      Number('0.' + (time[3] || '0')),
                  }
                : {}),
            },
          ]
        : [];
    });
}
export async function fullLyrics(
  qq: QQMusic,
  id: string,
  context: { ip: string; device: string; auth?: QQAuth },
) {
  const { song } = await qq.detail(id, context);
  const data = await qq.call(
    'fcg_music_custom_get_lyric.fcg',
    song.providerMid
      ? { song_mid: song.providerMid }
      : { song_id: song.providerId! },
    context,
  );
  if (!song.providerId || text(data.song_id) !== song.providerId)
    throw new AppError(502, '歌词版本与选定歌曲不一致，未展示其他版本的歌词');
  const sections: LyricSection[] = [];
  const original = plainLyricLines(data.song_lyric);
  if (original.length)
    sections.push({
      label: '原文歌词',
      kind: 'original',
      source: 'QQ 音乐比赛 OpenAPI',
      lines: original,
    });
  let translated = plainLyricLines(data.song_translate_lyric),
    translationSource = 'QQ 音乐比赛 OpenAPI';
  if (!translated.length) {
    const content = await qq.chineseTranslation(
      song.providerId,
      song.providerMid,
    );
    translated = plainLyricLines(content);
    translationSource = 'QQ 音乐公开歌词（实验）';
  }
  if (translated.length)
    sections.push({
      label: '中文翻译',
      kind: 'translation',
      source: translationSource,
      lines: translated,
    });
  return {
    songId: song.id,
    source: 'QQ 音乐歌词',
    translationAvailable: translated.length > 0,
    sections,
  };
}
