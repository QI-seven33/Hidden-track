# 第三方代码与素材说明

根目录 MIT License 授权 Hidden Track 的自有代码。下面列出的第三方内容不因此转为 MIT；来源、商标和各自许可继续保留。未确认的条目标记待补充，不声称已获得再分发许可。

## QQ 客户端模块

`src/server/music/vendor/QQMusicApi/` 与 `src/server/music/vendor/gateway/runtime.js` 来自项目作者朋友提供的 UnifyAPI 分享包。分享包根标注 `UNLICENSED`，原作者身份、公开来源及具体许可待项目作者补充。现有修改范围与来源记录见 [vendor/NOTICE.md](src/server/music/vendor/NOTICE.md)。

本仓库没有把这些文件重授权为 MIT。使用或再分发时，应先核实对应权利与条件。

## 背景音乐

清单与运行时署名源为 `src/client/audio/tracks.ts`：

| 文件                          | 作者与作品页                                                                                                | 当前记录                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| `01-hitslab-upbeat.mp3`       | [HitsLab · Upbeat](https://pixabay.com/music/upbeat-upbeat-music-300654/)                                   | Pixabay Content License |
| `02-ikoliks-upbeat.mp3`       | [ikoliks_aj · Upbeat Music](https://pixabay.com/music/upbeat-upbeat-music-628248/)                          | Pixabay Content License |
| `03-chill-warm-story.mp3`     | [Strawberry_Candy · Warm Story](https://pixabay.com/music/chill-advertising-music-warm-story-627308/)       | Pixabay Content License |
| `04-sport-intense-metal.mp3`  | [Strawberry_Candy · Fast and Strong](https://pixabay.com/music/sport-intense-metal-fast-and-strong-622134/) | Pixabay Content License |
| `05-energetic-percussion.mp3` | [prettyjohn1 · Energetic_23Sec](https://pixabay.com/sound-effects/musical-energetic-23sec-484394/)          | Pixabay Content License |
| `06-romantic.mp3`             | 用户自备《罗曼蒂克》，原作者未标注                                                                          | 来源与许可待补充        |

[Pixabay 许可摘要](https://pixabay.com/service/license-summary/)包含独立分发限制，不能将这些原始音频当作 MIT 音乐包单独再发布。游戏中使用、源码中的原始文件分发与未来录屏的适用范围需分别核实。

## 音效

| 文件              | 来源                                                                                                    | 当前记录                   |
| ----------------- | ------------------------------------------------------------------------------------------------------- | -------------------------- |
| `card.mp3`        | 用户自备                                                                                                | 作者与许可待补充           |
| `event-open.mp3`  | [gamestudio · material mold #394512](https://freesound.org/people/gamestudio/sounds/394512/)            | 具体 CC 版本待按作品页确认 |
| `clue-gain.mp3`   | [alexis_gaming_cam · accepter 2 #394924](https://freesound.org/people/alexis_gaming_cam/sounds/394924/) | 具体 CC 版本待按作品页确认 |
| `reveal-loop.mp3` | [hi-hat loop #101166](https://freesound.org/s/101166/)                                                  | 作者与具体 CC 版本待确认   |

Freesound 作品不能仅凭网站名称统一视作 CC0；本轮未取得上述作品页的完整许可说明。

## 美术、标识与曲目内容

卡面、牌背、桌面、Logo 与图标包含项目作者提供的素材，历史记录见 `public/art/README.md`。原图来源、创作方式与可再分发许可待进一步整理，不统一标注为 MIT。

QQ 音乐、腾讯及歌曲/专辑相关名称、头像、封面、歌词与音频属于各自权利人的内容。候选曲目文件保存游戏所需资料，不捆绑 QQ 曲目的完整音频文件；运行时可用性受当前账号与上游服务约束。接口可读取不等于获得再分发权限。

## npm 与原生依赖

React、Fastify、SQLite 接口、undici、WebSocket 等依赖通过 npm/Node 取得，版本以 `package-lock.json` 和 Node.js 24 为准，适用各自项目的许可证。没有将 `node_modules/` 一并提交。

Windows 壳使用 WebView2，Android 壳使用系统 WebView；公开源码不包含 SDK 二进制、私有签名或历史安装包。构建和分发自己的客户端时仍需保留相应第三方声明。
