# 运行说明

项目使用 Node.js 24.x，网页与游戏服务一同运行。

```sh
npm ci
npm run build
npm start
```

默认地址为 <http://127.0.0.1:3197/>。通过 `scripts/start.mjs` 启动，配置示例见 `.env.example`。

`data/` 保存运行数据；重启和更新时保留数据库及会话密钥。`deploy/` 中保留服务部署与维护脚本。
