import { dirname, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Client } from './vendor/QQMusicApi/src/client.js';
import recordings from './practice-recordings.json';
import type { Song } from '../../game/types';
import type { Store, QQAuth } from '../store';
import { AppError } from '../errors';
import { lyricHints, duelMp3 } from './duel-media';
import { embeddedLibrary } from './embedded-library';

type Row = Record<string, any>;
type Context = { device: string; auth?: QQAuth; session?: string };
export type QQClientFactory = (options: Record<string, unknown>) => Client;
const obj = (value: unknown): Row =>
  value && typeof value === 'object' ? (value as Row) : {};
const list = (value: unknown): Row[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const songs = recordings as Song[];
const unavailable = () =>
  new AppError(502, 'QQ 音乐接口暂时不可用，请稍后重试', 'QQ_NETWORK');

export function qqLyricText(value: unknown): string {
  const text = str(value),
    content = text.match(/LyricContent="([\s\S]*?)"/)?.[1] || text;
  return content
    .replace(
      /&(?:quot|apos|lt|gt|amp);/g,
      (e) =>
        ({
          '&quot;': '"',
          '&apos;': "'",
          '&lt;': '<',
          '&gt;': '>',
          '&amp;': '&',
        })[e]!,
    )
    .replace(/\(\d+,\d+(?:,\d+)?\)/g, '')
    .replace(/^\[(\d+),\d+\]/gm, (_, ms: string) => {
      const s = Math.floor(Number(ms) / 1000);
      return `[${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}]`;
    });
}

/** In-process QQ client. Credentials belong to each game session, never to a global gateway account. */
export class EmbeddedQQ {
  private clients = new Map<string, Client>();
  private flows = new Map<
    string,
    {
      client: Client;
      qr?: any;
      expires: number;
      generation: string;
      busy: boolean;
      last: number;
    }
  >();
  private refreshing = new Map<string, Promise<QQAuth>>();
  constructor(
    private store: Store,
    database: string,
    private factory: QQClientFactory = (options) => new Client(options),
  ) {
    this.devicePath = join(
      dirname(
        database === ':memory:' ? './data/local-practice.sqlite' : database,
      ),
      'qq-device.json',
    );
  }
  private devicePath: string;
  private client(context: Context) {
    const native =
      context.auth?.provider === 'embedded-qq'
        ? context.auth.credential
        : undefined;
    const identity =
      context.device +
      ':' +
      createHash('sha256')
        .update(JSON.stringify(native || null))
        .digest('hex');
    let client = this.clients.get(identity);
    if (!client) {
      if (this.clients.size >= 128)
        throw new AppError(429, '音乐请求较多，请稍后重试');
      client = this.factory({
        devicePath: this.devicePath,
        credential: native || {},
      });
      this.clients.set(identity, client);
    }
    return client;
  }
  private async run(client: Client, value: any): Promise<any> {
    try {
      const result = await value;
      return result?.module && result?.method
        ? await client.execute(result)
        : result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const name = str(obj(error).name);
      if (
        /CredentialExpired|CredentialInvalid|CredentialRefresh|LoginError/.test(
          name,
        )
      )
        throw new AppError(
          401,
          'QQ 音乐登录已失效，请重新登录',
          'QQ_LOGIN_REQUIRED',
        );
      throw unavailable();
    }
  }
  async qr(session: string) {
    for (const [id, flow] of this.flows)
      if (flow.expires < Date.now()) this.cancel(id);
    if (this.flows.size >= 100 && !this.flows.has(session))
      throw new AppError(429, '登录请求较多，请稍后重试');
    this.cancel(session);
    const client = this.factory({
      devicePath: this.devicePath,
      credential: {},
    });
    const flow = {
      client,
      qr: undefined as any,
      expires: Date.now() + 180000,
      generation: randomBytes(18).toString('hex'),
      busy: false,
      last: 0,
    };
    this.flows.set(session, flow);
    try {
      const qr = await this.run(client, client.login.getQrcode('qq'));
      if (this.flows.get(session) !== flow)
        throw new AppError(410, '本次二维码已取消');
      if (!qr?.data?.length || !['image/png', 'image/jpeg'].includes(qr.mime))
        throw unavailable();
      flow.qr = qr;
      return {
        url: '',
        image: `data:${qr.mime};base64,${Buffer.from(qr.data).toString('base64')}`,
        expiresAt: flow.expires,
        tip: '使用 QQ 扫码并确认登录 QQ 音乐',
      };
    } catch (error) {
      if (this.flows.get(session) === flow) this.cancel(session);
      throw error;
    }
  }
  private auth(credential: any): QQAuth {
    const data =
      typeof credential?.toJSON === 'function'
        ? credential.toJSON()
        : obj(credential);
    if (!data.musicid || !data.musickey)
      throw new AppError(502, 'QQ 登录结果缺少凭证，请重新扫码');
    const expires =
      data.musickeyCreateTime && data.keyExpiresIn
        ? (Number(data.musickeyCreateTime) + Number(data.keyExpiresIn)) * 1000
        : Date.now() + 86400000;
    return {
      provider: 'embedded-qq',
      credential: data,
      openId: str(data.openid || data.musicid),
      accessToken: str(data.musickey),
      refreshToken: str(data.refreshToken) || undefined,
      expiresAt: expires,
    };
  }
  async poll(session: string) {
    const flow = this.flows.get(session);
    if (!flow?.qr || flow.expires < Date.now()) {
      this.cancel(session);
      throw new AppError(410, '二维码已过期，请重新获取');
    }
    if (flow.busy || Date.now() - flow.last < 1800)
      return { status: 'waiting' };
    flow.busy = true;
    flow.last = Date.now();
    try {
      const result = await this.run(
        flow.client,
        flow.client.login.checkQrcode(flow.qr),
      );
      if (this.flows.get(session) !== flow)
        throw new AppError(410, '本次二维码已取消');
      if (result.event === 0) {
        const auth = this.auth(result.credential);
        this.store.setAuth(session, auth);
        this.store.setProfile(session);
        this.cancel(session);
        return { status: 'authorized' };
      }
      if (result.event === 3 || result.event === 4) {
        this.cancel(session);
        throw new AppError(410, '二维码已取消或过期，请重新获取');
      }
      return { status: result.event === 2 ? 'scanned' : 'waiting' };
    } finally {
      flow.busy = false;
    }
  }
  cancel(session: string) {
    const flow = this.flows.get(session);
    this.flows.delete(session);
    void flow?.client.close().catch(() => {});
  }
  forget(session: string) {
    this.cancel(session);
    for (const [id, client] of this.clients)
      if (id.startsWith(session.slice(0, 32) + ':')) {
        this.clients.delete(id);
        void client.close().catch(() => {});
      }
  }
  async context(session: string, ip: string) {
    let auth = this.store.getAuth(session);
    if (auth?.provider !== 'embedded-qq')
      return { ip, device: session.slice(0, 32), session };
    if (auth.expiresAt < Date.now() + 60000) {
      let task = this.refreshing.get(session);
      if (!task) {
        const previous = auth,
          client = this.client({ device: session.slice(0, 32), auth });
        task = (async () => {
          const refreshed = this.auth(
            await this.run(
              client,
              client.login.refreshCredential(client.credential),
            ),
          );
          if (this.store.getAuth(session)?.accessToken !== previous.accessToken)
            throw new AppError(401, '登录状态已更改', 'QQ_LOGIN_REQUIRED');
          this.store.setAuth(session, refreshed);
          return refreshed;
        })();
        this.refreshing.set(session, task);
        task.finally(() => this.refreshing.delete(session)).catch(() => {});
      }
      try {
        auth = await task;
      } catch (error) {
        if (
          error instanceof AppError &&
          error.status === 401 &&
          this.store.getAuth(session)?.accessToken === auth.accessToken
        ) {
          this.forget(session);
          this.store.setAuth(session, null);
          this.store.setProfile(session);
        }
        throw error;
      }
    }
    return { ip, device: session.slice(0, 32), auth, session };
  }
  private track(raw: Row): Row {
    const mid = str(raw.mid),
      album = obj(raw.album),
      title = str(raw.name || raw.title);
    const seed = songs.find(
      (s) =>
        s.providerMid === mid &&
        s.providerId === str(raw.id) &&
        s.title === title,
    );
    const cover = album.mid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${album.mid}.jpg`
      : seed?.cover;
    return {
      song_id: str(raw.id),
      song_mid: mid,
      song_name: title,
      singer: raw.singer || [],
      album_id: str(album.id),
      album_mid: str(album.mid),
      album_name: str(album.name),
      album_pic_300x300: cover,
      public_time: raw.time_public,
      song_play_time: Number(raw.interval) || seed?.duration,
      language: seed?.language,
      genre: seed?.genre,
      bpm: Number(raw.bpm) || seed?.bpm,
      author: seed?.composers.join('、'),
      _seed: seed,
    };
  }
  private async detail(client: Client, identity: string) {
    const data = await this.run(client, client.song.getDetail([identity]));
    const raw = list(data?.tracks).find(
      (s) => s.mid === identity || str(s.id) === identity,
    );
    if (!raw) throw new AppError(404, '未取得这首歌的详情', 'SONG_NOT_FOUND');
    const track = this.track(raw),
      mid = str(raw.mid),
      fileMid = str(obj(raw.file).media_mid) || mid;
    const readResource = async (type: string) => {
      const urls = await this.run(
        client,
        client.song.getPlayUrls([mid], type, { fileMids: [fileMid] }),
      ).catch((error) => {
        if (error instanceof AppError && error.status === 401) throw error;
        return {};
      });
      const candidate = str(obj(urls?.[mid]).url);
      try {
        const u = new URL(candidate);
        if (
          !u.username &&
          !u.password &&
          ['https:', 'http:'].includes(u.protocol) &&
          /(^|\.)(qqmusic\.qq\.com|aqqmusic\.tc\.qq\.com)$/.test(u.hostname)
        ) {
          u.protocol = 'https:';
          const format = u.pathname.split('.').at(-1)?.toLowerCase() || '';
          if (
            !/^(mp3|m4a|aac|ogg|flac|mgg\d*|mflac\d*|mmp4|qmc\d*|nac)$/.test(
              format,
            )
          )
            return;
          return {
            url: u.href,
            format,
            requiresDecoding: format !== 'mp3',
            preview: /^RS\d{2}/i.test(u.pathname.split('/').at(-1) || ''),
          };
        }
      } catch {}
    };
    // Use this listener's QQ credentials for full assets. Keep trial fallback explicit.
    let full: Awaited<ReturnType<typeof readResource>>;
    if (client.credential?.musicid && client.credential?.musickey) {
      for (const type of ['M500', 'M800']) {
        const resource = await readResource(type);
        if (resource && !resource.preview) {
          full ||= resource;
          if (resource.format === 'mp3') {
            full = resource;
            break;
          }
        }
      }
      if (!full) {
        for (const type of ['F000', 'C400']) {
          const resource = await readResource(type);
          if (resource && !resource.preview) {
            full = resource;
            break;
          }
        }
      }
    }
    const trial = await readResource('RS02');
    const url = trial?.format === 'mp3' ? trial.url : '';
    return {
      ...track,
      resource_source: 'embedded-qq',
      account_resource: full,
      playable: full ? 1 : 0,
      song_play_url_standard: full?.format === 'mp3' ? full.url : undefined,
      try_playable: url && Number(obj(raw.file).size_try) > 0 ? 1 : 0,
      try_file_size: url ? Number(obj(raw.file).size_try) || 0 : 0,
      try_30s_url: url,
    };
  }
  async call(
    command: string,
    p: Record<string, string | number>,
    context: Context,
  ): Promise<Row> {
    const client = this.client(context);
    const execute = (module: string, method: string, param: Row) =>
      this.run(client, { module, method, param });
    try {
      const library = await embeddedLibrary(
        command,
        p,
        client.credential,
        execute,
        (raw) => this.track(raw),
      );
      if (library) return library;
      switch (command) {
        case 'fcg_music_custom_search.fcg': {
          const data = await this.run(
            client,
            client.search.searchByType(str(p.w), 0, 20, 1, null, false),
          );
          return {
            ret: 0,
            song_list: list(data?.body?.item_song).map((raw) =>
              this.track(raw),
            ),
          };
        }
        case 'fcg_music_custom_get_song_info_batch.fcg':
          return {
            ret: 0,
            song_list: [
              await this.detail(client, str(p.song_mid || p.song_id)),
            ],
          };
        case 'fcg_music_custom_get_lyric.fcg': {
          const identity = str(p.song_mid || p.song_id),
            detail = await this.run(client, client.song.getDetail([identity]));
          const raw = list(detail?.tracks)[0];
          if (!raw) throw new AppError(404, '未取得歌词曲目');
          const lyric = await this.run(
            client,
            client.song.getLyrics(identity, {
              trans: true,
              roma: false,
              qrc: true,
            }),
          );
          let text = str(lyric.lyric),
            translation = str(lyric.trans);
          if (lyric.crypt === 1) {
            const { qrcDecrypt } =
              await import('./vendor/QQMusicApi/src/algorithms/qrc.js');
            text = qqLyricText(qrcDecrypt(text));
            if (translation) translation = qqLyricText(qrcDecrypt(translation));
          }
          return {
            ret: 0,
            song_id: str(raw.id),
            song_lyric: qqLyricText(text),
            song_trans: translation,
          };
        }
        case 'fcg_music_custom_get_account_info.fcg': {
          const data = await this.run(client, client.user.getSelfInfo());
          const u = obj(data.data || data),
            users = obj(u.map_userinfo || u.mapUserInfo),
            profile = obj(
              u.info ||
                u.user_info ||
                u.userInfo ||
                u.creator ||
                users[
                  str(client.credential.strMusicid || client.credential.musicid)
                ] ||
                u,
            );
          const nickname = str(
              profile.nick || profile.nickname || profile.nickName,
            ),
            headimgurl = str(
              profile.logo ||
                profile.headpic ||
                profile.headimgurl ||
                profile.avatar ||
                profile.headPic,
            );
          if (!nickname && !headimgurl)
            throw new AppError(502, 'QQ 账号资料本次未读到，请稍后重试');
          return { ret: 0, user_info: { nickname, headimgurl } };
        }
        case 'fcg_music_custom_get_album_detail.fcg': {
          const data = await execute(
            'music.musichallAlbum.AlbumInfoServer',
            'GetAlbumDetail',
            { albumMid: p.album_mid },
          );
          const a = obj(data.data || data),
            info = obj(a.basicInfo || a.albumInfo || a);
          return {
            ret: 0,
            album_name: info.name,
            album_desc: info.desc || info.description,
            public_time: info.publishDate || info.time_public,
            album_pic_300x300: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${p.album_mid}.jpg`,
          };
        }
        default:
          throw new AppError(
            501,
            '当前 QQ 接口未提供这项资料，原入口保留',
            'QQ_FEATURE_UNAVAILABLE',
          );
      }
    } catch (error) {
      if (
        error instanceof AppError &&
        error.status === 401 &&
        context.session &&
        context.auth?.accessToken ===
          this.store.getAuth(context.session)?.accessToken
      ) {
        this.forget(context.session);
        this.store.setAuth(context.session, null);
        this.store.setProfile(context.session);
      }
      throw error;
    }
  }
  async gameSong(id: string, context: Context): Promise<Song> {
    const data = await this.call(
      'fcg_music_custom_get_song_info_batch.fcg',
      /^qq:\d+$/.test(id)
        ? { song_id: id.slice(3) }
        : { song_mid: id.slice(3) },
      context,
    );
    const raw = data.song_list[0],
      seed = raw._seed as Song | undefined;
    if (!seed)
      throw new AppError(
        422,
        '此录音版本尚缺少可核验的游戏资料，请选择原练习曲目',
        'SONG_INCOMPLETE',
      );
    const song: Song = {
      ...structuredClone(seed),
      id: 'qq:' + raw.song_mid,
      provider: 'qq',
      previewAvailable: !!duelMp3(raw),
    };
    const lyrics = await this.call(
      'fcg_music_custom_get_lyric.fcg',
      { song_mid: raw.song_mid },
      context,
    ).catch(() => undefined);
    if (lyrics) {
      const hints = lyricHints(lyrics, song);
      if (hints.length) {
        song.lyricHints = hints;
        song.lyricHint = hints[0];
      }
    }
    return song;
  }
  async close() {
    for (const id of this.flows.keys()) this.cancel(id);
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }
}
