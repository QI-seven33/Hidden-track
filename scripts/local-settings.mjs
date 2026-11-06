import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
export function localSettings(root, lan = false) {
  const port = Number(process.env.LOCAL_PORT || 3197);
  const keyFile = join(root, 'data/local-session.key');
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    mkdirSync(join(root, 'data'), { recursive: true });
    if (!existsSync(keyFile)) {
      try {
        writeFileSync(keyFile, randomBytes(32).toString('hex'), {
          flag: 'wx',
          mode: 0o600,
        });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
    secret = readFileSync(keyFile, 'utf8').trim();
  }
  return {
    LOCAL_PRACTICE_ONLY: 'true',
    SESSION_SECRET: secret,
    NODE_ENV: 'development',
    HOST: lan ? '0.0.0.0' : '127.0.0.1',
    PORT: String(port),
    DATABASE_PATH: join(root, 'data/local-practice.sqlite'),
    CLIENT_ROOT: join(root, 'dist/client'),
    APP_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port},http://127.0.0.1:5197,http://localhost:5197`,
    SESSION_COOKIE_NAME: 'music_session_local',
    LEGACY_SESSION_COOKIE_NAME: '',
    PLAYTEST_MODE: 'false',
    TRUST_PROXY: 'false',
    ENABLE_FIXTURES: 'false',
    ENABLE_PRACTICE: 'true',
    QQMUSIC_APP_ID: '',
    QQMUSIC_APP_KEY: '',
    QQMUSIC_H5_LOGIN: 'false',
    QQMUSIC_PUBLIC_METADATA: 'false',
    QQMUSIC_PUBLIC_LYRICS: 'false',
  };
}
