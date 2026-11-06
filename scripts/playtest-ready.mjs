/** Explicit user command: stop the old test, build current source, open the test. */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli =
  process.env.npm_execpath ||
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
for (const task of ['playtest:stop', 'build', 'playtest:start']) {
  const result = spawnSync(process.execPath, [npmCli, 'run', task], {
    cwd: root,
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, BUILD_OUTPUT: 'artifacts/playtest-build' },
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
