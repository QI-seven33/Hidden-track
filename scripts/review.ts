/** One stable local acceptance entry. Never uses the original DB or public tunnel. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const home = join(root, 'artifacts', 'local-review');
const stateFile = join(home, 'control.json');
const stopFile = join(home, 'stop.request');
const url = 'http://localhost:3192';
type State = {
  pid: number;
  instance: string;
  token: string;
  active: boolean;
  starting: boolean;
};
const read = (): State | undefined =>
  existsSync(stateFile)
    ? (JSON.parse(readFileSync(stateFile, 'utf8')) as State)
    : undefined;
const save = (state: State) =>
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
function alive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
async function stop() {
  const state = read();
  if (!state) return;
  if (!alive(state.pid)) {
    save({ ...state, active: false, starting: false });
    return;
  }
  if (state.starting) throw new Error('本机验收正在构建，请稍后再运行此命令。');
  if (!state.active) return;
  writeFileSync(stopFile, state.token, { mode: 0o600 });
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const current = read();
    if (!current?.active || current.instance !== state.instance) return;
  }
  throw new Error(
    '原验收实例尚未确认停止；没有强制终止其他进程，也不会换端口。',
  );
}
async function main() {
  const command = process.argv[2] || 'run';
  if (command === 'status') {
    const state = read();
    let active = false;
    if (state?.active && alive(state.pid)) {
      try {
        const response = await fetch(url + '/api/review-health', {
          signal: AbortSignal.timeout(700),
        });
        const body = (await response.json()) as { instance?: string };
        active = response.ok && body.instance === state.instance;
      } catch {
        /* Stale state is not a running preview. */
      }
    }
    console.log(
      JSON.stringify({
        url,
        active,
        starting: !!state?.starting && alive(state.pid),
      }),
    );
    return;
  }
  if (command === 'stop') {
    await stop();
    console.log('本机验收已停止；数据库保留。');
    return;
  }
  if (command !== 'run')
    throw new Error('使用 npm run review、review:status 或 review:stop');
  await stop();
  // Reserve the fixed port while building. A collision fails closed, never chooses another port.
  const reservation = net.createServer();
  await new Promise<void>((accept, reject) => {
    reservation.once('error', () =>
      reject(new Error('3192已被其他服务占用；没有自动更换端口。')),
    );
    reservation.listen(3192, '127.0.0.1', accept);
  });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const state: State = {
    pid: process.pid,
    instance: randomUUID(),
    token: randomBytes(32).toString('hex'),
    active: false,
    starting: true,
  };
  save(state);
  try {
    const npmCli =
      process.env.npm_execpath ||
      join(
        dirname(process.execPath),
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
      );
    const build = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, BUILD_OUTPUT: 'artifacts/review-build' },
    });
    if (build.error || build.status !== 0)
      throw new Error('构建失败，未启动旧版页面；请查看上方构建错误。');
    await new Promise<void>((accept) => reservation.close(() => accept()));
    const { makeApp } = await import('../src/server/app');
    const { loadConfig } = await import('../src/server/config');
    const config = {
      ...loadConfig({
        ...process.env,
        NODE_ENV: 'development',
        PLAYTEST_MODE: 'false',
      }),
      production: false,
      playtest: undefined,
      host: '127.0.0.1',
      port: 3192,
      origins: [url, 'http://127.0.0.1:3192'],
      database: join(home, 'app.sqlite'),
      clientRoot: join(root, 'artifacts', 'review-build', 'client'),
    };
    const { app } = await makeApp({
      config,
      sessionCookieName: 'music_session_local_review',
    });
    app.get('/api/review-health', async () => ({
      ok: true,
      instance: state.instance,
    }));
    let ending = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const shutdown = async () => {
      if (ending) return;
      ending = true;
      if (timer) clearInterval(timer);
      await app.close();
      if (read()?.instance === state.instance)
        save({ ...state, active: false, starting: false });
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    await app.listen({ host: config.host, port: config.port });
    state.active = true;
    state.starting = false;
    save(state);
    timer = setInterval(() => {
      if (
        existsSync(stopFile) &&
        readFileSync(stopFile, 'utf8') === state.token
      )
        void shutdown();
    }, 300);
    console.log(
      '\n本机验收：' +
        url +
        '\n固定3192，独立持久数据库；再次运行 npm run review 会构建并重启。',
    );
  } catch (error) {
    if (reservation.listening) reservation.close();
    if (read()?.instance === state.instance)
      save({ ...state, active: false, starting: false });
    throw error;
  }
}
main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
