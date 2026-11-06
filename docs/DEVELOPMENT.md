# 开发说明

使用 Node.js 24.x 与 npm。

```sh
npm ci
npm run check
npm start
```

打开 <http://127.0.0.1:3197/>。启动入口为 `scripts/start.mjs`，会加载 `.env`。

| 命令                | 用途                 |
| ------------------- | -------------------- |
| `npm run typecheck` | 类型检查             |
| `npm test`          | 运行测试             |
| `npm run build`     | 构建网页与服务端     |
| `npm run check`     | 类型检查、测试与构建 |
| `npm start`         | 启动游戏             |

`dist/client` 为网页构建目录，`dist/server.mjs` 为服务端构建文件。页面与游戏服务一同运行，详见 [运行说明](DEPLOYMENT.md)。

本地数据保存在 `data/`，运行偏好保存在浏览器中。`.env`、数据库、密钥、签名文件与构建缓存不提交到仓库。

修改规则时，同时检查协议、玩家私有视图、计时、电脑决策、持久化与测试。
