import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
const out = resolve(root, 'artifacts', `HiddenTrack-${version}-source`);
try {
  await access(out);
  throw new Error('源码导出目录已存在，为保留原文件不覆盖：' + out);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
await mkdir(out, { recursive: true });
const included = [
  'src',
  'public',
  'tests',
  'scripts',
  'native',
  'deploy',
  'docs',
  '.github',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  '.gitignore',
  '.gitattributes',
  '.prettierrc.json',
  '.prettierignore',
  '.env.example',
  'README.md',
  'AGENTS.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'PRIVACY.md',
  'OPEN_SOURCE_NOTES.md',
  'start-local.cmd',
];
const forbidden = new Set([
  'node_modules',
  '.git',
  'data',
  'artifacts',
  'unifyAPI',
  'downloads',
  '.vercel',
  'bin',
  'obj',
]);
const filter = (source) => {
  const parts = relative(root, source).split(sep),
    name = parts.at(-1);
  return (
    !parts.some((p) => forbidden.has(p)) &&
    (!name.startsWith('.env') || name === '.env.example') &&
    !/\.(sqlite.*|db|jks|keystore|p12|pfx|log|pem|key|exe|apk|aab)$/i.test(
      name,
    ) &&
    !/(^|-)credential\.json$|(^|-)device\.json$/i.test(name)
  );
};
for (const entry of included) {
  try {
    await access(join(root, entry));
  } catch {
    continue;
  }
  await cp(join(root, entry), join(out, entry), { recursive: true, filter });
}
await writeFile(
  join(out, 'SOURCE_EXPORT.md'),
  '此目录包含用户要求内置的 QQ 客户端模块，不包含原完整网关、账号数据、安装包或依赖。复制代码及素材的发布许可见 OPEN_SOURCE_NOTES.md 和 src/server/music/vendor/NOTICE.md。本脚本不会创建仓库或上传文件。\n',
);
const archive = out + '.tgz';
const r = spawnSync('tar', ['-czf', archive, '-C', out, '.'], {
  stdio: 'inherit',
  windowsHide: true,
});
if (r.status !== 0) process.exit(r.status || 1);
console.log('源码目录：' + out);
console.log('源码归档：' + archive);
