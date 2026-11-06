# 开发说明

使用 Node.js 24.x；首次运行执行 `npm ci`。日常检查与本地运行：

```sh
npm run check
npm start
```

`check` 依次运行 TypeScript 检查、全部 Node 测试与网页/服务端构建。当前发布准备基线为 343 项通过，真实 QQ 登录和资源权限仍需账号与网络，不能由离线测试保证。

`npm start` 必须通过 `scripts/start.mjs`，它加载 `.env` 并应用本机模式配置。直接执行构建后的服务文件会绕过该入口。

| 命令                | 用途                                    |
| ------------------- | --------------------------------------- |
| `npm run typecheck` | TypeScript 检查                         |
| `npm test`          | 游戏和服务测试                          |
| `npm run build`     | 构建 `dist/client` 与 `dist/server.mjs` |
| `npm start`         | 一次启动本机游戏和内置 QQ 模块          |

## 本地文件

运行生成的 `data/`、`dist/`、`artifacts/`、`node_modules/` 和私密 `.env` 均不提交。保留 `.env.example` 的无密钥示例。测试使用独立临时数据库或内存数据库，不应指向自己正在使用的授权数据库。

## 客户端壳

`native/` 保留 Android Java + WebView 与 Windows C# + WebView2 实现。它们加载同一套 H5，不包含完整游戏后端。历史默认服务地址已停用；构建工具、签名与 WebView2 依赖需要自行准备，私钥和密码文件不能提交。

公开源码首版不附带旧 APK/EXE，也不承诺这些历史壳直接连接当前本机服务。iOS 尚无正式客户端。

## 发布原则

不将旧截图、历史线上版本或模拟测试当作当前实机验证。新增曲目、规则、平台、布局或启动方式变化，应同时更新说明与相应检查，并说明适用范围。
