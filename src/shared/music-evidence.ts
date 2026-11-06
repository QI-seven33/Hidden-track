/** Provenance is not a probability of truth or a game balance score. */
export const MUSIC_SOURCES = {
  qq_openapi: {
    label: 'QQ 音乐比赛 OpenAPI',
    priority: 30,
    experimental: false,
  },
  qq_lyric_credit: {
    label: 'QQ 音乐官方歌词署名',
    priority: 20,
    experimental: false,
  },
  qq_public_web: {
    label: 'QQ 音乐公开网页资料（实验）',
    priority: 10,
    experimental: true,
  },
} as const;
export type MusicSource = keyof typeof MUSIC_SOURCES;
export type EntityScope = 'recording' | 'album' | 'artist';
export interface MusicEntity {
  scope: EntityScope;
  id: string;
}
type Definition = {
  label: string;
  scope: EntityScope;
  kind: 'text' | 'names' | 'positive' | 'year';
  use: 'fact' | 'context';
};
export const MUSIC_FIELDS = {
  artistGender: {
    label: '署名演唱者性别统计',
    scope: 'recording',
    kind: 'text',
    use: 'fact',
  },
  lyricHint: {
    label: '歌词短提示',
    scope: 'recording',
    kind: 'text',
    use: 'fact',
  },
  title: { label: '歌名', scope: 'recording', kind: 'text', use: 'fact' },
  artists: {
    label: '该录音演唱者',
    scope: 'recording',
    kind: 'names',
    use: 'fact',
  },
  album: { label: '收录专辑', scope: 'recording', kind: 'text', use: 'fact' },
  year: {
    label: '该版本发行年份',
    scope: 'recording',
    kind: 'year',
    use: 'fact',
  },
  language: {
    label: '单曲语言',
    scope: 'recording',
    kind: 'text',
    use: 'fact',
  },
  genre: {
    label: '平台单曲流派标签',
    scope: 'recording',
    kind: 'text',
    use: 'context',
  },
  bpm: {
    label: '平台 BPM（拍速口径待校准）',
    scope: 'recording',
    kind: 'positive',
    use: 'context',
  },
  lyricists: {
    label: '明确作词署名',
    scope: 'recording',
    kind: 'names',
    use: 'fact',
  },
  composers: {
    label: '明确作曲署名',
    scope: 'recording',
    kind: 'names',
    use: 'fact',
  },
  credits: {
    label: '演奏与制作署名',
    scope: 'recording',
    kind: 'names',
    use: 'context',
  },
  duration: {
    label: '录音总时长（秒）',
    scope: 'recording',
    kind: 'positive',
    use: 'fact',
  },
  albumLanguage: {
    label: '专辑语言',
    scope: 'album',
    kind: 'text',
    use: 'context',
  },
  albumGenre: {
    label: '专辑流派',
    scope: 'album',
    kind: 'text',
    use: 'context',
  },
  albumDescription: {
    label: '专辑介绍',
    scope: 'album',
    kind: 'text',
    use: 'context',
  },
  artistArea: {
    label: '歌手资料中的地区',
    scope: 'artist',
    kind: 'text',
    use: 'context',
  },
  artistBiography: {
    label: '歌手介绍',
    scope: 'artist',
    kind: 'text',
    use: 'context',
  },
} as const satisfies Record<string, Definition>;
export type MusicField = keyof typeof MUSIC_FIELDS;
export type EvidenceValue = string | number | string[];
export interface MusicEvidence {
  field: MusicField;
  entity: MusicEntity;
  source: MusicSource;
  observedAt: string;
  /** Safe field/adapter identifier, never an upstream body, token or URL. */
  basis: string;
  value: EvidenceValue;
}
export interface ResolvedFact {
  status: 'known' | 'unknown' | 'conflict';
  /** Preferred display value; conflict values are never eligible for settlement. */
  selected?: MusicEvidence;
  candidates: MusicEvidence[];
}
export interface MusicEvidenceSnapshot {
  schemaVersion: 1;
  policyVersion: 'music-evidence-v1';
  capturedAt: string;
  entity: MusicEntity;
  allowedSources: MusicSource[];
  facts: Partial<Record<MusicField, ResolvedFact>>;
}
