import { getSong } from './catalog';
import type { Clue, GameState, Side, Song, Tier } from './types';
import { usableFact } from './evidence';
import { nextRandom } from './random';
import { MUSIC_SOURCES, type MusicField } from '../shared/music-evidence';
type Template = {
  id: string;
  label: string;
  tier: Tier;
  field?: MusicField;
  value: (song: Song) => string | undefined;
};
export function titleLength(s: Song): string | undefined {
  if (/^[\p{Script=Han}\p{N}\p{P}\p{Z}]+$/u.test(s.title))
    return [...s.title].length + ' 个字符（含空格与标点）';
  if (!s.translatedTitle) return;
  const words = [
    ...new Intl.Segmenter('und', { granularity: 'word' }).segment(s.title),
  ].filter((x) => x.isWordLike).length;
  return `原文 ${words} 个词 · 官方中文译名 ${[...s.translatedTitle].length} 个字符`;
}
export const FACT_TEMPLATES: readonly Template[] = [
  {
    id: 'language',
    label: '演唱语言',
    tier: 1,
    field: 'language',
    value: (s) => s.language,
  },
  {
    id: 'genre',
    label: '平台曲目流派',
    tier: 1,
    field: 'genre',
    value: (s) => s.genre,
  },
  {
    id: 'artistCount',
    label: '署名歌手数',
    tier: 1,
    field: 'artists',
    value: (s) =>
      s.artists.length
        ? new Set(s.artists).size === 1
          ? '1 位'
          : '2 位及以上'
        : undefined,
  },
  {
    id: 'artistGender',
    label: '署名演唱者性别',
    tier: 1,
    field: 'artistGender',
    value: (s) => s.artistGender,
  },
  {
    id: 'length',
    label: '歌名长度',
    tier: 2,
    field: 'title',
    value: titleLength,
  },
  {
    id: 'lyricist',
    label: '词作者',
    tier: 2,
    field: 'lyricists',
    value: (s) => s.lyricists.join('、') || undefined,
  },
  {
    id: 'composer',
    label: '曲作者',
    tier: 2,
    field: 'composers',
    value: (s) => s.composers.join('、') || undefined,
  },
  {
    id: 'artist',
    label: '该版本演唱者',
    tier: 2,
    field: 'artists',
    value: (s) => s.artists.join('、') || undefined,
  },
  {
    id: 'year',
    label: '该版本发行年份',
    tier: 2,
    field: 'year',
    value: (s) => s.year?.toString(),
  },
  {
    id: 'duration',
    label: '录音总时长',
    tier: 2,
    field: 'duration',
    value: (s) =>
      s.duration
        ? `${Math.floor(s.duration / 60)} 分 ${Math.floor(s.duration % 60)} 秒`
        : undefined,
  },
  {
    id: 'album',
    label: '收录专辑',
    tier: 3,
    field: 'album',
    value: (s) => s.album || undefined,
  },
  {
    id: 'titleCharacter',
    label: '歌名中的字',
    tier: 3,
    field: 'title',
    // 真正取值在 materializeClue 里随机，这里只给一个可读的占位文案。
    value: (s) => {
      const index = [...s.title].findIndex((c) => /[\p{L}\p{N}]/u.test(c));
      return index < 0
        ? undefined
        : `歌名的第 ${index + 1} 个字是「${[...s.title][index]}」`;
    },
  },
];
/** Exact available pool, kept separate from fallback policy for event eligibility. */
export function availableClues(state: GameState, side: Side): Clue[] {
  const target = getSong(
      state.players[side === 'a' ? 'b' : 'a'].songId,
      state.catalog,
    ),
    p = state.players[side];
  const known = new Set(p.clues.map((c) => c.id));
  const result: Clue[] = FACT_TEMPLATES.filter((f) => !known.has(f.id)).flatMap(
    (f) => {
      const fact =
        target.evidence && f.field
          ? usableFact(target.evidence, f.field)
          : undefined;
      if (target.evidence && !fact) return [];
      const value = f.value(
        fact && f.field ? { ...target, [f.field]: fact.value } : target,
      );
      return value
        ? [
            {
              id: f.id,
              label: f.label,
              tier: f.tier,
              value,
              text: `${f.label}：${value}`,
              source: {
                label: fact
                  ? MUSIC_SOURCES[fact.source].label
                  : target.provider === 'qq'
                    ? 'QQ 音乐比赛 OpenAPI'
                    : '本地测试资料',
                url: '',
              },
              ...(f.id === 'album' && target.cover
                ? { image: target.cover }
                : {}),
            },
          ]
        : [];
    },
  );
  const hint = target.evidence
    ? usableFact(target.evidence, 'lyricHint')?.value
    : target.lyricHint;
  if (typeof hint === 'string') {
    // 歌词可以反复产出，但每次必须是不同的一句：
    // 先把已经拿到（包括已被合成掉）的歌词记下来，只从未出现过的句子里取。
    const hints = target.lyricHints?.length ? target.lyricHints : [hint];
    const used = new Set(
      p.clues.filter((c) => c.id.startsWith('lyric-')).map((c) => c.value),
    );
    const value = hints.find((line) => !used.has(line));
    if (value) {
      result.push({
        id: nextSerialId(p.clues, 'lyric-'),
        tier: 4,
        label: '歌词原文',
        value,
        text: '歌词原文：“' + value + '”',
        translation: target.lyricTranslations?.[value],
        source: {
          label:
            target.provider === 'qq'
              ? 'QQ 音乐比赛 OpenAPI（已核对录音）'
              : '本地测试资料',
          url: '',
        },
      });
    }
  }
  const preview = previewClue(state, side);
  if (preview) result.push(preview);
  return result;
}
export function eligibleClues(
  state: GameState,
  side: Side,
  tier: Tier = 4,
  capOverride?: Tier,
): Clue[] {
  const cap = Math.min(capOverride ?? clueTierCap(state, side), 4) as Tier;
  // 静场：终极信息按关键信息发放，且不再向终极补位。
  if (isDowngraded(state) && tier === 4 && cap >= 3) tier = 3;
  if (tier > cap) return [];
  for (let t = tier; t <= cap; t++) {
    const group = cluesExactlyAt(state, side, t as Tier, cap);
    if (group.length) return group;
  }
  // Finish lower facts before repeated lyric fallback; no empty reward when facts remain.
  for (let t = tier - 1; t >= 1; t--) {
    const group = cluesExactlyAt(state, side, t as Tier, cap);
    if (group.length) return group;
  }
  // All legal tiers were exhausted above. Never offer a tier-4 lyric through a lower cap.
  return [];
}
/** 只要某一档的可用池，不带补位——抽卡兜底与合成都要按「这一档到底还有没有」判断。 */
export function cluesExactlyAt(
  state: GameState,
  side: Side,
  tier: Tier,
  capOverride?: Tier,
): Clue[] {
  const cap = Math.min(capOverride ?? clueTierCap(state, side), 4) as Tier;
  if (tier > cap) return [];
  return availableClues(state, side).filter((c) => c.tier === tier);
}
/** 抽卡表按回合取行：回合超过 4 时固定用第 4 行。 */
export function clueOddsRow(round: number): Tier {
  return Math.min(4, Math.max(1, Math.floor(round))) as Tier;
}
/** 抽卡表被轮次上限截断后的实际分布（用于界面提示，不参与结算）。 */
export function effectiveClueOdds(
  state: GameState,
  round: number,
  capOverride?: Tier,
): [number, number, number, number] {
  const cap = Math.min(capOverride ?? clueTierCap(state, 'a'), 4) as Tier;
  const row = state.rules.clueOdds[clueOddsRow(round)] ?? [0, 0, 0, 100];
  const out: [number, number, number, number] = [0, 0, 0, 0];
  row.forEach((p, i) => {
    const t = Math.min(i + 1, cap) as Tier;
    out[t - 1] = (out[t - 1] ?? 0) + p;
  });
  return out;
}
/**
 * 掷一次信息品质。命中档位无剩余可产出信息时按「下一档」兜底：
 * 先往低退（基础最不可能空），全空才往上补，保证不出现空奖励。
 */
export function rollClueTier(
  state: GameState,
  side: Side,
  round: number,
  capOverride?: Tier,
): Tier {
  const cap = Math.min(capOverride ?? clueTierCap(state, side), 4) as Tier;
  const row = state.rules.clueOdds[clueOddsRow(round)] ?? [0, 0, 0, 100];
  const [r, next] = nextRandom(state.rng);
  state.rng = next;
  const roll = Math.floor(r * 100);
  let acc = 0,
    tier: Tier = 4;
  for (let t = 1 as Tier; t <= 4; t = (t + 1) as Tier) {
    acc += row[t - 1] ?? 0;
    if (roll < acc) {
      tier = t;
      break;
    }
  }
  if (tier > cap) tier = cap;
  if (cluesExactlyAt(state, side, tier, cap).length) return tier;
  for (let t = tier - 1; t >= 1; t--)
    if (cluesExactlyAt(state, side, t as Tier, cap).length) return t as Tier;
  for (let t = tier + 1; t <= cap; t++)
    if (cluesExactlyAt(state, side, t as Tier, cap).length) return t as Tier;
  return tier;
}
/** Also constrains fallback, explicit lyrics/audio and direct reward paths. */
export function clueTierCap(state: GameState, side: Side): Tier {
  if (tierBlocked(state, side)) return 2;
  const stage: Tier = state.round >= 4 ? 4 : state.round >= 2 ? 3 : 2;
  return Math.min(stage, isDowngraded(state) ? 3 : 4) as Tier;
}
function tierBlocked(state: GameState, side: Side): boolean {
  const e = state.players[side].effects;
  return (
    e.tier3BlockFromRound > 0 &&
    state.round >= e.tier3BlockFromRound &&
    state.round <= e.tier3BlockUntilRound
  );
}
function isDowngraded(state: GameState): boolean {
  return (
    state.players.a.effects.tier3Downgrade ||
    state.players.b.effects.tier3Downgrade
  );
}
/**
 * 分享专用上限：分享是「多花 1 行动点 + 额外 5 压力」的抢先通道，
 * 因此不受轮次阶梯约束，第 3 轮即可换到终极信息；
 * 但静场（终极降级）与封锁仍然生效。
 */
export function shareTierCap(state: GameState, side: Side): Tier {
  if (tierBlocked(state, side)) return 2;
  return (isDowngraded(state) ? 3 : 4) as Tier;
}
/** 分享的实际档位上限：封印/静场之外，还受「本阶段 +1」的轮次阶梯约束。 */
export function shareCap(state: GameState, side: Side): Tier {
  const stage = Math.min(4, Math.max(1, state.round)) as Tier;
  return Math.min(shareTierCap(state, side), 4, stage + 1) as Tier;
}
export function previewClue(state: GameState, side: Side): Clue | undefined {
  const index = Array.from({ length: 6 }, (_, i) => i).find(
    (i) => !state.players[side].clues.some((c) => c.id === 'preview-' + i),
  );
  if (index === undefined) return undefined;
  return {
    id: 'preview-' + index,
    tier: 4,
    label: '官方试听片段',
    value: `${index * 10}–${(index + 1) * 10} 秒`,
    text: `官方试听：第 ${index + 1} 段，可连续播放前 ${(index + 1) * 10} 秒`,
    source: { label: 'QQ 音乐比赛 OpenAPI · 官方 MP3 试听', url: '' },
  };
}
/** 同 id 前缀的序号：合成产物也走这里，避免和已有条目撞号。 */
export function nextSerialId(clues: readonly Clue[], prefix: string) {
  let index = 0;
  while (clues.some((c) => c.id === prefix + index)) index++;
  return prefix + index;
}
