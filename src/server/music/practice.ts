import recordings from './practice-recordings.json';
import type { Song } from '../../game/types';
import { QQMusic } from './qq';
import type { QQAuth } from '../store';
import { duelMp3 as officialPreview } from './duel-media';
import { missingGameFacts } from './game-eligibility';
import { AppError } from '../errors';
import { digest } from '../ruleset';
type Context = { ip: string; device: string; auth?: QQAuth };
/** Metadata is verified at preparation; playback eligibility is checked with this listener's account. */
export class PracticeLibrary {
  private cache = new Map<
    string,
    { authKey: string; expires: number; songs: Song[] }
  >();
  private pending = new Map<string, Promise<Song[]>>();
  constructor(
    private qq: QQMusic,
    private candidates: readonly Song[] = recordings as Song[],
  ) {}
  current(session: string): readonly Song[] {
    return this.cache.get(session)?.songs || [];
  }
  async list(session: string, context: Context): Promise<Song[]> {
    if (!context.auth)
      throw new AppError(
        401,
        '请先登录 QQ 音乐，以核验电脑曲目的官方试听',
        'QQ_LOGIN_REQUIRED',
      );
    const authKey = digest(context.auth),
      key = session + ':' + authKey;
    const cached = this.cache.get(session);
    if (cached?.authKey === authKey && cached.expires > Date.now())
      return cached.songs;
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= 4)
      throw new AppError(429, '电脑曲库正在核验，请稍后重试');
    const task = (async () => {
      const songs: Song[] = [];
      // Sequential scheduling preserves the shared upstream queue's bounded budget.
      for (const candidate of this.candidates) {
        const { raw } = await this.qq.detail(
          'qq:' + (candidate.providerMid || candidate.providerId),
          context,
        );
        if (!officialPreview(raw)) continue;
        const song = { ...structuredClone(candidate), previewAvailable: true };
        if (!missingGameFacts(song).length) songs.push(song);
      }
      if (songs.length < 2)
        throw new AppError(
          503,
          '当前账号下可试听的完整练习曲目不足两首，请稍后重试或更换账号',
          'PRACTICE_UNAVAILABLE',
        );
      for (const [id, entry] of this.cache)
        if (entry.expires <= Date.now()) this.cache.delete(id);
      if (this.cache.size >= 128 && !this.cache.has(session))
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(session, {
        authKey,
        expires: Date.now() + 600_000,
        songs,
      });
      return songs;
    })();
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      this.pending.delete(key);
    }
  }
}
