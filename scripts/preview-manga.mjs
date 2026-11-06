import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { DatabaseSync, backup } from 'node:sqlite';

// A separate local preview retains the project's QQ configuration and an online
// snapshot of its sessions. The existing service and database stay untouched.
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const output = join(root, 'artifacts/manga-lobby-20261031');
const database = join(output, 'preview.sqlite');
const entry = join(output, 'build/server.mjs');
if (!existsSync(entry)) throw new Error('缺少已构建的大厅预览。');
const local = existsSync(join(root, '.env'))
  ? parseEnv(readFileSync(join(root, '.env'), 'utf8'))
  : {};
const env = { ...local, ...process.env };
const source = join(root, 'data/playtest-07.sqlite');
if (!existsSync(database) && existsSync(source)) {
  if (!/^[a-f0-9]{64}$/i.test(env.SESSION_SECRET || ''))
    throw new Error('预览需要原 SESSION_SECRET 才能保留已有 QQ 授权。');
  mkdirSync(dirname(database), { recursive: true });
  const original = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(original, database);
  } finally {
    original.close();
  }
}
Object.assign(process.env, env, {
  HOST: '127.0.0.1',
  PORT: '3199',
  NODE_ENV: 'development',
  PLAYTEST_MODE: 'false',
  TRUST_PROXY: 'false',
  ENABLE_FIXTURES: 'true',
  DATABASE_PATH: database,
  CLIENT_ROOT: join(output, 'build/client'),
  APP_ORIGINS: 'http://127.0.0.1:3199,http://localhost:3199',
  SESSION_COOKIE_NAME: 'music_session_07',
  LEGACY_SESSION_COOKIE_NAME: 'music_session',
});
await import(
  new URL('../artifacts/manga-lobby-20261031/build/server.mjs', import.meta.url)
    .href
);
