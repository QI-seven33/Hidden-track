# Hidden-track

> 拜托，这么小众的歌都被你发现了，我的底牌又少了一张

**Hidden Track 是一款音乐卡牌对战游戏。** 选择歌曲作为秘密底牌，通过卡牌、事件与线索猜出对方藏的歌。

## 玩法

- 登录后进入 **设置 → 与电脑试一局** 开始人机练习。
- 基础牌 9 种、21 张，事件 38 项。
- 收集并合成线索，在获取信息和控制压力之间做出选择。
- 猜中对手的歌曲，或将对手的压力推到上限。

## 游戏画面

电脑网页版实拍。点击图片可查看原图。

<a href="docs/media/desktop-battle.png"><img src="docs/media/desktop-battle.png" width="760" alt="电脑网页版牌桌：手牌、压力、合成线索与已解锁试听" /></a>

_牌桌概览：左侧管理手牌与压力，右侧整理线索。点击任意图片可查看原始分辨率，放大阅读卡牌文字。_

<table>
  <tr>
    <td width="50%" align="center">
      <a href="docs/media/desktop-lobby.png"><img src="docs/media/desktop-lobby.png" width="340" alt="已登录的电脑网页版大厅" /></a><br />
      <b>大厅</b><br />QQ 登录与背景音乐
    </td>
    <td width="50%" align="center">
      <a href="docs/media/desktop-events.png"><img src="docs/media/desktop-events.png" width="340" alt="第一轮事件三选一" /></a><br />
      <b>事件选择</b><br />挑选本局策略
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="docs/media/desktop-guess.png"><img src="docs/media/desktop-guess.png" width="340" alt="根据线索确认猜歌" /></a><br />
      <b>猜歌</b><br />用线索锁定底牌
    </td>
    <td width="50%" align="center">
      <a href="docs/media/desktop-result.png"><img src="docs/media/desktop-result.png" width="340" alt="实际胜利结算与歌曲揭幕" /></a><br />
      <b>结算</b><br />揭晓对手藏的歌
    </td>
  </tr>
</table>

## 运行

需要 Node.js 24.x 与 npm。

```sh
npm ci
npm run check
npm start
```

打开 <http://127.0.0.1:3197/>，完成 QQ 音乐登录后进入游戏。

## 技术

React · TypeScript · Node.js · Fastify · SQLite · WebSocket

## 文档

- [玩法说明](docs/GAMEPLAY.md)
- [开发说明](docs/DEVELOPMENT.md)
- [源码结构](docs/ARCHITECTURE.md)
- [贡献指南](CONTRIBUTING.md)

## 许可

自有代码采用 [MIT License](LICENSE)。第三方内容适用各自许可，见 [第三方说明](THIRD_PARTY_NOTICES.md)。
