import type { GuessAnswer, Song } from './types';
const TITLE_ALIASES: Record<string, string[]> = {
  wish: ['願與愁'],
  coral: [],
  'first-day': [],
  'light-years': [],
  darwin: ['達爾文'],
  flower: ['花田錯'],
  bedtime: ['床邊故事'],
  lonely: [],
  guilt: ['於心有愧'],
};
const ARTIST_ALIASES: Record<string, string[]> = {
  林俊杰: ['林俊傑', 'JJ', 'JJ Lin'],
  周杰伦: ['周杰倫', 'Jay Chou'],
  梁心颐: ['梁心頤', 'Lara', 'Lara Liang'],
  孙燕姿: ['孫燕姿', 'Stefanie Sun'],
  'G.E.M. 邓紫棋': ['GEM', 'G.E.M.', '邓紫棋', '鄧紫棋', 'G.E.M.鄧紫棋'],
  蔡健雅: ['Tanya Chua'],
  王力宏: ['Leehom Wang'],
  曹格: ['Gary Chaw'],
  陈奕迅: ['陳奕迅', 'Eason Chan'],
};
/** Exact factual aliases, Unicode normalization and punctuation tolerance; no fuzzy false wins. */
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}
export function isCorrectAnswer(answer: GuessAnswer, target: Song): boolean {
  const title = normalizeAnswer(answer.title);
  if (
    ![
      target.title,
      ...(target.aliases ?? []),
      ...(TITLE_ALIASES[target.id] ?? []),
    ].some((v) => normalizeAnswer(v) === title)
  )
    return false;
  if (!answer.artist?.trim()) return true;
  const artists = target.artists.flatMap((a) => [
    a,
    ...(ARTIST_ALIASES[a] ?? []),
  ]);
  return (
    artists.some(
      (a) => normalizeAnswer(a) === normalizeAnswer(answer.artist!),
    ) ||
    normalizeAnswer(target.artists.join('、')) ===
      normalizeAnswer(answer.artist)
  );
}
export function validateAnswer(answer: GuessAnswer): string | undefined {
  if (typeof answer?.title !== 'string' || !normalizeAnswer(answer.title))
    return '请输入歌名';
  if (answer.title.length > 100 || (answer.artist?.length ?? 0) > 100)
    return '歌名或歌手过长';
  return undefined;
}
