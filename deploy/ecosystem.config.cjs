// pm2 配置：一定要跑 scripts/start.mjs，它会先 loadEnvFile('.env') 再加载 dist/server.mjs。
// 直接跑 dist/server.mjs 不会读 .env，QQ 音乐登录、Cookie 名、端口全都会退回默认值。
module.exports = {
  apps: [
    {
      name: 'music-card',
      cwd: '/home/ubuntu/music-card',
      script: 'scripts/start.mjs',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        PORT: '3000',
        HOST: '0.0.0.0',
      },
    },
  ],
};
