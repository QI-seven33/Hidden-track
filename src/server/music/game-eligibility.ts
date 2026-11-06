import type { Song } from '../../game/types';
import { FACT_TEMPLATES } from '../../game/clues';
import { usableFact } from '../../game/evidence';
/** Fail closed for playable hidden songs, independently of ordinary search/detail pages. */
export function missingGameFacts(song: Song): string[] {
  const missing = FACT_TEMPLATES.filter(
    (f) =>
      !f.value(song) ||
      (song.evidence && f.field && !usableFact(song.evidence, f.field)),
  ).map((f) => f.label);
  if (!song.cover) missing.push('专辑封面');
  if (!song.lyricHint || !song.lyricHints?.length)
    missing.push('可安全展示的歌词短句');
  if (
    song.lyricHints?.some(
      (h) =>
        /\p{Script=Latin}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
          h,
        ) && !song.lyricTranslations?.[h],
    )
  )
    missing.push('与原文逐句对齐的中文歌词译文');
  if (!song.previewAvailable) missing.push('官方 MP3 试听');
  return [...new Set(missing)];
}
