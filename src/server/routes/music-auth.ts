import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MusicAuth } from '../music/auth';
import { AppError } from '../errors';
import { QQError } from '../music/qq';
import { parseWebAuthResult, webAuthEnvelope } from '../music/auth-callback';
import {
  authReturnPage,
  authReturnTarget,
  validAuthReturnTarget,
} from '../music/auth-return';

function callbackShape(payload: unknown) {
  try {
    const outer = webAuthEnvelope(
      typeof payload === 'string' ? payload : '',
    ) as Record<string, unknown>;
    const encrypted = outer?.encryptString;
    let inner = typeof encrypted === 'object' ? encrypted : undefined;
    if (typeof encrypted === 'string' && encrypted.trim().startsWith('{'))
      try {
        inner = JSON.parse(encrypted);
      } catch {
        /* Shape only. */
      }
    return {
      ret: typeof outer?.ret === 'number' ? outer.ret : undefined,
      encryptedType: typeof encrypted,
      outerKeys: Object.keys(outer || {}).filter((k) =>
        ['ret', 'encryptString', 'code', 'state', 'errorMsg'].includes(k),
      ),
      innerKeys: Object.keys(inner || {}).filter((k) =>
        ['code', 'state'].includes(k),
      ),
    };
  } catch {
    return { encryptedType: 'invalid-json' };
  }
}

/** Only authorization results pass through this route; access tokens stay in the encrypted store. */
export function registerMusicAuth(app: FastifyInstance, auth: MusicAuth) {
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  app.post('/api/music/auth/qr', limit, (request) =>
    auth.qr(request.sessionHash, request.ip),
  );
  app.post('/api/music/auth/poll', (request) =>
    auth.poll(request.sessionHash, request.ip),
  );
  app.post('/api/music/auth/web', limit, (request) => {
    const { returnTo, nativeReturn, channel } = z
      .object({
        returnTo: z.string().max(1000).optional(),
        nativeReturn: z.boolean().optional(),
        channel: z.enum(['all', 'qq']).optional(),
      })
      .strict()
      .parse(request.body);
    return auth.web(
      request.sessionHash,
      request.headers.origin || '',
      returnTo,
      Boolean(nativeReturn),
      authReturnTarget(
        request.headers['user-agent'] || '',
        Boolean(nativeReturn),
      ),
      channel,
    );
  });
  app.get('/api/music/auth/web/callback', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer');
    let stage = 'parse';
    let state: string | undefined;
    try {
      // Existing APKs already accept hiddentrack://oauth?resume=1. Only their
      // original Cookie session may exchange its previously deferred result.
      if ((request.query as Record<string, unknown>).resume === '1') {
        const result = await auth.completeWeb(request.sessionHash, request.ip);
        return reply.redirect(
          result.status === 'authorized'
            ? result.returnTo || '/'
            : '/?login=resume',
        );
      }
      const query = z
        .object({
          p: z.string().max(8000),
          state: z.string().max(100).optional(),
        })
        .parse(request.query);
      state = query.state;
      const result = parseWebAuthResult(query.p, query.state);
      state = result.state;
      stage = 'exchange';
      // 官方回调可能只把 state 放在 encryptString 里、不单独作为 query 参数；
      // 单独参数存在且不一致才视为失败。
      if (query.state && result.state !== query.state)
        return reply.redirect('/?login=failed');
      const { returnPath } = await auth.receiveWebCallback(
        request.sessionHash,
        result.state,
        result.code,
        request.ip,
      );
      return reply.redirect(returnPath);
    } catch (error) {
      const query = request.query as Record<string, unknown>;
      const reason =
        error instanceof AppError ? error.code : 'INVALID_CALLBACK';
      request.log.warn(
        {
          event: 'web_auth_callback_failed',
          stage,
          reason,
          providerRet: error instanceof QQError ? error.qqCode : undefined,
          hasSessionCookie: request.sessionWasExisting,
          queryKeys: Object.keys(query).filter((key) =>
            ['p', 'state', 'code', 'param'].includes(key),
          ),
          payloadLength: typeof query.p === 'string' ? query.p.length : 0,
          ...callbackShape(query.p),
          ...auth.diagnostics(request.sessionHash, state),
        },
        'Web authorization did not complete',
      );
      // Shape and reason only: never log prefixes, escaped JSON, credentials or provider messages.
      return reply.redirect('/?login=failed');
    }
  });
  app.post('/api/music/auth/web/complete', (request) =>
    auth.completeWeb(request.sessionHash, request.ip),
  );
  app.get('/auth/complete', (request, reply) => {
    const target = validAuthReturnTarget(
      (request.query as Record<string, unknown>).target,
    );
    const origin = auth.allowedReturnOrigin(request.headers.host || '');
    return reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .type('text/html; charset=utf-8')
      .send(authReturnPage(origin, target));
  });
  app.post('/api/music/auth/logout', (request) => {
    auth.logout(request.sessionHash);
    return { ok: true };
  });
}
