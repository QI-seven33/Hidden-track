import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { localSettings } from './local-settings.mjs';
if (existsSync('.env')) loadEnvFile('.env');
const children = [
  spawn(
    process.execPath,
    [
      '--env-file-if-exists=.env',
      'node_modules/tsx/dist/cli.mjs',
      'watch',
      'src/server/index.ts',
    ],
    {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        ...localSettings(fileURLToPath(new URL('../', import.meta.url))),
        HOST: '127.0.0.1',
        PORT: '3197',
        DATABASE_PATH: './data/local-practice.sqlite',
        APP_ORIGINS:
          'http://127.0.0.1:5197,http://localhost:5197,http://127.0.0.1:3197,http://localhost:3197',
        SESSION_COOKIE_NAME: 'music_session_local',
        LEGACY_SESSION_COOKIE_NAME: '',
        PLAYTEST_MODE: 'false',
        NODE_ENV: 'development',
      },
    },
  ),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    stdio: 'inherit',
  }),
];
const stop = () => {
  for (const child of children) child.kill();
};
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
for (const child of children)
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
