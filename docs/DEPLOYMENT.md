# 部署现状与 Vercel 后续适配

本轮先发布源码，**没有部署 Vercel，也没有宣称当前仓库可以一键完整游玩**。

## 已支持的运行方式

本机使用 Node.js 24，`npm ci`、`npm run check`、`npm start` 后访问 3197。默认只监听本机，保持强制 QQ 登录和设置中的电脑练习入口。

原正式服务器已销毁。原 PM2 单实例部署代码位于 `deploy/`，供理解历史实现；旧客户端默认地址和历史部署参数不代表存在可用公共服务，不应直接沿用为生产配置。

## 为什么还需要适配

当前 Fastify 应用依赖本地 SQLite 文件、进程内的房间/扫码状态和定时任务。只把 `dist/client` 上传为静态站点，会失去 `/api`、QQ 登录、音乐库、电脑行为与对局状态，因此不能游玩。

截至本次核对的 Vercel 官方说明：

- [Fastify 可作为 Vercel Function 部署](https://vercel.com/docs/frameworks/backend/fastify)，但应用仍受函数生命周期和多实例运行方式影响。
- [Vercel 已支持 WebSocket](https://vercel.com/docs/functions/websockets)。连接在函数时限到达时会断开，重连不保证回到同一实例；持久状态与实例间协作需要外部存储。
- [本地 SQLite 文件不适合作为 Vercel 持久共享数据库](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)，函数的临时文件系统不能代替当前单实例的长期保存方式。

因此问题不只是补一个 `vercel.json`，也不是简单把 WebSocket 换掉。

## 后续需要完成的工作

1. 选择并接入外部持久存储，迁移会话、授权加密数据、房间和相关索引。
2. 处理扫码流程、音频授权、机器人任务和计时器在实例切换、休眠、断线与重新部署后的恢复。
3. 为 HTTP 动作和 WebSocket 更新建立一致的状态提交与推送机制，防止并发结算与旧快照覆盖。
4. 保留当前 QQ 强制登录、账号隔离和全部 UI/玩法，不以游客或假数据绕过上线问题。
5. 使用真实部署验证 QQ 回跳、Cookie、音频资源、重连和存档恢复，再提供部署配置及在线地址。

上述工作尚未实施。本次不创建容易让导入者误判为已完成适配的 Vercel 一键部署按钮，也不选择或购买外部数据库服务。
