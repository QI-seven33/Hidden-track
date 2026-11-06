import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PlayerAction, RoomView } from "../shared/protocol";
import { CARD_BY_ID } from "../shared/cards";
import type { CardId } from "../game/types";
import { EventSelection } from "./EventSelection";
import { api } from "./api";
import { errorText, goto } from "./utils";
import { AudioPlayer } from "./DuelAudio";
import { EffectLayer } from "./presentation/EffectLayer";
import { useCardMotion } from "./presentation/useCardMotion";
import { useHandPointer } from "./presentation/useHandPointer";
import { ART_PACK, artPath } from "./presentation/skin";
import { SongReveal } from "./SongReveal";
import { ResultBanner } from "./ResultBanner";
import {
  resultHeadline,
  resultKicker,
  resultKind,
  resultNote,
} from "./result-copy";
import { CardFace } from "./CardFace";
import { GuessDialog } from "./GuessDialog";
import { selfHarmWarning } from "./pressure-risk";
import { useDuelSfx } from "./audio/useDuelSfx";
import { playSfx, type SfxHandle } from "./audio/engine";
import { MiniPlayer } from "./audio/MiniPlayer";
import {
  DuelAvatar,
  DuelDialog,
  DuelLogs,
  EVENT_NAMES,
  EVENT_SYMBOLS,
} from "./DuelUI";
export { AudioPlayer } from "./DuelAudio";
type Game = NonNullable<RoomView["game"]>;
type Player = RoomView["players"][number];

/**
 * 结算节拍音的音量。
 * 素材是 hi-hat 循环（RMS −24dBFS、77% 能量在高频），实测比出牌音还响，
 * 但铲片的中高频听感更冲，所以压到 0.55（约 −5dB）垫在横幅下面。
 */
const REVEAL_VOLUME = 0.55;
function Countdown({
  clock,
  paused,
}: {
  clock: Game["clock"];
  paused?: boolean;
}) {
  const [now, setNow] = useState(Date.now()),
    offset = useRef(0);
  useEffect(() => {
    offset.current = clock ? clock.serverNow - Date.now() : 0;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [clock?.serverNow, clock?.deadline]);
  const seconds = clock
    ? Math.max(0, Math.ceil((clock.deadline - now - offset.current) / 1000))
    : 0;
  return (
    <span
      className={"timer" + (seconds <= 10 && clock ? " urgent" : "")}
      role="timer"
    >
      {paused ? "暂停" : clock ? seconds + "s" : "—"}
    </span>
  );
}
/**
 * 阶段读条：手牌上方一条细线，双方都看得到还剩多久。
 * 响应、出牌、选择、猜歌都有独立时限，统一用同一个条显示，
 * 文字前缀按阶段换，避免玩家只看到倒计时数字却不知道在等什么。
 */
const CLOCK_LABELS: Record<string, string> = {
  play: "出牌",
  response: "响应",
  choice: "选择",
  discard: "弃牌",
  guess: "猜歌",
  events: "选事件",
};
function ResponseTimer({ clock }: { clock: Game["clock"] }) {
  const [now, setNow] = useState(Date.now()),
    offset = useRef(0);
  useEffect(() => {
    offset.current = clock ? clock.serverNow - Date.now() : 0;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(timer);
  }, [clock?.serverNow, clock?.deadline]);
  if (!clock) return null;
  const total = Math.max(1, (clock.seconds ?? 15) * 1000);
  const remain = Math.max(0, clock.deadline - now - offset.current);
  const percent = Math.max(0, Math.min(100, (remain / total) * 100));
  const label = CLOCK_LABELS[clock.kind || ""] || "计时";
  return (
    <div
      className={
        "resp-timer kind-" +
        (clock.kind || "play") +
        (percent < 34 ? " urgent" : "")
      }
      role="timer"
      aria-label={label + "剩余 " + Math.ceil(remain / 1000) + " 秒"}
    >
      <span className="rt-lab">{label}</span>
      <span className="rt-bar">
        <i style={{ width: percent + "%" }} />
      </span>
      <span className="rt-num">{Math.ceil(remain / 1000)}s</span>
    </div>
  );
}
function Pips({ player: p }: { player: Player }) {
  return (
    <span
      className="pips"
      data-ap
      aria-label={`行动点 ${p.energy}/${p.maxEnergy}`}
    >
      {Array.from({ length: p.maxEnergy }, (_, i) => (
        <i key={i} className={"pip" + (i < p.energy ? " on" : "")} />
      ))}
    </span>
  );
}
function Pressure({ player: p }: { player: Player }) {
  return (
    <span className="press" data-pressure>
      <span
        className="bar"
        role="meter"
        aria-label={p.name + "压力"}
        aria-valuemin={0}
        aria-valuemax={p.pressureCap}
        aria-valuenow={p.pressure}
      >
        <i
          style={{
            width: Math.min(100, (p.pressure / p.pressureCap) * 100) + "%",
          }}
        />
      </span>
      <em>
        {p.pressure}
        {p.pressureCap === 100 ? "%" : "/" + p.pressureCap}
      </em>
    </span>
  );
}
export function GameBoard({
  room,
  busy,
  action,
  presentationEpoch = 0,
}: {
  room: RoomView;
  busy: boolean;
  action: (a: PlayerAction) => void;
  presentationEpoch?: number;
}) {
  const table = useRef<HTMLElement>(null),
    stage = useRef<HTMLElement>(null);
  const g = room.game!,
    me = room.players.find((p) => p.seat === room.me)!,
    enemy = room.players.find((p) => p.seat !== room.me)!;
  useDuelSfx(g, room.me);
  const [selected, setSelected] = useState(""),
    // 打出被拒绝的手牌：弹一下再回位，指明「这张现在打不出去」
    [rejectId, setRejectId] = useState(""),
    [locks, setLocks] = useState<number[]>([]),
    [eventOpen, setEventOpen] = useState(true);
  const [panel, setPanel] = useState<
      "history" | "menu" | "events" | "secret" | "leave" | ""
    >(""),
    [owner, setOwner] = useState(room.me);
  const [guessOpen, setGuessOpen] = useState(false),
    [inspect, setInspect] = useState<{ title: string; description: string }>();
  const [notice, setNotice] = useState(""),
    [resultOpen, setResultOpen] = useState(true);
  // 结算不是「啪」一下换屏：banner 先把结果砸出来，handoff 时结算卡接上，
  // done 之后横幅撤走。中途刷新或重开一局都回到 idle。
  const [endStage, setEndStage] = useState<"idle" | "banner" | "handoff" | "done">(
    g.outcome ? "done" : "idle",
  );
  // 结算音句柄：跳过、换局或离开牌桌时提前淡出，别让 3.5s 的循环拖进结算页。
  const revealSfx = useRef<SfxHandle | undefined>(undefined);
  const stopRevealSfx = () => {
    revealSfx.current?.stop(0.12);
    revealSfx.current = undefined;
  };
  // 猜错提示：取最近一条失败的猜歌记录，双方都能看到猜的是什么歌。
  const lastMiss = [...g.log].reverse().find((l) => l.guessMiss);
  const [missToast, setMissToast] = useState<{
    id: number;
    mine: boolean;
    title: string;
  }>();
  useEffect(() => {
    if (!lastMiss || lastMiss.guessTitle === undefined) return;
    setMissToast({
      id: lastMiss.id,
      mine: lastMiss.side === room.me,
      title: lastMiss.guessTitle,
    });
  }, [lastMiss?.id]);
  useEffect(() => {
    if (!missToast) return;
    const timer = setTimeout(() => setMissToast(undefined), 3600);
    return () => clearTimeout(timer);
  }, [missToast?.id]);
  // 结束瞬间的节奏：牌桌定格 0.62s（横幅砸入），再用 0.32s 把横幅收进结算卡。
  // 每一步都是函数式更新——点击跳过会把状态直接推到 done，此时迟到的定时器
  // 不能再把画面拉回 banner。
  const outcomeKey = g.outcome
    ? [g.matchId, g.round, g.outcome.winner, g.outcome.reason].join(":")
    : "";
  useEffect(() => {
    if (!outcomeKey) {
      // 重开一局：上一局的结算音要立刻收掉，不能跟着新牌桌一起响。
      stopRevealSfx();
      setEndStage("idle");
      return;
    }
    const soft = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEndStage(soft ? "done" : "banner");
    // 结算节拍音：和横幅同一帧起，0.75s 后淡出 0.55s，正好在结算卡落定、
    // 对手底牌自动试听（1.5s）之前收干净。动效全关时压成一句轻提示。
    // 后台标签页里不响——这一声比出牌音长得多，被切回来后突然续上很怪。
    let live = true;
    revealSfx.current?.stop(0);
    revealSfx.current = undefined;
    if (!document.hidden)
      void playSfx("reveal", "neutral", 1, {
        volume: REVEAL_VOLUME,
        hold: soft ? 0.2 : 0.75,
        fade: soft ? 0.35 : 0.55,
        once: true,
      }).then((handle) => {
        // 解码慢过淡出时间时，本次结算已经不需要它了。
        if (!handle) return;
        if (live) revealSfx.current = handle;
        else handle.stop(0.05);
      });
    if (soft)
      return () => {
        live = false;
        stopRevealSfx();
      };
    const toHandoff = window.setTimeout(
      () => setEndStage((s) => (s === "banner" ? "handoff" : s)),
      620,
    );
    const toDone = window.setTimeout(
      () => setEndStage((s) => (s === "handoff" ? "done" : s)),
      940,
    );
    return () => {
      live = false;
      stopRevealSfx();
      window.clearTimeout(toHandoff);
      window.clearTimeout(toDone);
    };
  }, [outcomeKey]);
  const response = g.response?.defender === room.me;
  const discarding = !!(
    g.choice &&
    !g.choice.options?.length &&
    g.choice.hiddenCount === undefined &&
    g.choice.cards.length
  );
  useEffect(() => {
    const leave = () => setPanel("leave");
    addEventListener("request-room-leave", leave);
    return () => removeEventListener("request-room-leave", leave);
  }, []);
  const ownTurn =
    g.active === room.me &&
    !g.response &&
    !g.choice &&
    !g.waitingForChoice &&
    !g.rps &&
    !g.stageEvent.waiting &&
    !g.outcome;
  const picked = g.hand.find((h) => h.card.id === selected);
  // 信息牌是拿压力换的：付完可能直接到顶判负。出手前先算出最低代价，
  // 只要最低代价就能把自己推到上限，就在确认条上直接说清楚，别让人稀里糊涂自杀。
  const selfHarm = picked
    ? selfHarmWarning({
        cardId: picked.card.cardId,
        rules: room.rules,
        round: g.round,
        pressure: me.pressure,
        pressureCap: me.pressureCap,
        freeClues: me.events.some(
          (e) => e.id === "g-noise-free" && e.round === g.round,
        ),
      })
    : "";
  const handKey = g.hand.map((h) => h.card.id).join("|");
  useEffect(() => {
    setLocks([]);
    setSelected("");
    setEventOpen(true);
  }, [g.matchId, g.round, g.choice?.title]);
  useEffect(() => {
    if (selected && !g.hand.some((h) => h.card.id === selected))
      setSelected("");
  }, [handKey, selected]);
  useEffect(() => {
    if (!g.canGuess) setGuessOpen(false);
  }, [g.canGuess]);
  const latestCard = [...g.log]
    .reverse()
    .find((l) => l.kind === "card" && l.cardId && l.cardId in CARD_BY_ID);
  const tableDefinition =
    latestCard?.definition ||
    (latestCard?.cardId ? CARD_BY_ID[latestCard.cardId as CardId] : undefined);
  const prepareCard = useCardMotion(
    table,
    g.matchId + ":" + presentationEpoch,
    handKey,
    latestCard,
    room.me,
  );
  const act = (a: PlayerAction) => {
    setNotice("");
    action(a);
  };
  const reason = (id: string) =>
    discarding
      ? g.choice!.cards.some((c) => c.card.id === id && !c.unavailable)
        ? undefined
        : "这张牌不能弃置"
      : g.hand.find((h) => h.card.id === id)?.unavailable ||
        (!(ownTurn || response) ? "当前阶段不能出牌" : undefined);
  const canPlay = (id: string) =>
    !busy && !g.outcome && g.hand.some((h) => h.card.id === id) && !reason(id);
  const submit = (id: string, origin?: DOMRect) => {
    if (!canPlay(id)) return;
    if (discarding) act({ type: "chooseDiscard", instanceId: id });
    else {
      prepareCard(id, origin);
      act({ type: response ? "respond" : "playCard", instanceId: id });
    }
    setSelected("");
  };
  const pointer = useHandPointer({
    table,
    stage,
    identity:
      g.matchId + ":" + g.round + ":" + g.phase + ":" + presentationEpoch,
    canPlay,
    submit,
    select: (id) => setSelected((old) => (old === id ? "" : id)),
    // 只有"拖了打不出的牌再松手"才抖：点按仍然走正常选中，两套反馈不再打架。
    reject: (id) => {
      setSelected(id);
      setRejectId(id);
      window.setTimeout(
        () => setRejectId((v) => (v === id ? "" : v)),
        460,
      );
    },
  });
  const phaseHint = g.outcome
    ? g.outcome.text
    : g.mustGuess
      ? "请提交最终猜歌"
      : g.stageEvent.waiting
        ? g.stageEvent.selected
          ? "事件已锁定，等待对手"
          : "双方选择本轮事件"
        : g.rps
          ? g.rps.submitted
            ? "已出拳，等待对手"
            : "猜先：请选择出拳"
          : g.choice
            ? g.choice.title
            : g.waitingForChoice
              ? "等待对手选择"
              : g.response
                ? response
                  ? "受到攻击：可用蓝调响应"
                  : "等待对手响应"
                : ownTurn
                  ? "我的回合"
                  : "对手回合";
  const eventsPlayer = room.players.find((p) => p.seat === owner)!;
  const eventRarity =
    g.stageEvent.options[0]?.rarity ||
    (g.round >= 4 ? "prismatic" : g.round >= 3 ? "gold" : "silver");
  async function rematch() {
    try {
      await api("/rooms/" + room.id + "/rematch", { version: room.version });
      location.reload();
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  const eventBadges = (p: Player) => (
    <div className="evs" aria-label={p.name + "事件"}>
      {p.events.map((e) => (
        <button
          key={e.id}
          className={
            "hx " +
            (e.rarity === "gold"
              ? "gold"
              : e.rarity === "prismatic"
                ? "pris"
                : "")
          }
          title={e.title}
          aria-label={e.title + "，查看事件"}
          onClick={() => {
            setOwner(p.seat);
            setPanel("events");
          }}
        >
          <i>{EVENT_SYMBOLS[e.rarity] || "♪"}</i>
        </button>
      ))}
      {[1, 3, 4]
        .filter((r) => !p.events.some((e) => e.round === r))
        .map((r) => (
          <span key={r} className="hx locked" title={"第" + r + "轮事件"}>
            <i>R{r}</i>
          </span>
        ))}
    </div>
  );
  const result = g.outcome ? resultKind(g.outcome, room.me) : undefined;
  // 谁倒下：横幅停住的那 0.62s 里，让输掉那一侧的压力条脉冲一次，
  // 这是「我怎么就输了」最直接的答案，比结算页里一行小字有效得多。
  const hit =
    g.outcome && endStage === "banner"
      ? result === "draw"
        ? " end-hit-both"
        : result === "loss"
          ? " end-hit-me"
          : " end-hit-opp"
      : "";
  if (g.outcome && resultOpen && endStage !== "banner" && endStage !== "idle")
    return (
      <>
        <SongReveal
          room={room}
          notice={notice}
          rematch={() => void rematch()}
          back={() => setResultOpen(false)}
        />
        {endStage === "handoff" && (
          <ResultBanner
            kind={result ?? "draw"}
            kicker={resultKicker(g.outcome, room.me)}
            headline={resultHeadline(g.outcome, room.me)}
            note={resultNote(g.outcome, room.me)}
            leaving
            skip={() => {
              stopRevealSfx();
              setEndStage("done");
            }}
          />
        )}
      </>
    );
  return (
    <main
      ref={table}
      className={"md-duel" + hit}
      aria-label="音乐对局牌桌"
      // 点空白处收起选中：手指想「算了」的时候不用先出牌或去点别的牌。
      onClick={(e) => {
        if (!selected) return;
        const target = e.target as Element | null;
        if (
          target?.closest(
            ".duel-hand-card,.tapbar,.side,.topbar,.duel-dialog,.duel-event-dialog,.pv,.stage-prompt",
          )
        )
          return;
        setSelected("");
      }}
    >
      <section className="page active">
        <header className="topbar">
          <div className="tl">
            <button
              className="ib"
              aria-label="返回大厅"
              onClick={() => setPanel("leave")}
            >
              ‹
            </button>
            <span className="room">
              房间 {room.roomCode || room.id} ·{" "}
              {room.bot ? "练习对战" : "好友对战"}
            </span>
            <MiniPlayer />
          </div>
          <div className="tc">
            <span className="pill">第 {g.round} 轮</span>
            <span className={"pill turn" + (!ownTurn ? " opp" : "")}>
              {g.outcome
                ? "已结束"
                : g.stageEvent.waiting
                  ? "选择事件"
                  : ownTurn
                    ? "我的回合"
                    : response
                      ? "受击响应"
                      : g.active === room.me
                        ? "等待结算"
                        : "对手回合"}
            </span>
            <Countdown clock={g.clock} paused={room.developer?.paused} />
            {!g.outcome && g.stageEvent.waiting && !g.stageEvent.selected && (
              <button
                className="evtab on"
                onClick={() => setEventOpen((v) => !v)}
              >
                <span className="dot" />
                <span>事件 · {EVENT_NAMES[eventRarity]}</span>
                <b>{eventOpen ? "收起" : "展开"}</b>
              </button>
            )}
          </div>
          <div className="tr">
            <button className="ib sq" onClick={() => setPanel("history")}>
              记录
            </button>
            <button
              className="ib"
              aria-label="菜单"
              onClick={() => setPanel("menu")}
            >
              ≡
            </button>
          </div>
        </header>
        <div className="board">
          <div className="main">
            <div className="opp-row" data-player-side="bot">
              <DuelAvatar player={enemy} />
              <div className="who">
                <strong>{enemy.name}</strong>
                <Pressure player={enemy} />
              </div>
              <Pips player={enemy} />
              {eventBadges(enemy)}
              <div className="spacer" />
              <div
                className="mini-hand opponent-hand"
                aria-label={"对手" + enemy.handCount + "张手牌"}
              >
                {Array.from(
                  { length: Math.min(enemy.handCount, 8) },
                  (_, i) => (
                    <span
                      className="mb"
                      key={i}
                      style={{
                        backgroundImage: `url("${artPath(ART_PACK.cardBack)}")`,
                      }}
                    />
                  ),
                )}
                {enemy.handCount > 8 && <b>×{enemy.handCount}</b>}
              </div>
              <div className="decktag">
                <span className="dk" />
                <span>
                  牌库 <b>{enemy.deckCount}</b>
                </span>
              </div>
            </div>
            <section ref={stage} className="stage" aria-label="中央出牌区">
              {g.rps ? (
                <div className="decision">
                  <h2>猜先 · 第 {g.rps.round} 次</h2>
                  <p>
                    {g.rps.submitted
                      ? "已提交，等待对手"
                      : "双方秘密出拳，平局重猜；赢家支付压力获得线索。"}
                  </p>
                  <div className="decision-actions">
                    {(
                      [
                        ["rock", "石头"],
                        ["scissors", "剪刀"],
                        ["paper", "布"],
                      ] as const
                    ).map(([move, label]) => (
                      <button
                        key={move}
                        disabled={busy || g.rps!.submitted}
                        onClick={() => act({ type: "rps", move })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : g.choice && !discarding ? (
                <div className="decision">
                  <h2>{g.choice.title}</h2>
                  <div className="decision-actions">
                    {g.choice.options?.map((o) => (
                      <button
                        key={o.id}
                        disabled={busy || o.disabled}
                        onClick={() =>
                          act({ type: "chooseOption", option: o.id })
                        }
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {g.choice.hiddenCount !== undefined && (
                    <>
                      <div className="lock-cards">
                        {g.choice.cards.map(
                          ({ card, definition, unavailable }, i) => (
                            <button
                              key={card.id}
                              className={
                                "lock-card" + (locks.includes(i) ? " sel" : "")
                              }
                              disabled={busy || !!unavailable}
                              aria-label={
                                definition.title +
                                "，" +
                                (unavailable || definition.description)
                              }
                              aria-pressed={locks.includes(i)}
                              onClick={() =>
                                setLocks((old) =>
                                  old.includes(i)
                                    ? old.filter((n) => n !== i)
                                    : old.length < (g.choice!.lockCount || 2)
                                      ? [...old, i]
                                      : old,
                                )
                              }
                            >
                              <CardFace definition={definition} />
                            </button>
                          ),
                        )}
                      </div>
                      <button
                        className="decision-confirm"
                        disabled={busy || locks.length !== g.choice.lockCount}
                        onClick={() =>
                          act({ type: "chooseLocks", indices: locks })
                        }
                      >
                        确认封锁 {locks.length}/{g.choice.lockCount}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="stage-cards">
                    {tableDefinition ? (
                      <div
                        className={
                          "pv" + (latestCard!.responded ? " responded" : "")
                        }
                        key={latestCard!.id}
                      >
                        <div className="played-card">
                          <div className="skill-card">
                            <CardFace definition={tableDefinition} />
                          </div>
                        </div>
                        <div className="pv-copy">
                          <span
                            className={
                              "tag" + (latestCard!.responded ? " resp" : "")
                            }
                          >
                            {latestCard!.responded
                              ? latestCard!.side === room.me
                                ? "你响应"
                                : "对手响应"
                              : latestCard!.side === room.me
                                ? "你已打出"
                                : "对手已打出"}
                          </span>
                          <h3>{tableDefinition.title}</h3>
                          <p>{tableDefinition.description}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="hint">
                        <div className="n">♪</div>
                        <p>
                          {ownTurn ? (
                            <>
                              把下方手牌 <b>拖进这里</b> 打出
                            </>
                          ) : (
                            phaseHint
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                  {(response ||
                    discarding ||
                    g.stageEvent.waiting ||
                    g.waitingForChoice ||
                    g.mustGuess) && (
                    <div className="stage-prompt" role="status">
                      <b>{phaseHint}</b>
                      {discarding && <span>从下方手牌选择一张确认弃置</span>}
                      {response && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            act({ type: "respond", instanceId: null })
                          }
                        >
                          {g.response?.kind === "dying"
                            ? "放弃自救"
                            : "承受攻击"}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="ticker" aria-live="polite">
                最新：<b>{g.log.at(-1)?.text || "对局开始"}</b>
              </div>
            </section>
            <div className="dock">
              <div className="me-stack" data-player-side="human">
                {eventBadges(me)}
                <div className="me-line">
                  <span className="lab">能量</span>
                  <Pips player={me} />
                  <em>
                    {me.energy}/{me.maxEnergy}
                  </em>
                </div>
                <div className="me-line">
                  <span className="lab">压力</span>
                  <Pressure player={me} />
                </div>
                <div className="me-id">
                  <DuelAvatar player={me} own />
                  <strong>{me.name}</strong>
                </div>
              </div>
              <div
                className={
                  "hand-wrap" + (response ? " is-responding" : "")
                }
              >
                {missToast && (
                  <div
                    className={"guess-miss" + (missToast.mine ? " mine" : "")}
                    role="status"
                  >
                    <b>{missToast.mine ? "猜错了" : "对手猜错了"}</b>
                    <span>
                      {missToast.mine ? "你猜的" : "对手猜的"}《
                      {missToast.title}》不是底牌
                    </span>
                  </div>
                )}
                {g.clock && !g.outcome && <ResponseTimer clock={g.clock} />}
                <div
                  className={"hand" + (g.hand.length > 6 ? " scroll" : "")}
                  style={{ "--n": Math.max(1, g.hand.length) } as CSSProperties}
                >
                  {g.hand.map(({ card, definition }, i) => (
                    <button
                      key={card.id}
                      data-motion-card={card.id}
                      className={
                        "duel-hand-card" +
                        (selected === card.id ? " sel" : "") +
                        (reason(card.id) ? " unavailable" : "") +
                        (rejectId === card.id ? " reject" : "")
                      }
                      style={{ "--order": i } as CSSProperties}
                      aria-label={
                        definition.title +
                        "，" +
                        definition.cost +
                        "行动点，" +
                        (reason(card.id) || definition.description)
                      }
                      aria-pressed={selected === card.id}
                      onPointerDown={(e) => pointer.down(e, card.id)}
                      onPointerMove={pointer.move}
                      onPointerUp={pointer.up}
                      onPointerCancel={pointer.cancel}
                      onLostPointerCapture={pointer.lost}
                      onClick={() => pointer.click(card.id)}
                    >
                      <span className="skill-card">
                        <CardFace
                          definition={definition}
                          generated={card.generated}
                        />
                      </span>
                    </button>
                  ))}
                  {!g.hand.length && <p className="clue-empty">暂时没有手牌</p>}
                </div>
                {picked && (
                  <div className="tapbar">
                    {selfHarm && (
                      <span className="tap-danger" role="alert">
                        {selfHarm}
                      </span>
                    )}
                    <button
                      className="x"
                      aria-label="查看卡牌详情"
                      onClick={() => setInspect(picked.definition)}
                    >
                      ?
                    </button>
                    <button
                      className="go"
                      disabled={!canPlay(picked.card.id)}
                      title={reason(picked.card.id)}
                      onClick={() => submit(picked.card.id)}
                    >
                      {discarding ? "确认弃牌" : response ? "确认响应" : "打出"}
                    </button>
                    <button
                      className="x"
                      aria-label="取消选择"
                      onClick={() => setSelected("")}
                    >
                      ×
                    </button>
                    {reason(picked.card.id) && (
                      <span className="tap-reason">
                        {reason(picked.card.id)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="my-deck deck-stack">
                <span
                  className="dk card-back"
                  style={{
                    backgroundImage: `url("${artPath(ART_PACK.cardBack)}")`,
                  }}
                />
                <span className="decknums">
                  <span className="decktag">
                    库 <b>{me.deckCount}</b>
                  </span>
                  <span className="decktag">
                    弃 <b>{me.discardCount ?? 0}</b>
                  </span>
                </span>
              </div>
            </div>
          </div>
          <aside className="side">
            <div className="clue">
              <header className="clue-head">
                <h2>歌曲线索</h2>
                <span className="cnt">{g.clues.length} 条</span>
              </header>
              <p className="clue-rule">
                {room.rules.fusion
                  ? "2 条同档线索自动合成 1 条高阶线索"
                  : "本局未开启线索合成"}
              </p>
              <div className="clue-list">
                {g.cluesHidden ? (
                  <p className="clue-empty">
                    线索暂被事件隐藏，恢复后重新显示。
                  </p>
                ) : (
                  g.clues.map((c) => (
                    <article
                      className={
                        "row t-" +
                        ["", "base", "adv", "key", "ult"][c.tier] +
                        (c.spent ? " spent" : "")
                      }
                      key={c.id}
                    >
                      <span className="tier">
                        {["", "基础", "进阶", "关键", "终极"][c.tier]}
                      </span>
                      <div className="rc">
                        <p>{c.value}</p>
                        {c.translation && <small>译文：{c.translation}</small>}
                      </div>
                      {c.fused && <span className="gen">合成</span>}
                      {c.spent && <span className="gen">已合成</span>}
                      {c.image && (
                        <img
                          className="thumb"
                          src={c.image}
                          alt="已解锁专辑封面"
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </article>
                  ))
                )}
                {!g.cluesHidden && !g.clues.length && (
                  <p className="clue-empty">还没有线索</p>
                )}
                {g.previewSeconds > 0 && !g.cluesHidden && (
                  <div className="row t-ult audio-clue">
                    <span className="tier">试听</span>
                    <div className="rc">
                      <p>已解锁 {g.previewSeconds} 秒</p>
                      <AudioPlayer
                        roomId={room.id}
                        permissionKey={g.matchId}
                        seconds={g.previewSeconds}
                        compact
                      />
                    </div>
                  </div>
                )}
                <div className="row slot">
                  {g.clues.length
                    ? "下一条线索会出现在这里"
                    : "打出《引子》《升 Key》或《猜先》可获得线索"}
                </div>
              </div>
              <footer className="clue-foot">
                <div className="bud">
                  <span className="lab">试听</span>
                  <div className="segs">
                    {Array.from({ length: 6 }, (_, i) => (
                      <i
                        key={i}
                        className={i * 10 < g.previewSeconds ? "on" : ""}
                      />
                    ))}
                  </div>
                  <em>{g.previewSeconds}/60</em>
                </div>
                <div className="cnts">
                  {["基础", "进阶", "关键", "终极"].map((label, i) => (
                    <span key={label}>
                      {label}{" "}
                      <b>{g.clues.filter((c) => c.tier === i + 1).length}</b>
                    </span>
                  ))}
                </div>
              </footer>
            </div>
            <div className="acts">
              <button
                className="guess"
                disabled={busy || !g.canGuess}
                onClick={() => setGuessOpen(true)}
              >
                {g.mustGuess ? "最终猜歌" : "猜歌"}
                <span className="badge">{g.guessesRemaining}</span>
              </button>
              <button
                className="end"
                disabled={busy || !g.canEndTurn}
                onClick={() => {
                  setSelected("");
                  act({ type: "endTurn" });
                }}
              >
                结束回合
              </button>
            </div>
          </aside>
        </div>
        <EventSelection
          key={g.matchId + ":" + g.round}
          stage={g.stageEvent}
          busy={busy}
          round={g.round}
          open={eventOpen}
          collapse={() => setEventOpen(false)}
          choose={(eventId) => act({ type: "chooseEvent", eventId })}
          refresh={(eventId) => act({ type: "refreshEvents", eventId })}
        />
        <GuessDialog
          room={room}
          busy={busy}
          open={guessOpen}
          close={() => setGuessOpen(false)}
          action={act}
        />
        <EffectLayer
          roomId={room.id + ":" + g.matchId}
          events={g.log}
          epoch={presentationEpoch}
          me={room.me}
        />
        {g.outcome && endStage === "banner" && (
          <ResultBanner
            kind={result ?? "draw"}
            kicker={resultKicker(g.outcome, room.me)}
            headline={resultHeadline(g.outcome, room.me)}
            note={resultNote(g.outcome, room.me)}
            skip={() => {
              stopRevealSfx();
              setEndStage("done");
            }}
          />
        )}
        {g.outcome && (
          <button className="result-return" onClick={() => setResultOpen(true)}>
            查看结算
          </button>
        )}
        {panel && (
          <DuelDialog
            title={
              {
                history: "对局记录",
                menu: "菜单",
                events: "事件与状态",
                secret: "你的底牌 · 仅自己可见",
                leave: "返回大厅",
              }[panel]
            }
            close={() => setPanel("")}
          >
            {panel === "history" ? (
              <DuelLogs room={room} />
            ) : panel === "events" ? (
              <>
                <div className="tabs">
                  <button
                    onClick={() => setOwner(room.me)}
                    aria-pressed={owner === room.me}
                  >
                    我的事件
                  </button>
                  <button
                    onClick={() => setOwner(enemy.seat)}
                    aria-pressed={owner !== room.me}
                  >
                    对手事件
                  </button>
                </div>
                {eventsPlayer.statuses.map((s) => (
                  <p className="status-line" key={s}>
                    {s}
                  </p>
                ))}
                {eventsPlayer.events.map((e) => (
                  <article className="event-detail" key={e.id}>
                    <b>{e.title}</b>
                    <small>
                      第 {e.round} 轮 · {EVENT_NAMES[e.rarity]}事件
                    </small>
                    <p>{e.description}</p>
                  </article>
                ))}
                {!eventsPlayer.events.length && <p>选过的事件会保留在这里。</p>}
              </>
            ) : panel === "secret" ? (
              <>
                <h3>{room.ownSong?.title}</h3>
                <p>{room.ownSong?.artists.join(" / ")}</p>
                <p>{room.ownSong?.album}</p>
              </>
            ) : panel === "leave" ? (
              <>
                <p>当前房间保留，可通过原链接继续。</p>
                <button
                  className="gconfirm"
                  onClick={() => {
                    goto("/");
                  }}
                >
                  返回大厅
                </button>
              </>
            ) : (
              <div className="menu-actions">
                <button
                  onClick={() => {
                    setPanel("");
                    dispatchEvent(new Event("open-room-settings"));
                  }}
                >
                  设置与规则
                </button>
                <button onClick={() => setPanel("secret")}>我的底牌</button>
                <button
                  onClick={() => {
                    setOwner(room.me);
                    setPanel("events");
                  }}
                >
                  事件与状态
                </button>
                {g.growthCards.map((c) => (
                  <button
                    key={c.id}
                    disabled={busy || !!c.unavailable}
                    title={c.unavailable}
                    onClick={() => act({ type: "useGrowth", instanceId: c.id })}
                  >
                    成长 Lv.{c.level + 1}
                  </button>
                ))}
                {import.meta.env.DEV && room.developer && (
                  <button
                    onClick={() => {
                      setPanel("");
                      dispatchEvent(new Event("open-developer-options"));
                    }}
                  >
                    开发者选项
                  </button>
                )}
              </div>
            )}
          </DuelDialog>
        )}
        {inspect && (
          <DuelDialog title={inspect.title} close={() => setInspect(undefined)}>
            <p className="full-description">{inspect.description}</p>
          </DuelDialog>
        )}
        {notice && (
          <p className="duel-notice" role="status">
            {notice}
          </p>
        )}
      </section>
    </main>
  );
}
