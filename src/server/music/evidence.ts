import type { Song } from '../../game/types';
import { evidenceSnapshot } from '../../game/evidence';
import type {
  MusicEvidence,
  MusicField,
  MusicSource,
  EvidenceValue,
} from '../../shared/music-evidence';
import type { PublicMetadata } from './public-metadata';
import type { MusicCredit } from './credits';

/** Consumes only normalized, identity-checked metadata; never stores raw lyrics or media URLs. */
export function songEvidence(
  base: Song,
  duration: unknown,
  web: PublicMetadata | undefined,
  credits: MusicCredit[],
  observedAt: string,
  allowPublic: boolean,
  capturedAt = observedAt,
  hint?: string,
) {
  const entity = { scope: 'recording' as const, id: base.id };
  const evidence: MusicEvidence[] = [];
  const add = (
    field: MusicField,
    value: EvidenceValue | undefined,
    source: MusicSource,
    basis: string,
    at = observedAt,
  ) => {
    if (value !== undefined)
      evidence.push({ field, value, entity, source, basis, observedAt: at });
  };
  for (const field of [
    'title',
    'artistGender',
    'artists',
    'album',
    'year',
    'language',
    'genre',
    'bpm',
    'composers',
  ] as const)
    add(field, base[field], 'qq_openapi', `song.${field}`);
  if (typeof duration === 'number')
    add('duration', duration, 'qq_openapi', 'song.song_play_time');
  if (web && web.mid === base.providerMid && web.id === base.providerId) {
    // Web metadata is a fallback, not a second opinion on populated OpenAPI tags.
    // In particular, "Pop 流行" (OpenAPI) and "Pop" (web) must not create a false conflict.
    if (!base.language)
      add(
        'language',
        web.languages.join('、'),
        'qq_public_web',
        'info.lan',
        web.observedAt,
      );
    if (!base.genre)
      add(
        'genre',
        web.genres.join('、'),
        'qq_public_web',
        'info.genre',
        web.observedAt,
      );
    if (!base.bpm)
      add('bpm', web.bpm, 'qq_public_web', 'web.bpm', web.observedAt);
  }
  add(
    'lyricHint',
    hint,
    'qq_openapi',
    'lyric.identityCheckedShortOriginal',
    capturedAt,
  );
  const checked = credits.filter((c) => c.songId === base.providerId);
  for (const [field, role] of [
    ['lyricists', '作词'],
    ['composers', '作曲'],
  ] as const)
    add(
      field,
      checked.filter((c) => c.role === role).flatMap((c) => c.names),
      'qq_lyric_credit',
      `credit.${role}`,
      capturedAt,
    );
  add(
    'credits',
    checked.map((c) => `${c.role}：${c.names.join('、')}`),
    'qq_lyric_credit',
    'credit.explicitRoles',
    capturedAt,
  );
  return evidenceSnapshot(
    entity,
    evidence,
    [
      'qq_openapi',
      'qq_lyric_credit',
      ...(allowPublic ? ['qq_public_web' as const] : []),
    ],
    capturedAt,
  );
}
