import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import { warmCardArt } from './presentation/preload';
import { api, ApiError } from './api';
import { errorText, copyText, goto } from './utils';
import type { PlayerAction, RoomView } from '../shared/protocol';
import type { GameRules } from '../game/types';
import { commandId } from './uuid';
const DeveloperOptions = import.meta.env.DEV
  ? lazy(() =>
      import('./DeveloperOptions').then((m) => ({
        default: m.DeveloperOptions,
      })),
    )
  : null;
import type { DeveloperPatch } from '../shared/developer';
import { GameBoard } from './GameBoard';
import { MangaSelection } from './MangaSelection';
import { MangaDialog, MangaFrame, MangaSheet } from './MangaUI';
import { RulesDoc } from './RulesDoc';
export function RoomPage({
  id,
  onDuel,
}: {
  id: string;
  onDuel?: (duel: boolean) => void;
}) {
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    addEventListener('open-room-settings', open);
    return () => removeEventListener('open-room-settings', open);
  }, []);
  useEffect(() => {
    const open = () => setDeveloperOpen(true);
    addEventListener('open-developer-options', open);
    return () => removeEventListener('open-developer-options', open);
  }, []);
  const [room, setRoom] = useState<RoomView>();
  const latest = useRef<RoomView | undefined>(undefined);
  const suppressEffects = useRef(true);
  const [presentationEpoch, setPresentationEpoch] = useState(0);
  const [connection, setConnection] = useState('连接中');
  const [error, setError] = useState('');
  const [artReady, setArtReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void warmCardArt()
      .then(() => {
        if (alive) setArtReady(true);
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const mutationPending = useRef(false);
  const [invite, setInvite] = useState(
    new URLSearchParams(location.hash.slice(1)).get('invite') || '',
  );
  const [copyStatus, setCopyStatus] = useState('');
  const [manualInvite, setManualInvite] = useState('');
  const inviteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(''), 3200);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  useEffect(() => {
    if (manualInvite) inviteDialog.current?.showModal();
    else inviteDialog.current?.close();
  }, [manualInvite]);
  const [join, setJoin] = useState(false);
  useEffect(() => {
    onDuel?.(!!room?.game);
  }, [room?.game, onDuel]);
  useEffect(() => () => onDuel?.(false), [onDuel]);
  useEffect(() => {
    // 真实头像来自服务端的 QQ 账号资料，和房间模式无关。
    // 这里原来只在 qq 房请求，练习对战（fixture + bot）就一直是名字首字。
    // 未授权时接口返回 { updated: false }，不会抛错，所以不必按模式判断。
    if (room?.id) void api('/rooms/' + id + '/avatar', {}).catch(() => {});
  }, [room?.id, id]);
  const receive = useCallback((next: RoomView) => {
    if (!latest.current || next.version >= latest.current.version) {
      if (suppressEffects.current) {
        suppressEffects.current = false;
        setPresentationEpoch((value) => value + 1);
      }
      latest.current = next;
      setRoom(next);
    }
  }, []);
  const reload = useCallback(async () => {
    const result = await api<{ room: RoomView }>(`/rooms/${id}`);
    receive(result.room);
  }, [id, receive]);
  useEffect(() => {
    latest.current = undefined;
    setRoom(undefined);
    void reload().catch((e) => {
      if (e instanceof ApiError && e.status === 403 && invite) setJoin(true);
      else setError(errorText(e));
    });
  }, [id, reload]);
  useEffect(() => {
    if (!room) return;
    let stopped = false;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let backoff = 600;
    const connect = () => {
      if (stopped) return;
      setConnection('连接中');
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${id}/socket`,
      );
      socket.onopen = () => {
        suppressEffects.current = true;
        backoff = 600;
        setConnection('已连接');
        void reload().catch(() => {});
      };
      socket.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'snapshot') receive(event.room);
        } catch {}
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        suppressEffects.current = true;
        if (!stopped) {
          setConnection('断线重连中');
          timer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 10000);
        }
      };
    };
    connect();
    const visible = () => {
      if (!document.hidden) {
        suppressEffects.current = true;
        void reload().catch(() => {});
      }
    };
    addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
      removeEventListener('visibilitychange', visible);
    };
  }, [id, Boolean(room), receive, reload]);
  // 版本落后是多人对局里正常的同步竞争（网络抖动时尤其常见），
  // 静默拉一次最新快照就够了，不该用红字吓用户。
  const recover = async (e: unknown) => {
    if (e instanceof ApiError && e.code === 'STALE_VERSION') {
      await reload().catch(() => {});
      return;
    }
    setError(errorText(e));
    await reload().catch(() => {});
  };
  const mutate = async (path: string, body: unknown) => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true);
    setError('');
    try {
      if (path === '/ready' || path === '/start') await warmCardArt();
      const result = await api<{ room: RoomView }>(`/rooms/${id}${path}`, body);
      receive(result.room);
    } catch (e) {
      await recover(e);
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  };
  const startVersion = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      !room?.canStart ||
      room.game ||
      busy ||
      startVersion.current === room.version
    )
      return;
    startVersion.current = room.version;
    void mutate('/start', { version: room.version });
  }, [room?.canStart, room?.version, busy]);
  const action = async (value: PlayerAction) => {
    const current = latest.current;
    if (!current || mutationPending.current) return;
    mutationPending.current = true;
    const command = {
      id: commandId(),
      version: current.version,
      action: value,
    };
    setBusy(true);
    setError('');
    try {
      let result;
      try {
        result = await api<{ room: RoomView }>(`/rooms/${id}/action`, command);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        result = await api<{ room: RoomView }>(`/rooms/${id}/action`, command);
      }
      receive(result.room);
    } catch (e) {
      await recover(e);
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  };
  async function saveDeveloper(patch: DeveloperPatch) {
    const current = latest.current;
    if (!current || mutationPending.current) return false;
    mutationPending.current = true;
    setBusy(true);
    setError('');
    const command = { id: commandId(), version: current.version, patch };
    try {
      let result;
      try {
        result = await api<{ room: RoomView }>(
          '/rooms/' + id + '/developer',
          command,
        );
      } catch (e) {
        if (e instanceof ApiError) throw e;
        result = await api<{ room: RoomView }>(
          '/rooms/' + id + '/developer',
          command,
        );
      }
      receive(result.room);
      return true;
    } catch (e) {
      setError(errorText(e));
      await reload().catch(() => {});
      return false;
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }
  async function copyInvite() {
    try {
      let token = invite;
      if (!token) {
        const result = await api<{ invite: string }>(`/rooms/${id}/invite`, {});
        token = result.invite;
        setInvite(token);
      }
      const url = `${location.origin}/r/${id}#invite=${token}`;
      setCopyStatus('');
      const ok = await copyText(url);
      if (ok) setCopyStatus('邀请链接已复制');
      else setManualInvite(url);
    } catch (e) {
      setCopyStatus(errorText(e));
    }
  }
  if (join)
    return (
      <MangaFrame lobby>
        <MangaSheet
          title="加入房间"
          close={() => {
            goto('/');
          }}
        >
          <button
            className="mg-btn mg-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api<{ room: RoomView }>(`/rooms/${id}/join`, { invite })
                .then((r) => {
                  receive(r.room);
                  setJoin(false);
                  setError('');
                })
                .catch((e) => setError(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            <span>{busy ? '加入中…' : '加入'}</span>
          </button>
          {error && (
            <p className="mg-state" role="alert">
              {error}
            </p>
          )}
        </MangaSheet>
      </MangaFrame>
    );
  if (!room || !artReady)
    return (
      <MangaFrame>
        <div className="mg-connecting" role="status">
          <p>{error || '连接中…'}</p>
          {error && (
            <button
              className="mg-btn"
              onClick={() => {
                setError('');
                void Promise.all([
                  reload(),
                  warmCardArt().then(() => setArtReady(true)),
                ]).catch((e) => setError(errorText(e)));
              }}
            >
              重试
            </button>
          )}
        </div>
      </MangaFrame>
    );
  if (!room.game)
    return (
      <MangaSelection
        room={room}
        busy={busy}
        error={error}
        select={(songId) =>
          void mutate('/song', {
            songId,
            version: latest.current!.version,
            ready: false,
          })
        }
        retryStart={
          room.canStart
            ? () => void mutate('/start', { version: latest.current!.version })
            : undefined
        }
        ready={(ready) =>
          void mutate('/ready', { version: latest.current!.version, ready })
        }
        swap={() => void mutate('/swap', { version: latest.current!.version })}
        answerSwap={(accept) =>
          void mutate('/swap/respond', {
            version: latest.current!.version,
            accept,
          })
        }
      />
    );
  return (
    <div className={`room-content room-${room.status}`}>
      <div className="room-top">
        <div>
          <span className="badge">
            {room.mode === 'qq' ? 'QQ 音乐真实曲目' : '本地测试曲目'}
          </span>
          <span className="connection">
            {connection} · 状态 {room.version}
          </span>
        </div>
        <div>
          {room.status === 'waiting' && room.me === 'a' && !room.bot && (
            <button onClick={() => void copyInvite()}>复制邀请链接</button>
          )}
          <button
            onClick={() => {
              setError('');
              void Promise.all([
                reload(),
                warmCardArt().then(() => setArtReady(true)),
              ]).catch((e) => setError(errorText(e)));
            }}
          >
            同步
          </button>
        </div>
      </div>
      {copyStatus && (
        <div role="status" className="room-toast">
          <span>{copyStatus}</span>
          <button aria-label="关闭复制提示" onClick={() => setCopyStatus('')}>
            关闭
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="room-toast error">
          <span>{error}</span>
          <button aria-label="关闭错误提示" onClick={() => setError('')}>
            关闭
          </button>
        </div>
      )}
      <dialog
        ref={inviteDialog}
        className="dlg-frame"
        onClose={() => setManualInvite('')}
      >
        <div className="invite-dialog">
          <header>
            <h2>复制邀请链接</h2>
            <button onClick={() => setManualInvite('')}>关闭</button>
          </header>
          <p>浏览器未允许自动复制，选中下方链接后复制即可。</p>
          <input
            aria-label="邀请链接"
            readOnly
            value={manualInvite}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="primary" onClick={() => setManualInvite('')}>
            完成
          </button>
        </div>
      </dialog>
      {DeveloperOptions &&
        developerOpen &&
        (room.developer ? (
          <DeveloperOptions
            room={room}
            busy={busy}
            save={saveDeveloper}
            close={() => setDeveloperOpen(false)}
          />
        ) : (
          <MangaDialog title="开发者选项" close={() => setDeveloperOpen(false)}>
            <p>
              开局前可在房间规则中调整常规参数。局内自由调数仅在本机“与练习电脑试一局”中开放。
            </p>
          </MangaDialog>
        ))}
      {settingsOpen && (
        <MangaDialog title="设置" close={() => setSettingsOpen(false)}>
          <div className="room-settings">
            <h3>玩法与卡牌</h3>
            <p>
              藏一首歌，出牌交换线索，最后揭晓彼此的音乐。第 1、3、4
              轮分别选择银、金、棱彩事件，再依次出牌。
            </p>
            <p>
              自己的回合结束重置 3 点行动点，用于出牌；行动点为 0
              仍可免费响应和猜歌。压力达到 100 直接判负，猜中立即获胜；猜错默认
              +25 压力。
            </p>
            <button
              className="mg-btn room-settings-action"
              onClick={() => {
                setSettingsOpen(false);
                setRulesOpen(true);
              }}
            >
              完整规则说明
            </button>
            {!room.game && room.me === 'a' && (
              <RuleEditor
                rules={room.rules}
                busy={busy}
                save={(rules) =>
                  void mutate('/rules', {
                    version: latest.current!.version,
                    rules,
                  })
                }
              />
            )}
            {!room.game && room.me !== 'a' && (
              <p className="room-settings-note">
                手牌上限 {room.rules.handLimit}；主动线索压力{' '}
                {room.rules.cluePressure[1]}% / {room.rules.cluePressure[2]}% /{' '}
                {room.rules.cluePressure[3]}% / {room.rules.cluePressure[4]}%。
              </p>
            )}
            {room.game && (
              <button
                className="mg-btn room-settings-action"
                onClick={() => {
                  goto('/');
                }}
              >
                重新开始 · 回到首页
              </button>
            )}
            {import.meta.env.DEV && room.developer && (
              <button
                className="mg-btn room-settings-action"
                onClick={() => {
                  setSettingsOpen(false);
                  setDeveloperOpen(true);
                }}
              >
                开发者选项
              </button>
            )}
          </div>
        </MangaDialog>
      )}
      {rulesOpen && (
        <MangaDialog title="玩法说明" wide close={() => setRulesOpen(false)}>
          <RulesDoc />
        </MangaDialog>
      )}
      <GameBoard
        room={room}
        presentationEpoch={presentationEpoch}
        busy={busy}
        action={(value) => void action(value)}
      />
    </div>
  );
}
function RuleEditor({
  rules,
  save,
  busy,
}: {
  rules: GameRules;
  save: (rules: GameRules) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(rules);
  useEffect(() => setDraft(rules), [rules]);
  const fields = [
    ['maxEnergy', '行动点上限', 1, 10],
    ['startingEnergy', '每回合起始行动点', 1, 10],
    ['initialHand', '起手张数', 3, 10],
    ['drawPerTurn', '每回合摸牌', 1, 5],
    ['handLimit', '手牌上限', 1, 15],
    ['damagePressure', '每次攻击增加压力', 0, 50],
    ['guessMissPressure', '猜错增加压力', 0, 100],
    ['maxRounds', '轮数限制（0 为不限）', 0, 20],
  ] as const;
  return (
    <details>
      <summary>试玩参数 · 保存后双方重新准备</summary>
      <div className="rule-fields">
        {fields.map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              value={draft[key]}
              onChange={(e) =>
                setDraft({ ...draft, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        {([1, 2, 3, 4] as const).map((t) => (
          <label key={t}>
            {['', '基础', '进阶', '关键', '终极'][t]}线索压力 %
            <input
              type="number"
              min="0"
              max="50"
              value={draft.cluePressure[t]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  cluePressure: {
                    ...draft.cluePressure,
                    [t]: Number(e.target.value),
                  },
                })
              }
            />
          </label>
        ))}
      </div>
      <button disabled={busy} onClick={() => save(draft)}>
        保存房间参数
      </button>
      <small>仅影响本房间，开局后锁定。线索分级与数值仍是试玩参数。</small>
    </details>
  );
}
