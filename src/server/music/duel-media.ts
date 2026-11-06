import type { Song } from '../../game/types';
import { coverUrl, number, text, object, type QQData } from './qq';
import { AppError } from '../errors';

/** Only the existing official MP3 preview, never full/member playback or encrypted files. */
export function officialPreview(raw: QQData): string | undefined {
  const url = coverUrl(raw.try_30s_url);
  return number(raw.try_playable) === 1 &&
    number(raw.try_file_size) > 0 &&
    url &&
    /\.mp3$/i.test(new URL(url).pathname)
    ? url
    : undefined;
}

/** Full account MP3 is clipped by callers to the earned clue duration, with its tags removed. */
export function duelMp3(raw: QQData): string | undefined {
  if (raw.resource_source === 'embedded-qq') {
    const full = object(raw.account_resource),
      url = coverUrl(full.url);
    if (full.format === 'mp3' && url && /\.mp3$/i.test(new URL(url).pathname))
      return url;
  }
  return officialPreview(raw);
}

/** A single short original-language line, matched to the selected recording. */
export function lyricHints(raw: QQData, song: Song): string[] {
  const excerpts: string[] = [];
  if (!song.providerId || text(raw.song_id) !== song.providerId) return [];
  const forbidden = [
    song.title,
    ...(song.aliases || []),
    ...song.artists,
    song.album,
  ].filter(Boolean);
  const lines = text(raw.song_lyric).split(/\r?\n/);
  for (const line of lines) {
    if (!/^\[\d{1,3}:\d{2}(?:[.:]\d+)?\]/.test(line)) continue;
    const content = line
      .replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d+)?\])+/, '')
      .trim();
    if (
      !content ||
      /[:：<>]|https?:|www\.|作词|作曲|编曲|制作|版权|演唱|出品|录音|发行|混音|监制|Lyric|Composer|Copyright/i.test(
        content,
      )
    )
      continue;
    if (
      forbidden.some((value) =>
        content.toLocaleLowerCase().includes(value.toLocaleLowerCase()),
      )
    )
      continue;
    // At most ten words, 24 Unicode characters; no full lyrics in the match snapshot.
    const excerpt = [...content.split(/\s+/).slice(0, 10).join(' ')]
      .slice(0, 24)
      .join('');
    if (excerpt.length >= 4 && !excerpts.includes(excerpt))
      excerpts.push(excerpt);
    if (excerpts.length >= 12) break;
  }
  return excerpts;
}
export function lyricHint(raw: QQData, song: Song) {
  return lyricHints(raw, song)[0];
}

/** Strict MPEG layer III frames only. Drop ID3 and all non-frame bytes, cap at the granted cumulative duration (10-second steps).
 * No upstream filename, ID3 lyrics/art/title, URL or redirect is returned to the player. */
export function anonymousMp3(bytes: Uint8Array, maxSeconds = 10): Buffer {
  const data = Buffer.from(bytes);
  let offset = 0;
  if (data.subarray(0, 3).toString() === 'ID3') {
    if (data.length < 10 || [6, 7, 8, 9].some((i) => data[i]! > 127))
      throw new AppError(502, '试听标签格式不受支持');
    const size =
      (data[6]! << 21) | (data[7]! << 14) | (data[8]! << 7) | data[9]!;
    offset = 10 + size + (data[5]! & 16 ? 10 : 0);
  }
  const frames: Buffer[] = [];
  let seconds = 0;
  while (offset + 4 <= data.length && seconds < maxSeconds) {
    const h = data.readUInt32BE(offset);
    if (h >>> 21 !== 0x7ff) break;
    const version = (h >>> 19) & 3,
      layer = (h >>> 17) & 3,
      bitrateIndex = (h >>> 12) & 15,
      rateIndex = (h >>> 10) & 3;
    if (
      version === 1 ||
      layer !== 1 ||
      !bitrateIndex ||
      bitrateIndex === 15 ||
      rateIndex === 3
    )
      break;
    const rates = [44100, 48000, 32000];
    const rate =
      rates[rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrates =
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const size =
      Math.floor(
        ((version === 3 ? 144 : 72) * bitrates[bitrateIndex]! * 1000) / rate,
      ) +
      ((h >>> 9) & 1);
    const duration = (version === 3 ? 1152 : 576) / rate;
    if (offset + size > data.length || seconds + duration > maxSeconds) break;
    // The first Xing/Info/VBRI frame describes the ORIGINAL file length/seek table.
    // Keeping it after truncation makes browsers report 60s for a 10s grant.
    // Drop that metadata frame, matching the MP3 demuxer tag offsets; audio frames stay intact.
    if (!frames.length) {
      const mono = ((h >>> 6) & 3) === 3;
      const sideInfo = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
      const tag = data.toString(
        'ascii',
        offset + 4 + sideInfo,
        offset + 8 + sideInfo,
      );
      const vbri = data.toString('ascii', offset + 36, offset + 40);
      if (tag === 'Xing' || tag === 'Info' || vbri === 'VBRI') {
        offset += size;
        continue;
      }
    }
    frames.push(data.subarray(offset, offset + size));
    seconds += duration;
    offset += size;
  }
  if (seconds < 0.2)
    throw new AppError(
      502,
      '未取得可安全使用的官方 MP3 试听，请稍后重试或换歌',
      'PREVIEW_INVALID',
    );
  return Buffer.concat(frames);
}

export async function fetchPreview(
  url: string,
  fetcher: typeof fetch = fetch,
  maxSeconds = 10,
): Promise<Buffer> {
  const signal = AbortSignal.timeout(12000);
  let current = url;
  for (let redirects = 0; redirects < 4; redirects++) {
    const safe = coverUrl(current);
    if (!safe) throw new AppError(502, '官方试听来源无效');
    const response = await fetcher(safe, {
      redirect: 'manual',
      signal,
      headers: { Accept: 'audio/mpeg' },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) break;
      current = new URL(location, safe).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      break;
    }
    const max = 8 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > max) {
      await response.body.cancel();
      break;
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > max) throw new AppError(502, '试听资源超过临时处理上限');
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return anonymousMp3(Buffer.concat(chunks), maxSeconds);
  }
  throw new AppError(
    502,
    '官方试听暂时不可用，请稍后重试',
    'PREVIEW_UNAVAILABLE',
  );
}
