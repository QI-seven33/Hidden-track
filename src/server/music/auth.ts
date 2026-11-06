import { randomBytes } from 'node:crypto';
import { QQMusic, object, text, number, parseUpstreamJSON } from './qq';
import { Store, type QQAuth } from '../store';
import { AppError } from '../errors';
import { loginReturnPath } from './auth-callback';
import { validAuthReturnTarget, type AuthReturnTarget } from './auth-return';
type Context = { ip: string; device: string; auth?: QQAuth };
export class MusicAuth {
  private flows = new Map<
    string,
    {
      code: string;
      expires: number;
      state: string;
      lastPoll: number;
      busy: boolean;
    }
  >();
  private webExchanges = new Map<string, Promise<{ returnPath: string }>>();
  private refreshing = new Map<string, Promise<QQAuth>>();
  constructor(
    private store: Store,
    private qq: QQMusic,
  ) {}
  async context(session: string, ip: string): Promise<Context> {
    if (this.qq.native) return this.qq.native.context(session, ip);
    let auth = this.store.getAuth(session);
    if (auth && auth.expiresAt < Date.now() + 60000) {
      if (!auth.refreshToken) {
        this.store.setAuth(session, null);
        return { ip, device: session.slice(0, 32) };
      }
      let promise = this.refreshing.get(session);
      if (!promise) {
        promise = this.exchange(
          session,
          { ip, device: session.slice(0, 32) },
          { cmd: 'refreshToken', qqmusic_refresh_token: auth.refreshToken },
          () => this.store.getAuth(session)?.accessToken === auth?.accessToken,
        );
        this.refreshing.set(session, promise);
        promise.finally(() => this.refreshing.delete(session)).catch(() => {});
      }
      try {
        auth = await promise;
      } catch (error) {
        // A timeout or busy upstream must not destroy a refreshable login.
        if (error instanceof AppError && error.status === 401) {
          if (this.store.getAuth(session)?.accessToken === auth?.accessToken)
            this.store.setAuth(session, null);
          throw new AppError(
            401,
            'QQ 音乐授权已过期，请重新登录',
            'QQ_LOGIN_REQUIRED',
          );
        }
        throw error;
      }
    }
    return { ip, device: session.slice(0, 32), auth };
  }
  async qr(session: string, ip: string) {
    if (this.qq.native) return this.qq.native.qr(session);
    // Documentation lists a registered package, but this competition app's QR
    // endpoint accepts an empty package. Let the upstream validate its policy.
    for (const [key, flow] of this.flows)
      if (flow.expires < Date.now()) this.flows.delete(key);
    if (this.flows.size >= 100 && !this.flows.has(session))
      throw new AppError(429, '授权请求过多，请稍后重试');
    const state = randomBytes(24).toString('base64url');
    const flow = {
      code: '',
      expires: Date.now() + 600_000,
      state,
      lastPoll: 0,
      busy: true,
    };
    this.store.deleteWebAuthFlow(session);
    this.flows.set(session, flow);
    let data;
    try {
      data = await this.qq.call(
        'fcg_music_custom_sdk_get_qr_code.fcg',
        {
          qqmusic_open_appid: this.qq.config.qqAppId,
          qqmusic_package_name: this.qq.config.qqPackage,
          qqmusic_dev_name: 'Music Card H5',
          qqmusic_qrcode_type: 'universal',
          qqmusic_encrypt_auth: JSON.stringify({
            response_type: 'code',
            state,
          }),
        },
        { ip, device: session.slice(0, 32) },
      );
    } catch (error) {
      if (this.flows.get(session) === flow) this.flows.delete(session);
      throw error;
    }
    if (this.flows.get(session) !== flow)
      throw new AppError(401, '本次授权已取消', 'QQ_AUTH_CANCELLED');
    const code = text(data.auth_code),
      url = text(data.sdk_qr_code);
    if (!code || !/^https:\/\//.test(url)) {
      this.flows.delete(session);
      throw new AppError(502, '授权二维码响应缺少必要字段');
    }
    const expires =
      Date.now() +
      Math.min(number(data.qrcode_expire_second) || 600, 600) * 1000;
    Object.assign(flow, { code, expires, busy: false });
    return {
      url,
      expiresAt: expires,
      tip: text(data.tip_content) || '使用另一台设备扫码授权',
    };
  }
  async poll(session: string, ip: string) {
    if (this.qq.native) return this.qq.native.poll(session);
    const flow = this.flows.get(session);
    if (!flow || flow.expires < Date.now())
      throw new AppError(410, '二维码已过期，请重新获取');
    if (flow.busy || Date.now() - flow.lastPoll < 1800)
      return { status: 'waiting' };
    flow.lastPoll = Date.now();
    flow.busy = true;
    try {
      const context = { ip, device: session.slice(0, 32) };
      const result = await this.qq.call(
        'fcg_music_custom_qrcode_auth_poll.fcg',
        {
          qqmusic_openid_appId: this.qq.config.qqAppId,
          qqmusic_openid_authCode: flow.code,
          state: flow.state,
        },
        context,
        { allowError: true },
      );
      const ret = number(result.ret);
      if (ret === -11 || ret === -19)
        return { status: ret === -19 ? 'scanned' : 'waiting' };
      if (ret !== 0) {
        if (this.flows.get(session) === flow) this.flows.delete(session);
        throw new AppError(401, `授权未完成（${ret}），请重新获取二维码`);
      }
      const code = text(result.encryptString);
      if (!code.startsWith('code-'))
        throw new AppError(
          502,
          '当前应用可能使用旧 RSA 授权方案，需向比赛方确认 OAuth 配置',
          'QQ_AUTH_SCHEME',
        );
      await this.exchange(
        session,
        context,
        { cmd: 'getToken', code },
        () => this.flows.get(session) === flow && flow.expires > Date.now(),
      );
      this.flows.delete(session);
      return { status: 'authorized' };
    } finally {
      flow.busy = false;
    }
  }
  get webConfigured() {
    if (this.qq.native) return false;
    return Boolean(
      this.qq.configured &&
      this.qq.config.qqWebLogin &&
      this.qq.config.qqH5Package,
    );
  }
  /** Official H5 OAuth. The server fixes the callback and persists its session-bound state. */
  web(
    session: string,
    origin: string,
    returnTo?: string,
    nativeReturn = false,
    returnClient: AuthReturnTarget = nativeReturn ? 'native' : '',
    channel: 'all' | 'qq' = 'all',
  ) {
    if (!this.webConfigured)
      throw new AppError(
        503,
        '网页授权尚未启用，请使用二维码登录',
        'QQ_WEB_LOGIN_DISABLED',
      );
    if (!this.qq.config.origins.includes(origin))
      throw new AppError(403, '授权来源不合法');
    const returnPath = loginReturnPath(returnTo);
    this.flows.delete(session);
    const state = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.store.setWebAuthFlow(
      session,
      state,
      expiresAt,
      returnPath,
      returnClient,
    );
    const callback = nativeReturn
      ? new URL('hiddentrack://oauth')
      : new URL('/api/music/auth/web/callback', origin);
    callback.searchParams.set('state', state);
    const params = new URLSearchParams({
      appId: this.qq.config.qqAppId,
      packageName: this.qq.config.qqH5Package,
      callbackUrl: callback.href,
      // Official unionlogin clears its prior account before an explicitly requested login.
      changeLogin: '1',
      // Top-level callback avoids third-party-cookie failures in an error iframe.
      needNotifyErr: '0',
      // The official page spells its WeChat hide flag 'wexin'. Do not set
      // loginType=qq: that branch bypasses changeLogin's account-selection path.
      ...(channel === 'qq' ? { hiddenChannel: 'music.wexin' } : {}),
      encryptString: JSON.stringify({ response_type: 'code', state }),
    });
    return {
      url: `https://y.qq.com/m/unionlogin/dist/index.html?${params}`,
      expiresAt,
    };
  }

  allowedReturnOrigin(host: string): string {
    return (
      this.qq.config.origins.find((origin) => new URL(origin).host === host) ||
      this.qq.config.origins[0]!
    );
  }
  diagnostics(session: string, state?: string) {
    const flow = this.store.getWebAuthFlow(session);
    return {
      flowFound: !!flow,
      stateMatches: Boolean(state && flow?.state === state),
      differentBrowser: Boolean(
        state && !flow && this.store.hasWebAuthState(state),
      ),
    };
  }
  /** A callback in another browser only deposits an encrypted result. It never signs that browser in. */
  async receiveWebCallback(
    session: string,
    state: string,
    code: string,
    ip: string,
  ) {
    if (this.store.getWebAuthFlow(session)?.state === state) {
      // Preserve the one-time result encrypted before exchanging it. A network failure
      // can then be recovered by the same Cookie session after returning to the game.
      this.store.deferWebAuthCode(state, code);
      return {
        ...(await this.webCallback(session, state, code, ip)),
        deferred: false,
      };
    }
    const target = validAuthReturnTarget(this.store.webAuthReturnClient(state));
    if (this.store.deferWebAuthCode(state, code))
      return {
        returnPath: '/auth/complete' + (target ? '?target=' + target : ''),
        deferred: true,
      };
    throw new AppError(410, '授权已过期，请重新发起登录', 'QQ_AUTH_EXPIRED');
  }
  async completeWeb(session: string, ip: string) {
    const flow = this.store.getWebAuthFlow(session);
    const existing = this.store.getAuth(session);
    if (existing && (existing.expiresAt > Date.now() || existing.refreshToken))
      return { status: 'authorized', returnTo: flow?.returnPath || '/' };
    const code = this.store.deferredWebAuthCode(session);
    if (!flow) return { status: 'expired' };
    if (!code) return { status: 'waiting', expiresAt: flow.expires };
    let completed;
    try {
      completed = await this.webCallback(session, flow.state, code, ip);
    } catch (error) {
      if (
        error instanceof AppError &&
        [401, 403, 410].includes(error.status) &&
        this.store.getWebAuthFlow(session)?.state === flow.state
      )
        this.store.deleteWebAuthFlow(session);
      throw error;
    }
    return { status: 'authorized', returnTo: completed.returnPath };
  }
  async webCallback(
    session: string,
    state: string,
    authCode: string,
    ip: string,
  ) {
    const flow = this.store.getWebAuthFlow(session);
    if (!flow) throw new AppError(410, '授权已过期，请重新发起登录');
    if (flow.state !== state)
      throw new AppError(403, '授权状态校验失败，请重试');
    const key = `${session}:${state}`;
    const existing = this.webExchanges.get(key);
    if (existing) return existing;
    const task = (async () => {
      await this.exchange(
        session,
        { ip, device: session.slice(0, 32) },
        { cmd: 'getToken', code: authCode },
        () => this.store.getWebAuthFlow(session)?.state === state,
      );
      this.store.deleteWebAuthFlow(session);
      return { returnPath: flow.returnPath };
    })();
    this.webExchanges.set(key, task);
    try {
      return await task;
    } finally {
      if (this.webExchanges.get(key) === task) this.webExchanges.delete(key);
    }
  }

  private async exchange(
    session: string,
    context: Context,
    parameters: Record<string, string>,
    canCommit: () => boolean,
  ): Promise<QQAuth> {
    const data = await this.qq.call(
      'fcg_music_oauth_get_accesstoken.fcg',
      parameters,
      context,
      { includeKey: true },
    );
    let result;
    try {
      result = object(parseUpstreamJSON(text(data.encryptString)));
    } catch {
      throw new AppError(502, '访问令牌响应格式不受支持');
    }
    const auth = {
      openId: text(result.qqmusic_open_id),
      accessToken: text(result.qqmusic_access_token),
      refreshToken: text(result.qqmusic_refresh_token) || undefined,
      expiresAt: number(result.expireTime) * 1000 || Date.now() + 24 * 3600000,
    };
    if (!auth.openId || !auth.accessToken)
      throw new AppError(502, '访问令牌缺少必要字段');
    if (!canCommit())
      throw new AppError(
        401,
        '本次授权已取消，请重新登录',
        'QQ_AUTH_CANCELLED',
      );
    if (
      parameters.cmd === 'getToken' &&
      this.store.getAuth(session)?.openId !== auth.openId
    )
      this.store.setProfile(session);
    this.store.setAuth(session, auth);
    return auth;
  }
  logout(session: string) {
    this.qq.native?.forget(session);
    this.flows.delete(session);
    this.store.deleteWebAuthFlow(session);
    this.store.setAuth(session, null);
    this.store.setProfile(session);
  }
}
