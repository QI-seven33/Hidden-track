import { makeApp } from './app';
const { app, config } = await makeApp({
  logger: true,
  sessionCookieName: process.env.SESSION_COOKIE_NAME,
  legacySessionCookieName: process.env.LEGACY_SESSION_COOKIE_NAME,
});
try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(
    {
      event: 'startup_failed',
      name: error instanceof Error ? error.name : 'unknown',
      code:
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'UNKNOWN',
      host: config.host,
      port: config.port,
      hint:
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EADDRINUSE'
          ? '端口已被旧进程占用；请停止旧服务后重启，不要只杀 npm 父进程'
          : '请核对 Node 24、监听地址和文件权限',
    },
    'Server startup failed',
  );
  process.exit(1);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
