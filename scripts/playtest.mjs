/** Temporary HTTPS playtest. No edits to .env, main DB or dist/. */
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import http from 'node:http';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = join(root, 'artifacts', 'playtest-07');
const currentFile = join(home, 'current.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readCurrent = () =>
  existsSync(currentFile)
    ? JSON.parse(readFileSync(currentFile, 'utf8'))
    : undefined;
const current = readCurrent();
const command = process.argv[2] || 'status';
// 0.7 playtest: same official tunnel helper, own port and own build output.
// 3191 is the project's reserved tunnel port; the server config enforces it.
const PORT = Number(process.env.PLAYTEST_PORT || 3191);
const build = resolve(process.env.PLAYTEST_BUILD || join(root, 'dist'));
const launcherAlive = () => {
  if (!Number.isSafeInteger(current?.launcherPid) || current.launcherPid <= 0)
    return false;
  try {
    process.kill(current.launcherPid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
const safeRun = (p) =>
  typeof p === 'string' &&
  resolve(p).startsWith(home + '\\') &&
  resolve(p) !== home;
if (command === 'status') {
  console.log(
    JSON.stringify(
      current
        ? {
            active: !!current.active && launcherAlive(),
            ...(current.active && !launcherAlive()
              ? { note: '启动器已退出，记录过期；原测试数据保留。' }
              : {}),
            url: current.url,
            expiresAt: current.expiresAt,
            accessFile: join(current.runDir, '访问说明.txt'),
          }
        : { active: false },
    ),
  );
  process.exit(0);
}
if (command === 'stop') {
  if (!current?.active) {
    console.log('No active playtest');
    process.exit(0);
  }
  if (!safeRun(current.runDir)) throw new Error('Invalid playtest directory');
  if (!launcherAlive()) {
    writeFileSync(
      currentFile,
      JSON.stringify(
        {
          ...current,
          active: false,
          starting: false,
          stoppedAt: new Date().toISOString(),
          reason: 'launcher_missing',
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log('Expired playtest record closed; all test data retained');
    process.exit(0);
  }
  writeFileSync(join(current.runDir, 'stop.request'), current.controlToken, {
    mode: 0o600,
  });
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    if (!readCurrent()?.active) {
      console.log('Playtest tunnel and instance stopped');
      process.exit(0);
    }
  }
  throw new Error('Stop signal sent, but launcher has not confirmed shutdown');
}
if (command !== 'start') throw new Error('Use start, stop or status');
if (current?.active || current?.starting) {
  try {
    process.kill(current.launcherPid, 0);
    throw new Error('A playtest is already active; stop it first');
  } catch (e) {
    if (e.code !== 'ESRCH') throw e;
  }
}
if (!/^[a-f0-9]{64}$/i.test(process.env.SESSION_SECRET || ''))
  throw new Error('Existing server session configuration is unavailable');
const binary = join(root, 'artifacts', 'tools', 'cloudflared.exe');
const server = join(build, 'server.mjs');
if (!existsSync(binary) || !existsSync(server))
  throw new Error('Build or official tunnel binary is missing');
await new Promise((accept, reject) => {
  const probe = net.createServer();
  probe.once('error', () =>
    reject(new Error('Port ' + PORT + ' is already in use')),
  );
  probe.listen(PORT, '127.0.0.1', () => probe.close(accept));
});
const runDir = join(
  home,
  new Date().toISOString().replace(/[:.]/g, '-') +
    '-' +
    randomBytes(3).toString('hex'),
);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const password = randomBytes(12).toString('base64url'),
  salt = randomBytes(16).toString('hex');
const passwordHash = `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
const gateSecret = randomBytes(32).toString('hex'),
  controlToken = randomBytes(32).toString('hex');
const expires = Date.now() + 4 * 3600000;
// Do not pass app secrets to the tunnel helper.
const helperEnv = {};
for (const name of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
])
  if (process.env[name]) helperEnv[name] = process.env[name];
let testServer,
  tunnel,
  ended = false;
let status = {
  active: false,
  starting: true,
  launcherPid: process.pid,
  runDir,
  controlToken,
  expiresAt: new Date(expires).toISOString(),
};
function save() {
  mkdirSync(home, { recursive: true });
  writeFileSync(currentFile, JSON.stringify(status, null, 2), { mode: 0o600 });
}
function shutdown(reason) {
  if (ended) return;
  ended = true;
  status = {
    ...status,
    active: false,
    starting: false,
    stoppedAt: new Date().toISOString(),
    reason,
  };
  save();
  testServer?.kill();
  tunnel?.kill();
  console.log(`Playtest stopped: ${reason}`);
  setTimeout(
    () => process.exit(reason === 'startup_failed' ? 1 : 0),
    200,
  ).unref();
}
process.on('SIGINT', () => shutdown('manual'));
process.on('SIGTERM', () => shutdown('manual'));
process.on('uncaughtException', () => shutdown('startup_failed'));
process.on('unhandledRejection', () => shutdown('startup_failed'));
const tunnelLog = openSync(join(runDir, 'tunnel.log'), 'a');
tunnel = spawn(
  binary,
  [
    'tunnel',
    '--no-autoupdate',
    '--protocol',
    'http2',
    '--url',
    'http://127.0.0.1:' + PORT,
    '--metrics',
    '127.0.0.1:0',
  ],
  {
    cwd: root,
    windowsHide: true,
    env: helperEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
status.tunnelPid = tunnel.pid;
save();
let resolveUrl, rejectUrl;
const urlPromise = new Promise((ok, fail) => {
  resolveUrl = ok;
  rejectUrl = fail;
});
let buffer = '';
function tunnelOutput(data) {
  writeFileSync(tunnelLog, data);
  buffer = (buffer + data.toString()).slice(-10000);
  const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
  if (url) resolveUrl(url);
}
tunnel.stdout.on('data', tunnelOutput);
tunnel.stderr.on('data', tunnelOutput);
tunnel.on('error', () =>
  rejectUrl(new Error('Tunnel helper failed to launch')),
);
tunnel.on('exit', () => {
  rejectUrl(new Error('Tunnel ended before setup'));
  if (!ended) shutdown('tunnel_ended');
});
let url;
try {
  url = await Promise.race([
    urlPromise,
    sleep(60000).then(() => {
      throw new Error('Tunnel address timeout');
    }),
  ]);
} catch {
  shutdown('startup_failed');
  await sleep(250);
  process.exit(1);
}
if (ended) process.exit(1);
const serverLog = openSync(join(runDir, 'server.log'), 'a');
const childEnv = {
  ...process.env,
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(PORT),
  APP_ORIGINS: url,
  DATABASE_PATH: join(runDir, 'app.sqlite'),
  CLIENT_ROOT: join(build, 'client'),
  ENABLE_FIXTURES: 'true',
  TRUST_PROXY: 'true',
  ADMIN_TOKEN: '',
  PLAYTEST_MODE: 'true',
  PLAYTEST_ORIGIN: url,
  PLAYTEST_EXPIRES_AT: String(expires),
  PLAYTEST_PASSWORD_HASH: passwordHash,
  PLAYTEST_GATE_SECRET: gateSecret,
};
testServer = spawn(process.execPath, [server], {
  cwd: root,
  env: childEnv,
  windowsHide: true,
  stdio: ['ignore', serverLog, serverLog],
});
closeSync(serverLog);
status.serverPid = testServer.pid;
testServer.on('error', () => shutdown('startup_failed'));
testServer.on('exit', () => {
  if (!ended) shutdown('instance_ended');
});
let ready = false;
for (let i = 0; i < 40 && !ended; i++) {
  try {
    const available = await new Promise((resolveReady) => {
      const request = http.get(
        'http://127.0.0.1:' + PORT + '/',
        { headers: { host: new URL(url).host } },
        (response) => {
          let text = '';
          response.on('data', (chunk) => (text += chunk));
          response.on('end', () =>
            resolveReady(
              response.statusCode === 401 && text.includes('乐友测试入口'),
            ),
          );
        },
      );
      request.on('error', () => resolveReady(false));
      request.setTimeout(1000, () => {
        request.destroy();
        resolveReady(false);
      });
    });
    if (available) {
      ready = true;
      break;
    }
  } catch {}
  await sleep(250);
}
if (!ready) {
  shutdown('startup_failed');
  await sleep(250);
  process.exit(1);
}
writeFileSync(
  join(runDir, '访问说明.txt'),
  `底牌音乐 · 临时队友测试\r\n\r\n地址：${url}\r\n测试口令：${password}\r\n到期时间：${new Date(expires).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）\r\n\r\n请只向队友分享地址和本次测试口令，不分享.env、Cookie、QQ票据或此目录内的其他文件。\r\n双方都从上面的公网地址进入，再创建/分享房间邀请链接；localhost邀请不能用于远程测试。\r\n无需登录QQ音乐即可选公开曲目对战；数字专辑购买权益与当前选底牌无绑定。播放/试听仍以每个账号的官方可用资源为准。\r\n\r\n停止：在项目主目录运行 npm run playtest:stop\r\n关闭电脑或到期后入口不可用。公网域名改变时原浏览器登录状态不迁移，原本地授权仍保留。\r\n`,
  { mode: 0o600 },
);
status = {
  ...status,
  active: true,
  starting: false,
  url,
  startedAt: new Date().toISOString(),
};
save();
console.log(`Playtest URL: ${url}`);
console.log(`Private access instructions: ${join(runDir, '访问说明.txt')}`);
console.log(`Expires: ${status.expiresAt}`);
const interval = setInterval(() => {
  const stop = join(runDir, 'stop.request');
  if (Date.now() >= expires) shutdown('expired');
  else if (existsSync(stop) && readFileSync(stop, 'utf8') === controlToken)
    shutdown('manual');
}, 500);
process.on('exit', () => {
  clearInterval(interval);
  testServer?.kill();
  tunnel?.kill();
  try {
    closeSync(tunnelLog);
  } catch {}
});
