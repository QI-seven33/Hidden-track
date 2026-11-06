export type CreditRole =
  | '作词'
  | '作曲'
  | '编曲'
  | '制作人'
  | '词曲署名'
  | '吉他'
  | '木吉他'
  | '电吉他'
  | '贝斯'
  | '鼓'
  | '打击乐'
  | '钢琴'
  | '键盘'
  | '弦乐'
  | '和声'
  | '和声编写'
  | '录音'
  | '录音助理'
  | '混音'
  | '母带';
export interface MusicCredit {
  role: CreditRole;
  names: string[];
  source: 'qq_lyric_credit';
  songId: string;
}
const roles: Record<string, CreditRole> = {
  词: '作词',
  作词: '作词',
  曲: '作曲',
  作曲: '作曲',
  编曲: '编曲',
  制作人: '制作人',
  'lyrics by': '作词',
  lyricist: '作词',
  'composed by': '作曲',
  composer: '作曲',
  'arranged by': '编曲',
  arranger: '编曲',
  'produced by': '制作人',
  producer: '制作人',
  'written by': '词曲署名',
  songwriter: '词曲署名',
  吉他: '吉他',
  guitar: '吉他',
  吉他演奏: '吉他',
  木吉他: '木吉他',
  'acoustic guitar': '木吉他',
  电吉他: '电吉他',
  'electric guitar': '电吉他',
  贝斯: '贝斯',
  bass: '贝斯',
  鼓: '鼓',
  drums: '鼓',
  打击乐: '打击乐',
  percussion: '打击乐',
  钢琴: '钢琴',
  piano: '钢琴',
  键盘: '键盘',
  keyboards: '键盘',
  弦乐: '弦乐',
  strings: '弦乐',
  和声: '和声',
  合声: '和声',
  和声演唱: '和声',
  'backing vocals': '和声',
  和声编写: '和声编写',
  合声编写: '和声编写',
  录音: '录音',
  录音师: '录音',
  录音工程师: '录音',
  录音工程: '录音',
  'recording engineer': '录音',
  录音助理: '录音助理',
  混音: '混音',
  混音师: '混音',
  混音工程师: '混音',
  混音工程: '混音',
  'mixing engineer': '混音',
  母带: '母带',
  母带工程师: '母带',
  'mastering engineer': '母带',
};
/** Only explicit credit headers of the exact numeric recording are eligible.
 * LRC [by:] is the uploader and must never be used as the songwriter.
 * No lyric body or player/account ticket leaves this function.
 */
export function extractCredits(
  lyric: Record<string, unknown>,
  expectedSongId: unknown,
): MusicCredit[] {
  const id = (value: unknown) =>
    typeof value === 'string' && /^[1-9]\d*$/.test(value)
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? String(value)
        : '';
  const expected = id(expectedSongId),
    reported = id(lyric.song_id);
  if (
    !expected ||
    expected !== reported ||
    Number(lyric.ret) !== 0 ||
    Number(lyric.vcheck) === 1 ||
    typeof lyric.song_lyric !== 'string'
  )
    return [];
  const input = lyric.song_lyric
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, v: string) => {
      const code = /^x/i.test(v) ? parseInt(v.slice(1), 16) : Number(v);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
  const found = new Map<CreditRole, Set<string>>();
  for (const raw of input.split(/\r?\n/).slice(0, 60)) {
    // Credit headers are expected near the beginning, not in a sung verse.
    const times = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:]\d+)?\]/g)];
    if (times.some((time) => Number(time[1]) * 60 + Number(time[2]) > 45))
      continue;
    const line = raw
      .replace(/^\uFEFF/, '')
      .replace(/^(?:\[[^\]]*\])+/, '')
      .trim();
    const match = line.match(/^([^:：]{1,50})\s*[:：]\s*(.{1,160})$/);
    if (!match) continue;
    if (/^(?:未知|佚名|暂无|不详|unknown|n\/a)$/i.test(match[2]!.trim()))
      continue;
    const key = match[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
    const combined = key === '词曲' || /^词\s*[/、&]\s*曲$/.test(key);
    if (!combined && !Object.hasOwn(roles, key)) continue;
    const labels: CreditRole[] = combined ? ['作词', '作曲'] : [roles[key]!];
    const names = match[2]!
      .split(/[\/、;；]/)
      .map((v) => v.trim())
      .filter(
        (v) =>
          v &&
          v.length <= 80 &&
          !/^(?:未知|佚名|暂无|不详|unknown|n\/a)$/i.test(v) &&
          !/[<>\[\]]|https?:\/\//i.test(v),
      );
    for (const role of labels) {
      const values = found.get(role) || new Set<string>();
      names.forEach((n) => values.add(n));
      found.set(role, values);
    }
  }
  return [...found]
    .filter(([, names]) => names.size)
    .map(([role, names]) => ({
      role,
      names: [...names],
      source: 'qq_lyric_credit',
      songId: reported,
    }));
}
