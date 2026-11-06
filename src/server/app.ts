import assetVersions from '../shared/asset-versions.json';
import { relative, sep } from 'node:path';
import { PreviewSources, byteRange } from './music/preview-source';
import { digest } from './ruleset';
import { missingGameFacts } from './music/game-eligibility';
import { duelMp3 as officialPreview, fetchPreview } from './music/duel-media';
import Fastify, { LogController, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { WebSocket } from 'ws';
import { loadConfig, type Config } from './config';
import { Store } from './store';
import { developerCommandSchema } from '../shared/developer';
import { Rooms, hash } from './rooms';
import {
  QQMusic,
  CAPABILITIES,
  coverUrl,
  webPlaybackResource,
  number,
  object,
  probe,
  text,
  type Capability,
} from './music/qq';
import { registerMusicAuth } from './routes/music-auth';
import { MusicAuth } from './music/auth';
import { inspectMusic } from './music/inspect';
import { fullLyrics } from './music/lyrics';
import { personalProfile, personalLibrary } from './music/personal';
import { AppError } from './errors';
import {
  PROTOCOL_VERSION,
  commandSchema,
  modeSchema,
  rulesSchema,
} from '../shared/protocol';
import { registerPlaytestGate } from './playtest';
import { APP_VERSION } from '../shared/version';
import { PracticeLibrary } from './music/practice';
import { SONGS } from '../game/catalog';
import type { Song } from '../game/types';
import { EmbeddedQQ, type QQClientFactory } from './music/embedded-qq';

declare module 'fastify' {
  interface FastifyRequest {
    sessionHash: string;
    sessionWasExisting: boolean;
  }
}
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9:_-]+$/);
const version = z.number().int().nonnegative();
const roomId = (r: FastifyRequest) => z.object({ id }).parse(r.params).id;
function secretEqual(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return (
    left.length === right.length &&
    left.length > 0 &&
    timingSafeEqual(left, right)
  );
}

export async function makeApp(
  options: {
    config?: Config;
    fetch?: typeof fetch;
    logger?: boolean;
    sessionCookieName?: string;
    legacySessionCookieName?: string;
    qqClientFactory?: QQClientFactory;
  } = {},
) {
  const config = options.config || loadConfig();
  // A separate loopback review can isolate cookies without touching existing user sessions.
  const sessionCookieName = options.sessionCookieName ?? 'music_session';
  if (!/^music_session(?:_[a-z0-9_-]+)?$/.test(sessionCookieName))
    throw new Error('Invalid session cookie name');
  const legacyCookie = options.legacySessionCookieName;
  if (legacyCookie && !/^music_session(?:_[a-z0-9_-]+)?$/.test(legacyCookie))
    throw new Error('Invalid legacy cookie name');
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 32 * 1024,
    trustProxy: config.trustProxy ? ['127.0.0.1', '::1'] : false,
  });
  const store = new Store(config.database, config.sessionSecret);
  const developerEnabled =
    !config.production &&
    !config.playtest &&
    config.fixtures &&
    ['127.0.0.1', '::1', 'localhost'].includes(config.host);
  const native = config.localOnly
    ? new EmbeddedQQ(store, config.database, options.qqClientFactory)
    : undefined;
  const qq = new QQMusic(config, options.fetch, native);
  const practiceLibrary = new PracticeLibrary(qq);
  const livePractice = qq.configured && !config.fixtures;
  const rooms = new Rooms(
    store,
    developerEnabled,
    (session) => (livePractice ? practiceLibrary.current(session) : SONGS),
    (details) =>
      app.log.warn(
        { event: 'practice_bot_failed', ...details },
        'Practice bot action failed',
      ),
  );
  const musicAuth = new MusicAuth(store, qq);
  const grants = new Map<
    string,
    {
      session: string;
      songId: string;
      mid: string;
      trace: string;
      duration: number;
      quality: number;
      created: number;
      reported: boolean;
      reporting?: Promise<void>;
    }
  >();
  const sockets = new Map<
    WebSocket,
    { alive: boolean; session: string; roomId: string }
  >();
  // 会话资料补取的节流表：上游失败后五分钟内不再重试，避免每次进大厅都打一次接口。
  const profileAttempts = new Map<string, number>();
  await app.register(cookie);
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  await app.register(websocket, {
    options: { maxPayload: 2048, perMessageDeflate: false },
  });
  if (config.playtest) registerPlaytestGate(app, config.playtest);
  app.decorateRequest('sessionHash', '');
  app.decorateRequest('sessionWasExisting', false);
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer');
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (['/api/health', '/api/ready', '/api/meta'].includes(request.url))
      return;
    const origin = request.headers.origin;
    if (
      request.method !== 'GET' &&
      (!origin || !config.origins.includes(origin))
    )
      throw new AppError(403, '请求来源不在允许列表', 'ORIGIN_DENIED');
    const currentRaw = request.cookies[sessionCookieName];
    // A copied database may reuse an existing browser identity without replacing
    // the old application's cookie. The old database and auth are never written.
    const raw =
      currentRaw || (legacyCookie ? request.cookies[legacyCookie] : undefined);
    let session =
      raw && /^[A-Za-z0-9_-]{40,60}$/.test(raw)
        ? store.getSession(hash(raw))
        : undefined;
    request.sessionWasExisting = Boolean(session);
    if (session && !currentRaw && raw) {
      reply.setCookie(sessionCookieName, raw, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.production,
        path: '/',
        maxAge: Math.max(0, Math.floor((session.expires - Date.now()) / 1000)),
      });
    }
    if (!session) {
      const token = randomBytes(32).toString('base64url');
      const sessionHash = hash(token);
      store.createSession(sessionHash, '乐友');
      session = store.getSession(sessionHash)!;
      reply.setCookie(sessionCookieName, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.production,
        path: '/',
        maxAge: 7 * 86400,
      });
    }
    request.sessionHash = session.id;
    if (
      (config.localOnly ||
        config.production ||
        !['127.0.0.1', '::1', 'localhost'].includes(config.host)) &&
      !config.playtest &&
      qq.configured &&
      /^\/api\/rooms(?:\/|$)/.test(request.url)
    ) {
      const auth = store.getAuth(session.id);
      if (
        !auth ||
        (config.localOnly && auth.provider !== 'embedded-qq') ||
        (auth.expiresAt <= Date.now() && !auth.refreshToken)
      )
        throw new AppError(401, '请先登录 QQ 音乐', 'QQ_LOGIN_REQUIRED');
    }
    const existing = request.url
      .split('?')[0]!
      .match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (
      config.localOnly &&
      existing &&
      existing[1] !== 'join' &&
      !rooms.get(existing[1]!).bot
    )
      throw new AppError(
        503,
        '原公网服务器已下线，目前缺少对战服务器，双人对战暂不可用；人机练习仍在设置中。',
        'MULTIPLAYER_UNAVAILABLE',
      );
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      reply.code(400).send({
        error: {
          code: 'INVALID_INPUT',
          message: error.issues[0]?.message || '输入不合法',
        },
      });
      return;
    }
    if (error instanceof AppError) {
      reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
      return;
    }
    const status =
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    // Never log a request body, upstream URL, cookies or upstream auth response.
    if (status >= 500)
      app.log.error(
        {
          event: 'request_failed',
          name: error instanceof Error ? error.name : 'unknown',
        },
        'Request failed',
      );
    reply.code(status).send({
      error: {
        code: 'SERVER_ERROR',
        message:
          status === 429
            ? '请求较多，请稍后重试'
            : status < 500
              ? '请求格式不受支持'
              : '服务器处理失败，请查看不含敏感信息的服务日志',
      },
    });
  });
  const context = (r: FastifyRequest) => musicAuth.context(r.sessionHash, r.ip);
  const admin = (r: FastifyRequest) => {
    if (
      !secretEqual(
        (r.headers.authorization || '').replace(/^Bearer /, ''),
        config.adminToken,
      )
    )
      throw new AppError(
        401,
        config.adminToken
          ? '管理令牌不正确'
          : '请先在服务端 .env 设置 ADMIN_TOKEN',
        'ADMIN_REQUIRED',
      );
  };
  // 内建曲库同时服务两种场景：开发用的测试数据，以及产品内的人机练习。
  // 关掉 ENABLE_FIXTURES 只是不再暴露测试数据，练习曲库仍然可用。
  const fixture = () => {
    if (!config.fixtures && !config.practice)
      throw new AppError(403, '服务端已关闭本地测试数据');
  };
  const getSong = async (
    mode: 'fixture' | 'qq',
    songId: string,
    r: FastifyRequest,
  ): Promise<Song> => {
    if (mode === 'qq') return qq.gameSong(songId, await context(r));
    fixture();
    const catalog = livePractice
      ? await practiceLibrary.list(r.sessionHash, await context(r))
      : SONGS;
    const song = catalog.find((s) => s.id === songId);
    if (!song) throw new AppError(404, '测试曲目不存在');
    return song;
  };
  app.get('/api/health', () => ({
    ok: true,
    version: APP_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
    storage: 'sqlite',
  }));
  app.get('/api/ready', (_request, reply) => {
    try {
      store.db.prepare('SELECT 1 FROM rooms LIMIT 1').get();
      return { ok: true, version: APP_VERSION, storage: 'readable' };
    } catch {
      return reply.code(503).send({ ok: false, storage: 'unavailable' });
    }
  });
  app.get('/api/meta', () => ({
    protocol: PROTOCOL_VERSION,
    playtest: Boolean(config.playtest),
    fixtures: config.fixtures,
    developer: developerEnabled,
    qqConfigured: qq.configured,
    qrConfigured: qq.configured,
    practice: config.practice,
    webLoginConfigured: musicAuth.webConfigured,
    appVersion: APP_VERSION,
    capabilities: (config.playtest ? [] : Object.entries(CAPABILITIES)).map(
      ([id, c]) => ({
        id,
        title: c.title,
        login: c.login,
      }),
    ),
  }));
  app.get('/api/session', async (request) => {
    const user = store.getSession(request.sessionHash)!;
    const auth = store.getAuth(user.id);
    let nickname = user.nickname || undefined;
    let avatar = user.avatar || undefined;
    // 已授权但还没资料时补取一次并落库；失败不影响登录态，也不会触碰 refresh 流程。
    const fresh =
      auth &&
      (!config.localOnly || auth.provider === 'embedded-qq') &&
      auth.expiresAt > Date.now() + 60000;
    const lastTry = profileAttempts.get(user.id) ?? 0;
    if (fresh && (!nickname || !avatar) && Date.now() - lastTry > 300000) {
      profileAttempts.set(user.id, Date.now());
      try {
        const data = await qq.call(
          'fcg_music_custom_get_account_info.fcg',
          {},
          {
            ip: request.ip,
            device: request.sessionHash.slice(0, 32),
            auth,
          },
        );
        // Ignore an old account's response after logout or a newer authorization.
        if (store.getAuth(user.id)?.accessToken === auth.accessToken) {
          const info = object(data.user_info);
          nickname = text(info.nickname) || nickname;
          avatar = coverUrl(info.headimgurl) || avatar;
          if (nickname || avatar) {
            store.setProfile(user.id, nickname, avatar);
            profileAttempts.delete(user.id);
          }
          // 默认称呼「乐友」直接换成真实昵称；玩家手动改过就保留。
          if (nickname && store.getSession(user.id)?.name === '乐友') {
            store.setName(user.id, nickname);
            user.name = nickname;
          }
        }
      } catch {
        // 上游不可用时保持匿名展示，五分钟后再试。
      }
    }
    const current = store.getSession(user.id)!;
    const currentAuth = store.getAuth(user.id);
    return {
      name: current.name,
      nickname: current.nickname || undefined,
      avatar: current.avatar || undefined,
      qqAuthorized: Boolean(
        currentAuth &&
        (!config.localOnly || currentAuth.provider === 'embedded-qq') &&
        (currentAuth.expiresAt > Date.now() || currentAuth.refreshToken),
      ),
      expiresAt: currentAuth?.expiresAt,
    };
  });
  app.post('/api/session', (request) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(24) })
      .strict()
      .parse(request.body);
    store.setName(request.sessionHash, name);
    return { name };
  });
  app.get('/api/music/search', async (request) => {
    const { mode, q } = z
      .object({ mode: modeSchema, q: z.string().trim().max(100).default('') })
      .parse(request.query);
    const summary = (s: Song) => ({
      id: s.id,
      title: s.title,
      artists: s.artists,
      album: s.album,
      provider: s.provider,
      cover: s.cover,
      albumId: s.albumId,
      albumMid: s.albumMid,
      providerMid: s.providerMid,
      year: s.year,
      duration: s.duration,
    });
    if (mode === 'fixture') {
      fixture();
      const catalog = livePractice
        ? await practiceLibrary.list(
            request.sessionHash,
            await context(request),
          )
        : SONGS;
      return {
        provider: mode,
        songs: catalog
          .filter((s) => !q || [s.title, ...s.artists].join(' ').includes(q))
          .map(summary),
      };
    }
    if (!q) return { provider: mode, songs: [] };
    return {
      provider: mode,
      songs: (await qq.search(q, await context(request))).map(summary),
    };
  });
  app.get('/api/music/song', async (request) => {
    const input = z.object({ mode: modeSchema, id }).parse(request.query);
    return { song: await getSong(input.mode, input.id, request) };
  });
  app.get('/api/music/album', async (request) => {
    const { mid } = z.object({ mid: id }).parse(request.query);
    const data = await qq.call(
      'fcg_music_custom_get_album_detail.fcg',
      { album_mid: mid, page: 0, size: 1, fav_state: 0 },
      await context(request),
    );
    return {
      title: text(data.album_name),
      description: text(data.album_desc),
      releaseDate: text(data.public_time),
      cover: coverUrl(data.album_pic_300x300 || data.album_pic),
    };
  });
  app.get('/api/music/profile', async (request) => {
    const ctx = await context(request);
    if (!ctx.auth)
      throw new AppError(401, '请先授权 QQ 音乐', 'QQ_LOGIN_REQUIRED');
    const data = await qq.call(
      'fcg_music_custom_get_account_info.fcg',
      {},
      ctx,
    );
    const profile = object(data.user_info);
    return {
      nickname: text(profile.nickname),
      avatar: coverUrl(profile.headimgurl),
    };
  });
  app.get(
    '/api/music/lyrics',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const query = z.object({ id }).parse(request.query);
      return fullLyrics(qq, query.id, await context(request));
    },
  );
  app.get('/api/music/me', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return personalProfile(qq, await context(request));
  });
  app.get(
    '/api/music/me/library',
    { config: { rateLimit: { max: 24, timeWindow: '1 minute' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const query = z
        .object({
          kind: z.enum([
            'playlists',
            'playlist',
            'likes',
            'recent',
            'albums',
            'follows',
            'daily',
          ]),
          offset: z.coerce.number().int().min(0).max(10000).default(0),
          playlistId: z
            .string()
            .regex(/^\d{1,20}$/)
            .optional(),
        })
        .parse(request.query);
      return personalLibrary(
        qq,
        await context(request),
        query.kind,
        query.offset,
        query.playlistId,
      );
    },
  );
  app.get(
    '/api/music/inspect',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request) => {
      const { id: songId } = z.object({ id }).parse(request.query);
      return inspectMusic(qq, songId, await context(request));
    },
  );
  app.get(
    '/api/music/official-associations',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const query = z.object({ id }).parse(request.query);
      const { song } = await qq.detail(query.id, {
        ip: request.ip,
        device: 'official-association-identity',
      });
      return qq.officialScenes.get(
        song.providerMid || '',
        song.providerId || '',
      );
    },
  );
  registerMusicAuth(app, musicAuth);
  app.post('/api/music/playback', async (request) => {
    const { songId } = z.object({ songId: id }).strict().parse(request.body);
    const ctx = await context(request);
    const { raw, trace, song } = await qq.detail(songId, ctx);
    const resource = webPlaybackResource(raw);
    if (!resource)
      throw new AppError(
        403,
        qq.message({
          msg:
            text(raw.unplayable_msg) ||
            (number(raw.playable) === 1
              ? '账号有播放权益，但当前资源需要官方播放器 SDK；本次没有浏览器可直接播放的音频。'
              : '') ||
            '此用户 / 应用当前没有这首歌的可用播放权限',
        }),
        'NOT_PLAYABLE',
      );
    const grantId = randomBytes(18).toString('base64url');
    // Store only report metadata in RAM; never cache/persist an upstream playback URL.
    if (grants.size > 1000)
      throw new AppError(429, '当前播放会话较多，请稍后重试');
    grants.set(grantId, {
      session: request.sessionHash,
      songId: song.providerId || '',
      mid: song.providerMid || '',
      trace,
      quality: resource.quality,
      duration: number(raw.song_play_time),
      created: Date.now(),
      reported: false,
    });
    return {
      grantId,
      url: resource.url,
      preview: resource.preview,
      format: resource.format,
      requiresDecoding: resource.requiresDecoding || false,
      note: resource.requiresDecoding
        ? `QQ 音乐返回完整 ${resource.format?.toUpperCase() || '音频'} 资源，需解码后播放。`
        : native && resource.preview
          ? 'QQ 音乐本次仅返回试听片段，未返回可用的完整资源。'
          : resource.fullNeedsSdk
            ? '当前为官方试听。账号已具备完整收听权益，本站完整播放尚待接入官方方案。'
            : '',
      expiresInSeconds: number(raw.vkeyLeftSec),
      song: { title: song.title, artists: song.artists },
    };
  });
  // Same-origin binary response: no song ID, title, upstream URL or ID3 metadata.
  const previewBusy = new Set<string>();
  const previewSources = new PreviewSources();
  const preparePreview = async (
    request: FastifyRequest,
    reply: import('fastify').FastifyReply,
  ) => {
    const room = rooms.get(roomId(request)),
      seat = rooms.seat(room, request.sessionHash);
    if (
      (room.mode !== 'qq' &&
        !(
          room.mode === 'fixture' &&
          room.players[seat === 'a' ? 'b' : 'a']?.song?.providerMid
        )) ||
      !room.game ||
      room.game.phase === 'finished' ||
      room.game.players[seat].previewSegments < 1 ||
      room.game.players[seat].effects.hideCluesUntilRound >= room.game.round
    )
      throw new AppError(403, '尚未获得对局试听信息', 'PREVIEW_LOCKED');
    if (previewBusy.has(request.sessionHash) || previewBusy.size >= 4)
      throw new AppError(429, '试听正在载入，请稍后再试');
    previewBusy.add(request.sessionHash);
    try {
      const song = room.players[seat === 'a' ? 'b' : 'a']!.song!;
      const identity =
        song.provider === 'fixture'
          ? 'qq:' + (song.providerMid || song.providerId)
          : song.id;
      const { raw, trace } = await qq.detail(identity, await context(request));
      const url = officialPreview(raw);
      if (!url)
        throw new AppError(
          403,
          '你的官方试听资源暂时不可用，请在首页授权 QQ 音乐后重试；无需使用对方账号。',
          'PREVIEW_REQUIRED',
        );
      let audio: Buffer;
      try {
        audio = await fetchPreview(
          url,
          options.fetch,
          Math.min(60, room.game.players[seat].previewSegments * 10),
        );
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(
          502,
          '官方试听暂时无法载入，请稍后重试',
          'PREVIEW_UNAVAILABLE',
        );
      }
      // Re-check membership/availability after async upstream work.
      const latest = rooms.get(room.id);
      rooms.seat(latest, request.sessionHash);
      if (
        !latest.game ||
        latest.match?.id !== room.match?.id ||
        latest.game.players[seat].effects.hideCluesUntilRound >=
          latest.game.round ||
        latest.game.players[seat].previewSegments <
          room.game.players[seat].previewSegments
      )
        throw new AppError(409, '对局或信息权限已变更，请重新请求');
      if (latest.game?.phase === 'finished')
        throw new AppError(409, '对局已结束，请在揭晓页面试听');
      if (grants.size > 1000)
        throw new AppError(429, '当前试听会话较多，请稍后重试');
      const grantId = randomBytes(18).toString('base64url');
      grants.set(grantId, {
        session: request.sessionHash,
        songId: song.providerId || '',
        mid: song.providerMid || '',
        trace,
        quality: 10,
        duration: Math.min(60, room.game.players[seat].previewSegments * 10),
        created: Date.now(),
        reported: false,
      });
      if (request.url.split('?')[0]!.endsWith('/preview-source')) {
        const source = previewSources.put({
          session: request.sessionHash,
          roomId: room.id,
          matchId: latest.match!.id!,
          segments: room.game.players[seat].previewSegments,
          authKey: digest(store.getAuth(request.sessionHash) || null),
          audio,
        });
        if (!source) throw new AppError(429, '试听资源暂时较多，请稍后重试');
        return {
          src:
            '/api/rooms/' +
            encodeURIComponent(room.id) +
            '/preview-source/' +
            source.id,
          grantId,
          expiresAt: source.expiresAt,
          seconds: Math.min(60, room.game.players[seat].previewSegments * 10),
        };
      }
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Listen-Grant', grantId)
        .type('audio/mpeg')
        .send(audio);
    } finally {
      previewBusy.delete(request.sessionHash);
    }
  };
  app.post(
    '/api/rooms/:id/preview',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    preparePreview,
  );
  app.post(
    '/api/rooms/:id/preview-source',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    preparePreview,
  );
  app.get('/api/rooms/:id/preview-source/:source', async (request, reply) => {
    const params = z
      .object({ id, source: z.string().regex(/^[A-Za-z0-9_-]{32}$/) })
      .parse(request.params);
    const cached = previewSources.get(params.source, request.sessionHash);
    if (!cached || cached.roomId !== params.id)
      throw new AppError(404, '试听已过期，请重新点击播放', 'PREVIEW_EXPIRED');
    const room = rooms.get(params.id),
      seat = rooms.seat(room, request.sessionHash);
    if (
      (room.mode !== 'qq' &&
        !(
          room.mode === 'fixture' &&
          room.players[seat === 'a' ? 'b' : 'a']?.song?.providerMid
        )) ||
      !room.game ||
      room.game.phase === 'finished' ||
      room.match?.id !== cached.matchId ||
      room.game.players[seat].previewSegments < cached.segments ||
      room.game.players[seat].effects.hideCluesUntilRound >= room.game.round ||
      digest(store.getAuth(request.sessionHash) || null) !== cached.authKey
    )
      throw new AppError(403, '试听权限已变化，请重新获取', 'PREVIEW_LOCKED');
    const range = byteRange(request.headers.range, cached.audio.length);
    reply
      .header('Cache-Control', 'private, no-store')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('Accept-Ranges', 'bytes')
      .type('audio/mpeg');
    if (range === null)
      return reply
        .code(416)
        .header('Content-Range', 'bytes */' + cached.audio.length)
        .send();
    if (range)
      return reply
        .code(206)
        .header(
          'Content-Range',
          `bytes ${range.start}-${range.end}/${cached.audio.length}`,
        )
        .send(cached.audio.subarray(range.start, range.end + 1));
    return reply.send(cached.audio);
  });
  app.post('/api/music/listen', async (request) => {
    const input = z
      .object({
        grantId: id,
        seconds: z.number().int().min(0).max(86400),
        ended: z.boolean(),
      })
      .strict()
      .parse(request.body);
    const grant = grants.get(input.grantId);
    if (!grant || grant.session !== request.sessionHash)
      throw new AppError(404, '播放上报会话已失效');
    if (native) {
      grant.reported = true;
      return { ok: true, reported: false };
    }
    if (grant.reported) return { ok: true, replayed: true };
    if (grant.reporting) {
      await grant.reporting;
      return { ok: true, replayed: true };
    }
    const seconds = Math.min(
      input.seconds,
      Math.floor((Date.now() - grant.created) / 1000),
      grant.duration || 86400,
    );
    grant.reporting = (async () => {
      await qq.call(
        'fcg_music_monitor_song_listen.fcg',
        {
          media_type: 1,
          media_id: grant.songId || 0,
          media_mid: grant.mid,
          play_time: seconds,
          play_quality: grant.quality,
          from: 7,
          opi_device_id: request.sessionHash.slice(0, 32),
          traceId: grant.trace,
          action_type:
            grant.quality === 10 ? (input.ended ? 4 : 3) : input.ended ? 2 : 1,
        },
        await context(request),
        { monitor: true },
      );
      grant.reported = true;
    })();
    try {
      await grant.reporting;
      return { ok: true };
    } finally {
      grant.reporting = undefined;
    }
  });
  app.post(
    '/api/rooms',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { mode, bot } = z
        .object({ mode: modeSchema, bot: z.boolean().default(false) })
        .strict()
        .parse(request.body);
      if (config.localOnly && !bot)
        throw new AppError(
          503,
          '原公网服务器已下线，目前缺少对战服务器，双人对战暂不可用；人机练习仍在设置中。',
          'MULTIPLAYER_UNAVAILABLE',
        );
      if (mode === 'fixture') {
        fixture();
        if (bot && !config.practice) throw new AppError(403, '人机练习已关闭');
        if (livePractice)
          await practiceLibrary.list(
            request.sessionHash,
            await context(request),
          );
      } else if (!qq.configured)
        throw new AppError(503, '请先配置 QQ 音乐密钥');
      return rooms.create(
        request.sessionHash,
        store.getSession(request.sessionHash)!.name,
        mode,
        bot,
      );
    },
  );
  app.post(
    '/api/rooms/join',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    (request) => {
      if (config.localOnly)
        throw new AppError(
          503,
          '目前缺少对战服务器，双人对战暂不可用。',
          'MULTIPLAYER_UNAVAILABLE',
        );
      const { code } = z
        .object({
          code: z
            .string()
            .trim()
            .toUpperCase()
            .regex(
              /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/,
              '请输入 8 位房间号',
            ),
        })
        .strict()
        .parse(request.body);
      return {
        room: rooms.joinByCode(
          code,
          request.sessionHash,
          store.getSession(request.sessionHash)!.name,
        ),
      };
    },
  );
  app.post('/api/rooms/:id/join', (request) => {
    if (config.localOnly)
      throw new AppError(
        503,
        '目前缺少对战服务器，双人对战暂不可用。',
        'MULTIPLAYER_UNAVAILABLE',
      );
    const { invite } = z
      .object({ invite: z.string().min(20).max(100) })
      .strict()
      .parse(request.body);
    return {
      room: rooms.join(
        roomId(request),
        invite,
        request.sessionHash,
        store.getSession(request.sessionHash)!.name,
      ),
    };
  });
  app.get('/api/rooms/:id', (request) => {
    const room = rooms.get(roomId(request));
    return { room: rooms.view(room, request.sessionHash) };
  });
  app.post('/api/rooms/:id/invite', (request) => ({
    invite: rooms.invite(roomId(request), request.sessionHash),
  }));
  app.post('/api/rooms/:id/song', async (request) => {
    const { songId, version, ready } = z
      .object({
        songId: id,
        version: z.number().int().nonnegative(),
        ready: z.boolean().optional(),
      })
      .strict()
      .parse(request.body);
    const room = rooms.get(roomId(request));
    rooms.seat(room, request.sessionHash);
    rooms.version(room, version);
    if (room.game) throw new AppError(409, '开局后不能更换底牌');
    const song = await getSong(room.mode, songId, request);
    if (room.mode === 'qq') {
      const { raw } = await qq.detail(song.id, await context(request));
      if (!officialPreview(raw))
        throw new AppError(
          403,
          '此曲当前没有可用的官方 MP3 试听，暂不可作为底牌。可先授权 QQ 音乐后重试，或换一首歌曲；需要额外购买的资源暂不使用。',
          'PREVIEW_REQUIRED',
        );
      song.previewAvailable = true;
      const missing = missingGameFacts(song);
      if (missing.length)
        throw new AppError(
          422,
          '此曲资料不完整，暂不能作为底牌。缺少：' + missing.join('、'),
          'SONG_INCOMPLETE',
        );
    }
    return {
      room: rooms.select(room.id, request.sessionHash, song, version, ready),
    };
  });
  app.post('/api/rooms/:id/swap', (request) => {
    const input = z.object({ version }).strict().parse(request.body);
    return {
      room: rooms.requestSwap(
        roomId(request),
        request.sessionHash,
        input.version,
      ),
    };
  });
  app.post('/api/rooms/:id/swap/respond', (request) => {
    const input = z
      .object({ version, accept: z.boolean() })
      .strict()
      .parse(request.body);
    return {
      room: rooms.respondSwap(
        roomId(request),
        request.sessionHash,
        input.accept,
        input.version,
      ),
    };
  });
  app.post('/api/rooms/:id/rules', (request) => {
    const input = z
      .object({ version, rules: rulesSchema })
      .strict()
      .parse(request.body);
    return {
      room: rooms.rules(
        roomId(request),
        request.sessionHash,
        input.rules,
        input.version,
      ),
    };
  });
  app.post('/api/rooms/:id/developer', (request) => {
    fixture();
    return rooms.develop(
      roomId(request),
      request.sessionHash,
      developerCommandSchema.parse(request.body),
    );
  });
  app.post('/api/rooms/:id/rematch', async (request) => {
    const input = z.object({ version }).strict().parse(request.body);
    return {
      room: rooms.rematch(roomId(request), request.sessionHash, input.version),
    };
  });
  app.post('/api/rooms/:id/avatar', async (request) => {
    const room = rooms.get(roomId(request));
    rooms.seat(room, request.sessionHash);
    const ctx = await context(request);
    if (!ctx.auth) return { updated: false };
    const data = await qq.call(
      'fcg_music_custom_get_account_info.fcg',
      {},
      ctx,
    );
    const avatar = coverUrl(object(data.user_info).headimgurl);
    rooms.setAvatar(room.id, request.sessionHash, avatar);
    return { updated: !!avatar };
  });
  app.post(
    '/api/rooms/:id/start',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request) => {
      const input = z.object({ version }).strict().parse(request.body);
      const room = rooms.get(roomId(request));
      rooms.version(room, input.version);
      rooms.assertCanStart(room, request.sessionHash);
      if (!room.players.a?.ready || !room.players.b?.ready)
        throw new AppError(409, '双方需要先选好底牌并确认当前规则');
      if (room.mode === 'qq') {
        if (
          Object.values(room.players).some(
            (p) => missingGameFacts(p!.song!).length,
          )
        )
          throw new AppError(
            422,
            '有底牌缺少新版必需资料，请双方重新选歌。',
            'SONG_INCOMPLETE',
          );
        // Separate user contexts; never borrow the selecting player's entitlements.
        for (const side of ['a', 'b'] as const) {
          const player = room.players[side]!;
          const ctx = await musicAuth.context(player.session, request.ip);
          for (const song of new Map(
            Object.values(room.players).map((p) => [p!.song!.id, p!.song!]),
          ).values()) {
            let available = false;
            try {
              available = !!officialPreview(
                (await qq.detail(song.id, ctx)).raw,
              );
            } catch {
              throw new AppError(
                502,
                '暂时无法核验双方试听资源，请稍后重试。',
                'PREVIEW_CHECK_FAILED',
              );
            }
            if (!available)
              throw new AppError(
                403,
                '尚有歌曲未能通过双方试听校验。请各自授权 QQ 音乐后重试，或更换底牌；不会公布对方歌名及账户权益。',
                'SHARED_PREVIEW_REQUIRED',
              );
          }
        }
      }
      return {
        room: rooms.start(roomId(request), request.sessionHash, input.version),
      };
    },
  );
  app.post('/api/rooms/:id/ready', (request) => {
    const input = z
      .object({ version, ready: z.boolean().optional() })
      .strict()
      .parse(request.body);
    return {
      room: rooms.ready(
        roomId(request),
        request.sessionHash,
        input.version,
        input.ready,
      ),
    };
  });
  app.post('/api/rooms/:id/action', (request) =>
    rooms.act(
      roomId(request),
      request.sessionHash,
      commandSchema.parse(request.body),
    ),
  );
  app.get(
    '/api/rooms/:id/socket',
    {
      websocket: true,
      preValidation: async (request) => {
        if (
          !request.headers.origin ||
          !config.origins.includes(request.headers.origin)
        )
          throw new AppError(403, 'WebSocket 来源不合法');
        rooms.seat(rooms.get(roomId(request)), request.sessionHash);
      },
    },
    (socket, request) => {
      // A resource ceiling, not a tested concurrent-player capacity promise.
      if (sockets.size >= 256) {
        socket.close(1013, '连接数达到上限，请稍后重试');
        return;
      }
      const connection = {
        alive: true,
        session: request.sessionHash,
        roomId: roomId(request),
      };
      sockets.set(socket, connection);
      socket.on('pong', () => {
        connection.alive = true;
      });
      socket.on('close', () => sockets.delete(socket));
      socket.on('message', (data) => {
        if (data.toString() === 'ping')
          socket.send(JSON.stringify({ type: 'pong' }));
      });
      rooms.connect(roomId(request), request.sessionHash, socket);
    },
  );
  app.get('/api/admin/status', (request) => {
    admin(request);
    return {
      qqConfigured: qq.configured,
      qrConfigured: qq.configured,
      webLoginConfigured: musicAuth.webConfigured,
      qrPackageConfigured: Boolean(config.qqPackage),
      appIdSuffix: config.qqAppId ? `…${config.qqAppId.slice(-4)}` : '',
      fixtures: config.fixtures,
      memoryRssMiB: Math.round(process.memoryUsage().rss / 1048576),
      probes: store.probes(),
      knownLimitations: [
        '歌曲百科字段的内容覆盖尚未确认',
        '移动端 H5 授权需结合平台登记的回调配置；当前实现扫码 OAuth',
        '具体权限以本应用与当前用户的实际探测结果为准',
      ],
    };
  });
  app.post(
    '/api/admin/probe',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request) => {
      admin(request);
      const input = z
        .object({
          capability: z.enum(
            Object.keys(CAPABILITIES) as [Capability, ...Capability[]],
          ),
          query: z.string().max(100).optional(),
          songMid: id.optional(),
          songId: z.string().regex(/^\d+$/).max(24).optional(),
          albumMid: id.optional(),
          singerMid: id.optional(),
        })
        .strict()
        .parse(request.body);
      const result = await probe(
        qq,
        input.capability,
        {
          query: input.query || '',
          songMid: input.songMid || '',
          songId: input.songId || '',
          albumMid: input.albumMid || '',
          singerMid: input.singerMid || '',
        },
        await context(request),
      );
      store.saveProbe(result);
      return { result };
    },
  );
  const clientRoot = resolve(config.clientRoot || 'dist/client');
  if (existsSync(clientRoot)) {
    await app.register(staticFiles, {
      root: clientRoot,
      // 必须是通配路由：wildcard:false 会在启动时把当时的文件清单登记成固定路由，
      // 之后换了构建产物（index-<新哈希>.css）就整片 404，浏览器拿到的还是 JSON，
      // 表现为「Refused to apply style ... MIME type application/json」＋白屏。
      wildcard: true,
      setHeaders(response, path) {
        const pathname = '/' + relative(clientRoot, path).split(sep).join('/');
        const expected = assetVersions[pathname as keyof typeof assetVersions];
        const supplied = new URL(
          response.request.url,
          'http://local.invalid',
        ).searchParams.get('v');
        const versioned = Boolean(expected && expected === supplied);
        // Only content-addressed resources can be immutable; unversioned URLs still revalidate.
        response.header(
          'Cache-Control',
          versioned ||
            /[\\/]assets[\\/].+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
    app.setNotFoundHandler((request, reply) =>
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      !request.url.includes('.')
        ? reply.sendFile('index.html')
        : reply
            .code(404)
            .send({ error: { code: 'NOT_FOUND', message: '路径不存在' } }),
    );
  }
  const heartbeat = setInterval(() => {
    for (const [socket, connection] of sockets) {
      if (
        !connection.alive ||
        !store.getSession(connection.session) ||
        !store.hasRoom(connection.roomId)
      ) {
        socket.terminate();
        sockets.delete(socket);
      } else {
        connection.alive = false;
        if (socket.readyState === 1) socket.ping();
      }
    }
    previewSources.prune();
    for (const [key, grant] of grants)
      if (grant.created + 3600000 < Date.now()) grants.delete(key);
    for (const [session, time] of profileAttempts)
      if (time < Date.now() - 300000) profileAttempts.delete(session);
    store.prune();
  }, 25000);
  heartbeat.unref();
  app.addHook('preClose', async () => {
    clearInterval(heartbeat);
    rooms.close();
  });
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    rooms.close();
    await native?.close();
    store.close();
  });
  return { app, store, rooms, qq, config };
}
