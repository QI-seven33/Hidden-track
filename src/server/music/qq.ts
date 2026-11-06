import { RequestQueue } from './request-queue';
import { artistGender, shortTranslations } from './game-metadata';
import { lyricHints } from './duel-media';
import { createHmac } from 'node:crypto';
import type { Config } from '../config';
import type { QQAuth } from '../store';
import type { Song } from '../../game/types';
import type { ProbeResult } from '../../shared/protocol';
import { AppError } from '../errors';
import { extractCredits } from './credits';
import { PublicMetadataReader } from './public-metadata';
import { readPublicTranslation } from './translation';
import { OfficialSceneReader } from './official-scenes';
import { songEvidence } from './evidence';
import type { MusicCredit } from './credits';
import type { EmbeddedQQ } from './embedded-qq';

export const QQ_ENDPOINT =
  'https://qplaycloud.y.qq.com/rpc_proxy/fcgi-bin/music_open_api.fcg';
const MONITOR_ENDPOINT =
  'https://stat.y.qq.com/open/fcgi-bin/music_monitor_api.fcg';
export type QQData = Record<string, unknown>;
export const object = (v: unknown): QQData =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as QQData) : {};
export const text = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
export const number = (v: unknown): number =>
  Number.isFinite(Number(v)) ? Number(v) : 0;
export function webPlaybackResource(
  raw: QQData,
):
  | {
      url: string;
      preview: boolean;
      quality: number;
      fullNeedsSdk: boolean;
      format?: string;
      requiresDecoding?: boolean;
    }
  | undefined {
  if (raw.resource_source === 'embedded-qq') {
    const full = object(raw.account_resource),
      url = coverUrl(full.url);
    if (url && text(full.format))
      return {
        url,
        preview: false,
        quality: 0,
        fullNeedsSdk: false,
        format: text(full.format),
        requiresDecoding: full.requiresDecoding === true,
      };
  }
  const direct = (value: unknown) => {
    const url = coverUrl(value);
    return url &&
      !/\.(?:mgg\d*|mflac\d*|mmp4|qmc\d*)$/i.test(new URL(url).pathname)
      ? url
      : undefined;
  };
  if (number(raw.playable) === 1) {
    const standard = direct(raw.song_play_url_standard);
    if (standard)
      return { url: standard, preview: false, quality: 0, fullNeedsSdk: false };
    const fluent = direct(raw.song_play_url);
    if (fluent)
      return { url: fluent, preview: false, quality: 3, fullNeedsSdk: false };
  }
  const preview =
    number(raw.try_playable) === 1 && number(raw.try_file_size) > 0
      ? direct(raw.try_30s_url)
      : undefined;
  return preview
    ? {
        url: preview,
        preview: true,
        quality: 10,
        fullNeedsSdk: number(raw.playable) === 1,
      }
    : undefined;
}
export function parseUpstreamJSON(raw: string): unknown {
  return (
    JSON.parse as (
      s: string,
      reviver: (
        key: string,
        value: unknown,
        context?: { source?: string },
      ) => unknown,
    ) => unknown
  )(raw, (_key, value, context) =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value) &&
    context?.source
      ? context.source
      : value,
  );
}
export function signQuery(query: string, key: string, cookie = ''): string {
  return createHmac('sha256', key)
    .update(`${query}&cookie=${cookie}`)
    .digest('hex');
}
export function coverUrl(value: unknown): string | undefined {
  try {
    const u = new URL(text(value));
    if (!['http:', 'https:'].includes(u.protocol)) return;
    if (u.username || u.password) return;
    if (!/(^|\.)(qq\.com|gtimg\.cn|gtimg\.com|qlogo\.cn)$/.test(u.hostname))
      return;
    u.protocol = 'https:';
    return u.href;
  } catch {
    return;
  }
}
export function songFromQQ(value: unknown): Song {
  const r = object(value);
  const mid = text(r.song_mid);
  const id = text(r.song_id);
  if ((!mid && !id) || !text(r.song_name || r.song_title))
    throw new AppError(502, 'QQ音乐返回的曲目缺少身份或名称', 'UPSTREAM_SHAPE');
  const mainArtists = Array.isArray(r.singer)
    ? r.singer.map((v) => text(object(v).name)).filter(Boolean)
    : Array.isArray(r.singer_list)
      ? r.singer_list.map((v) => text(object(v).name)).filter(Boolean)
      : text(r.singer_name)
          .split(/[、;]/)
          .map((s) => s.trim())
          .filter(Boolean);
  const otherArtists = Array.isArray(r.other_singer_list)
    ? r.other_singer_list
        .map((v) => text(object(v).name || object(v).singer_name))
        .filter(Boolean)
    : [];
  const artists = [...new Set([...mainArtists, ...otherArtists])];
  const publicYear = text(r.public_time).match(
    /^((?:19|20)\d{2})-\d{2}-\d{2}$/,
  )?.[1];
  return {
    id: `qq:${mid || id}`,
    provider: 'qq',
    providerId: id || undefined,
    providerMid: mid || undefined,
    title: text(r.song_name || r.song_title),
    artists,
    album: text(r.album_name),
    albumId: text(r.album_id) || undefined,
    albumMid: text(r.album_mid) || undefined,
    cover: coverUrl(r.album_pic_300x300 || r.album_pic),
    language: text(r.language) || undefined,
    genre: text(r.genre) || undefined,
    bpm: number(r.bpm) > 0 ? number(r.bpm) : undefined,
    year: publicYear ? Number(publicYear) : undefined,
    lyricists: [],
    composers: text(r.author) ? [text(r.author)] : [],
    sources: [
      {
        label: 'QQ 音乐比赛 OpenAPI',
        url: 'https://y.qq.com/music_developer/#/docs/openapi#/feature/song',
      },
    ],
  };
}
export function songList(data: QQData): unknown[] {
  if (Array.isArray(data.song_list)) return data.song_list;
  if (Array.isArray(data.songlist)) return data.songlist;
  if (Array.isArray(data.list)) return data.list;
  const nested = object(data.data);
  if (Array.isArray(nested.songlist)) return nested.songlist;
  if (Array.isArray(nested.list)) return nested.list;
  return [];
}
export class QQError extends AppError {
  constructor(
    public qqCode: number,
    public safeMessage: string,
  ) {
    super(
      qqCode === 10701 || qqCode === 11109 ? 401 : qqCode === 10200 ? 403 : 502,
      safeMessage,
      'QQ_UPSTREAM',
    );
  }
}
export class QQMusic {
  readonly publicMetadata: PublicMetadataReader;
  readonly officialScenes: OfficialSceneReader;
  private queue = new RequestQueue();
  private pending = 0;
  constructor(
    readonly config: Config,
    private transport: typeof fetch = fetch,
    readonly native?: EmbeddedQQ,
  ) {
    this.officialScenes = new OfficialSceneReader((command, args) =>
      this.call(
        command,
        args,
        {
          ip: config.qqTestIp || '127.0.0.1',
          device: 'official-scene-metadata',
        },
        { allowError: true },
      ),
    );
    this.publicMetadata = new PublicMetadataReader(
      config.qqPublicMetadata,
      transport,
    );
  }
  get configured() {
    return Boolean(
      this.native || (this.config.qqAppId && this.config.qqAppKey),
    );
  }
  async chineseTranslation(id: string, mid?: string) {
    if (this.config.qqPublicLyrics)
      return readPublicTranslation(this.transport, id, mid);
  }
  // Fixed upstream, fixed business wrappers: never expose a general-purpose signer/proxy.
  async call(
    command: string,
    parameters: Record<string, string | number>,
    context: { ip: string; device: string; auth?: QQAuth },
    options: {
      monitor?: boolean;
      allowError?: boolean;
      includeKey?: boolean;
    } = {},
  ): Promise<QQData> {
    if (this.native) return this.native.call(command, parameters, context);
    if (!this.configured)
      throw new AppError(
        503,
        '尚未配置 QQ 音乐 appid / appkey',
        'QQ_NOT_CONFIGURED',
      );
    if (this.pending >= 16)
      throw new AppError(
        429,
        '音乐接口正在处理较多请求，请稍后重试',
        'QQ_BUSY',
      );
    this.pending++;
    const execute = async () => {
      const auth = context.auth;
      const query = new URLSearchParams({
        opi_cmd: command,
        app_id: this.config.qqAppId,
        timestamp: String(Math.floor(Date.now() / 1000)),
        device_id: context.device,
        client_ip: this.config.qqTestIp || context.ip.replace(/^::ffff:/, ''),
      });
      if (auth) {
        query.set('login_type', '6');
        query.set('qqmusic_open_appid', this.config.qqAppId);
        query.set('qqmusic_open_id', auth.openId);
        query.set('qqmusic_access_token', auth.accessToken);
      }
      for (const [key, value] of Object.entries(parameters))
        query.set(key, String(value));
      // The token-exchange endpoint explicitly requires app_key server-to-server.
      if (options.includeKey) query.set('app_key', this.config.qqAppKey);
      const encoded = query.toString();
      let response: Response;
      try {
        response = await this.transport(
          `${options.monitor ? MONITOR_ENDPOINT : QQ_ENDPOINT}?${encoded}`,
          {
            headers: {
              'X-QYOPI-Sign': signQuery(encoded, this.config.qqAppKey),
            },
            signal: AbortSignal.timeout(8000),
            redirect: 'error',
          },
        );
      } catch {
        throw new AppError(
          502,
          'QQ 音乐连接失败或超时，请检查服务端网络和地域',
          'QQ_NETWORK',
        );
      }
      if (!response.ok)
        throw new AppError(502, `QQ 音乐 HTTP ${response.status}`, 'QQ_HTTP');
      const raw = await response.text();
      if (raw.length > 2_000_000)
        throw new AppError(502, 'QQ 音乐响应超过读取上限', 'QQ_RESPONSE_SIZE');
      let data: QQData;
      try {
        data = object(parseUpstreamJSON(raw));
      } catch {
        throw new AppError(502, 'QQ 音乐响应不是有效 JSON', 'QQ_JSON');
      }
      if (
        !options.allowError &&
        (number(data.ret) !== 0 || number(data.vcheck) === 1)
      ) {
        const safe =
          number(data.vcheck) === 1
            ? '用户登录状态校验失败，需要重新授权'
            : this.message(data);
        throw new QQError(number(data.ret) || 11109, safe);
      }
      return data;
    };
    const result = this.queue.run(execute).finally(() => {
      this.pending--;
    });
    return result;
  }
  message(data: QQData): string {
    let msg = text(data.msg).slice(0, 180) || 'QQ 音乐接口返回业务错误';
    for (const secret of [this.config.qqAppKey, this.config.adminToken])
      if (secret) msg = msg.replaceAll(secret, '[redacted]');
    return msg.replace(/https?:\/\/\S+/g, '[upstream-url]');
  }
  async search(
    query: string,
    context: { ip: string; device: string; auth?: QQAuth },
  ) {
    const data = await this.call(
      'fcg_music_custom_search.fcg',
      { w: query, p: 1, num: 20, t: 0 },
      context,
    );
    return songList(data).flatMap((raw) => {
      try {
        return [songFromQQ(raw)];
      } catch {
        return [];
      }
    });
  }
  async detail(
    id: string,
    context: { ip: string; device: string; auth?: QQAuth },
  ) {
    const identity = id.replace(/^qq:/, '');
    const data = await this.call(
      'fcg_music_custom_get_song_info_batch.fcg',
      /^\d+$/.test(identity) ? { song_id: identity } : { song_mid: identity },
      context,
    );
    const raw = songList(data).find((entry) => {
      const candidate = object(entry);
      return /^\d+$/.test(identity)
        ? text(candidate.song_id) === identity
        : text(candidate.song_mid) === identity;
    });
    if (!raw) throw new AppError(404, '未取得这首歌的详情', 'SONG_NOT_FOUND');
    return {
      song: songFromQQ(raw),
      raw: object(raw),
      trace: text(data.traceId || data.trace_id),
    };
  }
  async gameSong(
    id: string,
    context: { ip: string; device: string; auth?: QQAuth },
  ): Promise<Song> {
    if (this.native) return this.native.gameSong(id, context);
    const { song: base, raw } = await this.detail(id, context);
    const observedAt = new Date().toISOString();
    const web =
      !base.language || !base.genre || !base.bpm
        ? await this.publicMetadata.get(base.providerMid, base.providerId)
        : undefined;
    const usedWeb =
      web &&
      ((!base.language && web.languages.length > 0) ||
        (!base.genre && web.genres.length > 0) ||
        (!base.bpm && web.bpm));
    const song = web
      ? {
          ...base,
          language: base.language || web.languages.join('、') || undefined,
          genre: base.genre || web.genres.join('、') || undefined,
          bpm: base.bpm || web.bpm,
          sources: usedWeb
            ? [
                ...base.sources,
                {
                  label: 'QQ 音乐公开网页资料（实验）',
                  url: `https://y.qq.com/n/ryqq_v2/songDetail/${encodeURIComponent(web.mid)}`,
                },
              ]
            : base.sources,
        }
      : base;
    let credits: MusicCredit[] = [];
    let hint: string | undefined;
    let hints: string[] = [];
    let translations: Record<string, string> = {};
    try {
      const lyric = await this.call(
        'fcg_music_custom_get_lyric.fcg',
        song.providerMid
          ? { song_mid: song.providerMid }
          : { song_id: song.providerId || '' },
        context,
        { allowError: true },
      );
      credits = extractCredits(lyric, raw.song_id);
      hints = lyricHints(lyric, song);
      translations = shortTranslations(lyric, song, hints);
      // Foreign excerpts require an aligned official translation to enter the hidden-song pool.
      hints = hints.filter(
        (h) =>
          !/[\p{Script=Latin}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
            h,
          ) || !!translations[h],
      );
      hint = hints[0];
    } catch {
      // Missing optional credits must not make the song unselectable.
    }
    const gender = await artistGender(this, raw, song, context);
    const byRole = (role: string) =>
      credits.filter((c) => c.role === role).flatMap((c) => c.names);
    return {
      ...song,
      artistGender: gender,
      lyricTranslations: translations,
      lyricHint: hint,
      lyricHints: hints,
      duration:
        typeof raw.song_play_time === 'number' &&
        Number.isFinite(raw.song_play_time) &&
        raw.song_play_time > 0
          ? raw.song_play_time
          : undefined,
      evidence: songEvidence(
        { ...base, artistGender: gender },
        raw.song_play_time,
        web,
        credits,
        observedAt,
        this.config.qqPublicMetadata,
        new Date().toISOString(),
        hint,
      ),
      lyricists: byRole('作词'),
      composers: song.composers.length ? song.composers : byRole('作曲'),
      sources:
        song.providerMid && credits.length
          ? [
              ...song.sources,
              {
                label: 'QQ 音乐歌词署名（已核对歌曲版本）',
                url: `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(song.providerMid)}`,
              },
            ]
          : song.sources,
    };
  }
}
const sensitive =
  /token|secret|password|encryptString|auth_code|sdk_qr_code|song_play_url|try_30s_url|trackFiles|vkey|ekey|cookie|app_key|mcpUrl|song_lyric|lyric$/i;
export function safeSample(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[nested]';
  if (Array.isArray(value))
    return value.slice(0, 2).map((v) => safeSample(v, depth + 1));
  if (value && typeof value === 'object') {
    const priority =
      /^(song_id|song_mid|song_name|album_desc|song_desc|singer_wiki|wiki|public_time|author|origin|album_pic|album_mid|singer_mid|nickname|headimgurl)$/;
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => Number(priority.test(b)) - Number(priority.test(a)))
        .slice(0, 65)
        .map(([key, v]) => [
          key,
          sensitive.test(key) ? '[redacted]' : safeSample(v, depth + 1),
        ]),
    );
  }
  if (typeof value === 'string')
    return value
      .replace(/https?:\/\/[^\s"']*\?[^\s"']*/g, '[url-with-query]')
      .replace(/[A-Za-z0-9+/=_-]{28,}/g, '[long-value]')
      .slice(0, 300);
  return value;
}
export function fieldPaths(
  value: unknown,
  prefix = '',
  output = new Set<string>(),
): string[] {
  if (output.size > 250 || prefix.split('.').length > 7) return [...output];
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 2)) fieldPaths(v, `${prefix}[]`, output);
  } else if (value && typeof value === 'object')
    for (const [key, v] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      output.add(path);
      if (!sensitive.test(key)) fieldPaths(v, path, output);
    }
  return [...output];
}
export const CAPABILITIES = {
  search: {
    title: '歌曲搜索',
    command: 'fcg_music_custom_search.fcg',
    login: false,
  },
  song: {
    title: '歌曲详情与封面',
    command: 'fcg_music_custom_get_song_info_batch.fcg',
    login: false,
  },
  playback: {
    title: '播放 / 试听权限（仅查询）',
    command: 'fcg_music_custom_get_song_info_batch.fcg',
    login: false,
  },
  album: {
    title: '专辑描述与封面',
    command: 'fcg_music_custom_get_album_detail.fcg',
    login: false,
  },
  singer: {
    title: '歌手信息 / wiki',
    command: 'fcg_music_custom_get_singer_info.fcg',
    login: false,
  },
  lyric: {
    title: '歌曲歌词',
    command: 'fcg_music_custom_get_lyric.fcg',
    login: false,
  },
  account: {
    title: '账户头像与昵称',
    command: 'fcg_music_custom_get_account_info.fcg',
    login: true,
  },
  playlists: {
    title: '个人歌单目录',
    command: 'fcg_music_custom_get_songlist_self.fcg',
    login: true,
  },
  chorus: {
    title: '副歌时间段',
    command: 'fcg_music_custom_get_mir_detail.fcg',
    login: false,
  },
  versions: {
    title: '同曲其他版本',
    command: 'fcg_music_get_other_version_songs.fcg',
    login: false,
  },
  similar: {
    title: '相似歌曲推荐',
    command: 'fcg_music_custom_get_similar_song.fcg',
    login: false,
  },
  recent: {
    title: '我的最近播放',
    command: 'fcg_music_custom_get_play_recently.fcg',
    login: true,
  },
  recommendations: {
    title: '每日推荐歌曲',
    command: 'fcg_music_custom_rc_songs.fcg',
    login: true,
  },
  albums: {
    title: '我的收藏专辑',
    command: 'fcg_get_fav_album_list.fcg',
    login: true,
  },
  follows: {
    title: '我的关注歌手',
    command: 'fcg_music_custom_get_fav_singerlist.fcg',
    login: true,
  },
  membership: {
    title: '我的会员权益',
    command: 'fcg_music_rpc_green_vip_info.fcg',
    login: true,
  },
} as const;
export type Capability = keyof typeof CAPABILITIES;
export async function probe(
  qq: QQMusic,
  capability: Capability,
  input: Record<string, string>,
  context: { ip: string; device: string; auth?: QQAuth },
): Promise<ProbeResult> {
  const start = Date.now();
  const base = { capability, elapsedMs: 0, fields: [] as string[] };
  if (!qq.configured)
    return {
      ...base,
      status: 'missing_config',
      message: '未配置密钥，未发送上游请求',
    };
  if (CAPABILITIES[capability].login && !context.auth)
    return {
      ...base,
      status: 'needs_login',
      message: '当前访客未授权 QQ 音乐，未发送该用户接口请求',
    };
  const extraArguments: Partial<
    Record<Capability, Record<string, string | number>>
  > = {
    chorus: { song_ids: input.songId || '' },
    versions: input.songId
      ? { song_id: input.songId }
      : { song_mid: input.songMid || '' },
    similar: { song_mid: input.songMid || '' },
    recent: { type: 2, updateTime: 0 },
    recommendations: { scene: 0 },
    albums: { offset: 0, limit: 10, type: 0 },
    follows: { start_index: 0, page_size: 10 },
  };
  const args: Record<string, string | number> =
    extraArguments[capability] ??
    (capability === 'search'
      ? { w: input.query || '周杰伦', p: 1, num: 3, t: 0 }
      : capability === 'song' ||
          capability === 'lyric' ||
          capability === 'playback'
        ? { song_mid: input.songMid || '' }
        : capability === 'album'
          ? { album_mid: input.albumMid || '', page: 0, size: 3, fav_state: 0 }
          : capability === 'singer'
            ? {
                singer_mid: input.singerMid || '',
                wiki: 1,
                num_per_page: 3,
                page_index: 0,
              }
            : {});
  if (Object.values(args).some((v) => v === ''))
    return {
      ...base,
      status: 'error',
      message: '请填写此接口需要的歌曲 ID 或歌曲 / 专辑 / 歌手 MID',
    };
  try {
    const data = await qq.call(
      CAPABILITIES[capability].command,
      args,
      context,
      { allowError: true },
    );
    const code = number(data.ret);
    const loginFailed = number(data.vcheck) === 1;
    const track = object(songList(data)[0]);
    if (capability === 'playback' && code === 0 && !loginFailed) {
      const playable =
        number(track.playable) === 1 ||
        (number(track.try_playable) === 1 && number(track.try_file_size) > 0);
      return {
        ...base,
        elapsedMs: Date.now() - start,
        code,
        status: playable ? 'available' : 'denied',
        message: playable
          ? '样本返回播放或试听权限；实际终端播放仍需验证'
          : text(track.unplayable_msg) ||
            '查询成功，但样本未返回可用播放 / 试听权限',
        fields: fieldPaths(data),
        sample: safeSample(data),
      };
    }
    return {
      ...base,
      elapsedMs: Date.now() - start,
      code,
      status:
        loginFailed || [10701, 11109].includes(code)
          ? 'needs_login'
          : code === 10200
            ? 'denied'
            : code === 0
              ? 'available'
              : 'error',
      message:
        code === 0 && !loginFailed
          ? '接口成功；请以字段和实际内容判断覆盖情况'
          : qq.message(data),
      fields: fieldPaths(data),
      sample: safeSample(data),
    };
  } catch (err) {
    return {
      ...base,
      elapsedMs: Date.now() - start,
      status: 'error',
      message: err instanceof AppError ? err.message : '探测失败',
    };
  }
}
