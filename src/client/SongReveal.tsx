import { useState } from 'react';
import type { RoomView } from '../shared/protocol';
import { AudioPlayer } from './DuelAudio';
import { DuelDialog, DuelLogs } from './DuelUI';
import { resultHeadline, resultNote } from './result-copy';
export function SongReveal({
  room,
  rematch,
  notice,
  back,
}: {
  room: RoomView;
  rematch: () => void;
  notice: string;
  back: () => void;
}) {
  const g = room.game!,
    outcome = g.outcome!,
    win = outcome.winner === room.me,
    draw = outcome.winner === 'draw';
  // 结算先展示对方的底牌：输了要知道自己没听出什么，赢了也要看对手藏了哪首。
  const [own, setOwn] = useState(false),
    [history, setHistory] = useState(false),
    [starting, setStarting] = useState(false);
  const song = g.revealed?.find((s) =>
    own ? s.seat === room.me : s.seat !== room.me,
  )?.song;
  // 标题只有一份来源：结束横幅和这里共用 resultHeadline，避免同一局两种说法。
  const headline = resultHeadline(outcome, room.me);
  return (
    <main className="md-duel" aria-label="对局结束，分享底牌音乐">
      <section className="page active">
        <div className="rmain">
          <div className="rcard">
            <div className="result-visual">
              <div className="cover">
                {song?.cover ? (
                  <img
                    src={song.cover}
                    alt={song.album + '专辑封面'}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="vinyl" />
                )}
              </div>
              {song?.providerMid && (
                <AudioPlayer
                  song={{
                    ...song,
                    id: 'qq:' + song.providerMid,
                    provider: 'qq',
                  }}
                  compact
                  autoPlay={!own}
                  // 结算卡现在晚 0.62s 才挂载（先播结果横幅），所以延时从 1600
                  // 收到 900，保证"卡片落定就响"，而不是干等两秒。
                  autoDelay={900}
                />
              )}
            </div>
            <div className="rbody">
              <span className={'rbadge' + (!win ? ' loss' : '')}>
                {draw ? '平局' : win ? '胜利' : '失败'} · {resultNote(outcome, room.me)}
              </span>
              {!draw && outcome.reason === 'pressureGuess' && (
                <div className="why-lost" role="note">
                  <b>压力到顶 = 立刻判负</b>
                  <p>
                    {outcome.cause
                      ? `最后一击：${outcome.cause}。`
                      : '压力被推到了上限。'}
                    压力是这局唯一的输法，<b>为线索支付的压力也算</b>
                    ——用信息牌前先看一眼自己还剩多少额度，别把自己打爆。
                  </p>
                </div>
              )}
              <h1>{headline}</h1>
              <div className="ans">
                <button
                  className="answer-label"
                  onClick={() => setOwn((v) => !v)}
                  title="切换查看双方底牌"
                >
                  {own ? '你的底牌' : '对方的底牌'} ⇄
                </button>
                <h2>
                  {song?.providerMid ? (
                    <a
                      href={
                        'https://y.qq.com/n/ryqq_v2/songDetail/' +
                        encodeURIComponent(song.providerMid)
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      {song.title}
                    </a>
                  ) : (
                    song?.title || '底牌揭晓'
                  )}
                </h2>
                <p>{song?.artists.join(' / ')}</p>
                <p className="al">
                  {song?.album ? '专辑《' + song.album + '》' : '专辑未提供'}
                </p>
              </div>
              <div className="stats">
                <div className="st">
                  <b>{g.round}</b>
                  <span>对局轮次</span>
                </div>
                <div className="st">
                  <b>
                    {g.stats?.cardsPlayed ??
                      g.log.filter(
                        (l) => l.kind === 'card' && l.side === room.me,
                      ).length}
                  </b>
                  <span>打出卡牌</span>
                </div>
                <div className="st">
                  <b>{g.clues.length}</b>
                  <span>获得线索</span>
                </div>
              </div>
              <div className="racts">
                <button
                  className="pri"
                  disabled={starting}
                  onClick={() => {
                    setStarting(true);
                    rematch();
                    setTimeout(() => setStarting(false), 1200);
                  }}
                >
                  {starting ? '准备新一局…' : '再来一局'}
                </button>
                <button onClick={back}>返回牌桌</button>
              </div>
              <button className="result-log" onClick={() => setHistory(true)}>
                查看对局记录
              </button>
              {notice && <p role="alert">{notice}</p>}
            </div>
          </div>
        </div>
      </section>
      {history && (
        <DuelDialog title="对局记录" close={() => setHistory(false)}>
          <DuelLogs room={room} />
        </DuelDialog>
      )}
    </main>
  );
}
