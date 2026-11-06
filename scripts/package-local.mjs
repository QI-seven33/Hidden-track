import { cp, mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
const out = join(root, 'artifacts', `HiddenTrack-${version}-local`);
try {
  await access(out);
  throw Error('已存在本机包目录，不覆盖旧文件。');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
await mkdir(join(out, 'scripts'), { recursive: true });
for (const entry of [
  'dist',
  'package.json',
  'package-lock.json',
  '.env.example',
  'README.md',
  'OPEN_SOURCE_NOTES.md',
  'src/server/music/vendor/NOTICE.md',
  'docs/1.1.1-QQ接口与原界面恢复.md',
  'start-local.cmd',
  'scripts/start.mjs',
  'scripts/local-settings.mjs',
])
  await cp(join(root, entry), join(out, entry), {
    recursive: true,
    filter: (source) =>
      !source.replaceAll('\\', '/').includes('/downloads/') &&
      !source.replaceAll('\\', '/').endsWith('/downloads'),
  });
const r = spawnSync('tar', ['-czf', out + '.tgz', '-C', out, '.'], {
  stdio: 'inherit',
  windowsHide: true,
});
if (r.status !== 0) process.exit(r.status || 1);
console.log('本机运行包：' + out + '.tgz');
