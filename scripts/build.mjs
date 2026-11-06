import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A local .env may contain NODE_ENV=development. Release builds must still use
// React production bundles and exclude the development-only route imports.
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.env.NODE_ENV = 'production';
await import('./generate-art.mjs');
const result = spawnSync(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build'],
  { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true },
);
if (result.status !== 0) process.exit(result.status || 1);
await import('./build-server.mjs');
