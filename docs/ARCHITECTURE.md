# 源码结构与原双人实现

```text
src/client/           React 页面、卡牌交互与音频
src/shared/           公共协议、默认规则与卡牌定义
src/game/             游戏状态机、行动、事件、线索与结算
src/server/           Fastify、会话、房间、存档与电脑调度
src/server/music/     QQ 适配、资料、个人音乐库与音频授权
src/server/music/vendor/  从分享包保留的 QQ 客户端与少量 runtime
tests/                游戏与服务回归
native/               Android WebView / Windows WebView2 壳源码
deploy/               原单实例部署与维护脚本，供参考
```

## 请求与对局

React 客户端通过 HTTP 提交操作。服务端执行动作并生成对应玩家的可见视图，通过 WebSocket 推送状态；客户端不承担权威胜负判定。

当前实现按单 Node 实例运行，房间、机器人任务、响应计时器、扫码流程和部分授权状态还保存在进程内。SQLite 保存会话、加密后的 QQ 凭证与房间状态。

## 双人代码的保留位置

- `src/server/rooms.ts`：邀请房间、席位、准备、换位、动作与各玩家视图。
- `src/server/app.ts`：房间 HTTP 路由、WebSocket 接入与当前本地模式限制。
- `src/server/practice-bot.ts`：电脑调度和按可见信息决策。
- `src/game/`：真人和电脑共用的规则引擎。
- `src/shared/protocol.ts`、`src/server/ruleset.ts`：协议和规则兼容信息。
- `src/server/store.ts`：会话与房间保存。

当前 `LOCAL_PRACTICE_ONLY=true` 时限制创建、加入真人对局，只开放电脑练习，并返回缺少双人服务器的说明。这些限制没有删掉原双人实现。

将该配置直接关闭也不等于恢复当前 QQ 适配下的正式双人服务：现有 `localOnly` 同时决定是否启用内置 QQ 客户端，历史分支还保留旧授权路径。恢复时需要明确拆开“音乐来源”和“多人服务开关”，重新检查协议、私有视图、计时、存档、会话和实际网络流程。

## 当前边界

QQ 适配是第三方客户端模块与游戏之间的固定业务包装，不对外提供任意上游调用或通用签名代理。个人账号按游戏会话隔离。人机曲库使用预设的录音版本，未知曲目的事实不会被自动编造成游戏线索。

当前兼容标识：规则 revision15、协议10、存档 schemaVersion12。此发布整理没有更改这些值。
