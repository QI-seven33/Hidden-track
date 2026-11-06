import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));

// Shell 脚本进了 tar 就没人再管换行：CRLF 到 Linux 上 `set -o pipefail\r`
// 会报 `invalid option name`，整条更新脚本直接不执行。打包前统一压成 LF。
async function toLf(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      await toLf(path);
      continue;
    }
    if (!entry.name.endsWith('.sh')) continue;
    const text = await readFile(path, 'utf8');
    if (!text.includes('\r')) continue;
    await writeFile(path, text.replace(/\r\n?/g, '\n'), 'utf8');
    console.log(`normalized CRLF -> LF: ${path}`);
  }
}
await toLf('deploy');
const packs = {
  deploy: [
    'dist',
    'deploy',
    'scripts/start.mjs',
    'package.json',
    'package-lock.json',
    '.env.example',
    'docs/1.0.1-本次修复与部署.md',
    'docs/1.0.2-登录与电脑逻辑修复.md',
    'docs/1.0.2-最终UI审查与旧界面收敛.md',
    'docs/1.0.2-大厅黑胶与背景音乐联动.md',
    'docs/1.0.3-结算自动试听与打包换行修复.md',
    'docs/1.0.4-线上恢复与更新流程.md',
    'docs/1.0.8-启动与手机交互修复.md',
    'docs/1.0.9-背景音乐与最终交付.md',
    'docs/1.0.16-手机授权与返回修复.md',
    'docs/1.0.24-竖屏旋转与键盘调整.md',
    'docs/1.0.25-动态卡牌与横屏键盘修复.md',
    'docs/1.0.26-手机网页下载引导.md',
    'HANDOVER-移动端.md',
  ],
  source: [
    'src',
    'public',
    'tests',
    'scripts',
    'native',
    'deploy',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'AGENTS.md',
    'README.md',
    'docs/1.0.4-正式版打包交接.md',
    '.env.example',
    'docs/1.0.1-本次修复与部署.md',
    'docs/1.0.2-登录与电脑逻辑修复.md',
    'docs/1.0.2-最终UI审查与旧界面收敛.md',
    'docs/1.0.2-大厅黑胶与背景音乐联动.md',
    'docs/1.0.3-结算自动试听与打包换行修复.md',
    'docs/1.0.4-线上恢复与更新流程.md',
    'docs/1.0.8-启动与手机交互修复.md',
    'docs/1.0.9-背景音乐与最终交付.md',
    'docs/1.0.16-手机授权与返回修复.md',
    'docs/1.0.24-竖屏旋转与键盘调整.md',
    'docs/1.0.25-动态卡牌与横屏键盘修复.md',
    'docs/1.0.26-手机网页下载引导.md',
    'HANDOVER-移动端.md',
  ],
};
for (const [kind, files] of Object.entries(packs)) {
  const archive = `artifacts/music-card-${version}-${kind}.tgz`;
  const result = spawnSync('tar', ['-czf', archive, ...files], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(archive);
}

// 打完之后从包里读回脚本来验：tar 里若是 CRLF，服务器上一定跑不起来。
const probe = spawnSync(
  'tar',
  [
    '-xzOf',
    `artifacts/music-card-${version}-deploy.tgz`,
    'deploy/update-demo.sh',
  ],
  { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
);
if (probe.status !== 0) {
  console.error('deploy 包里读不到 deploy/update-demo.sh');
  process.exit(probe.status || 1);
}
if (probe.stdout.includes(13)) {
  console.error('deploy/update-demo.sh 在包里仍是 CRLF，中止打包');
  process.exit(1);
}
console.log('line endings OK (LF)');
