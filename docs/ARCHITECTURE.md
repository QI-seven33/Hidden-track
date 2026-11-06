# 源码结构

```text
src/client/         React 页面、交互与音频
src/shared/         公共协议、规则与卡牌定义
src/game/           游戏状态机、线索、事件与结算
src/server/         HTTP 服务、会话、房间与电脑调度
src/server/music/   音乐功能
tests/              测试
native/             Android / Windows 客户端壳
deploy/             部署脚本
```

客户端通过 HTTP 提交操作，服务端执行规则并生成各玩家可见的状态，通过 WebSocket 推送更新。SQLite 保存会话与房间数据。

## 对局相关文件

- `src/server/rooms.ts`：房间、席位、准备、换位和玩家视图。
- `src/server/app.ts`：HTTP 路由与 WebSocket 接入。
- `src/server/practice-bot.ts`：电脑行为调度。
- `src/game/`：规则引擎。
- `src/shared/protocol.ts`：通信协议。
- `src/server/store.ts`：数据保存。

双人对战相关实现保留在上述模块中，便于阅读与维护。
