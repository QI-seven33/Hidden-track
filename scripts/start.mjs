import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { localSettings } from './local-settings.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(new URL('../dist/server.mjs', import.meta.url))) {
  console.error('缺少构建产物，请先运行 npm run build。');
  process.exit(1);
}
// Preserve old .env files; the local edition overrides retired server/account settings.
process.chdir(root);
if (existsSync('.env')) loadEnvFile('.env');
if (process.env.LOCAL_PRACTICE_ONLY !== 'false') {
  Object.assign(process.env, localSettings(root));
  console.log(
    `Hidden Track · 本机人机练习 http://127.0.0.1:${process.env.PORT}`,
  );
  console.log(
    'QQ 音乐接口已内置，与游戏一同启动。请在原登录页扫码登录；人机入口仍在设置中。',
  );
}
process.env.NODE_ENV ||= 'production';
await import('../dist/server.mjs');
