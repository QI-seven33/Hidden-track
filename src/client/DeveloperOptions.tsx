import { useState } from 'react';
import type { GameRules, Side } from '../game/types';
import type { RoomView } from '../shared/protocol';
import { DEFAULT_RULES } from '../shared/rules';
import {
  DEVELOPER_PLAYER_FIELDS,
  DEVELOPER_RULE_FIELDS,
  developerPatchSchema,
  type DeveloperPatch,
} from '../shared/developer';
import { MangaDialog } from './MangaUI';

export function DeveloperOptions({
  room,
  busy,
  save,
  close,
}: {
  room: RoomView;
  busy: boolean;
  save: (patch: DeveloperPatch) => Promise<boolean>;
  close: () => void;
}) {
  const [rules, setRules] = useState<GameRules>(structuredClone(room.rules));
  const [players, setPlayers] = useState(() =>
    structuredClone(room.developer?.players),
  );
  const [side, setSide] = useState<Side>(room.me),
    [paused, setPaused] = useState(room.developer?.paused || false);
  const [error, setError] = useState('');
  const current = players?.[side];
  async function apply() {
    setError('');
    const parsed = developerPatchSchema.safeParse({
      rules,
      ...(room.game ? { players, paused } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || '请检查输入值');
      return;
    }
    if (await save(parsed.data)) close();
    else setError('未保存。请检查房间提示，关闭后重新打开以读取最新状态。');
  }
  return (
    <MangaDialog title="开发者选项 · 本地练习" close={close} wide>
      <p className="developer-notice">
        仅影响当前练习房间。
        {room.game
          ? '保存即时生效，并记录到对局日志。'
          : '保存后需重新确认准备。'}
        默认规则不会改变。
      </p>
      {room.game && (
        <>
          <label className="developer-pause">
            <input
              type="checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
            />
            暂停电脑与计时（仍可手动操作）
          </label>
          {!room.developer?.paused && (
            <button
              className="mg-btn"
              disabled={busy}
              onClick={() =>
                void save({ paused: true }).then((ok) => {
                  if (ok) close();
                  else setError('暂停失败，请关闭后重试。');
                })
              }
            >
              先暂停测试，再修改数值
            </button>
          )}
        </>
      )}
      <section className="developer-section">
        <h3>房间规则</h3>
        <div className="developer-grid">
          {DEVELOPER_RULE_FIELDS.map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                step="1"
                value={rules[key]}
                onChange={(e) =>
                  setRules({ ...rules, [key]: Number(e.target.value) })
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
                max="100"
                step="1"
                value={rules.cluePressure[t]}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    cluePressure: {
                      ...rules.cluePressure,
                      [t]: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="developer-footnote">
          {room.game
            ? '起手张数只影响下次开局；起始行动点从下个自己的回合生效。双方现有行动点上限在下方单独调整。'
            : '起手牌和每回合摸牌最多 22 张；手牌上限最多 99，行动点上限最多 99，压力上限最多 500%。'}
        </p>
      </section>
      {current && room.game && (
        <section className="developer-section">
          <h3>玩家当前数值</h3>
          <div className="mg-tabs">
            {room.players.map((p) => (
              <button
                key={p.seat}
                className="mg-btn"
                aria-pressed={side === p.seat}
                onClick={() => setSide(p.seat)}
              >
                {p.name}
                {p.seat === room.me ? ' · 你' : ''}
              </button>
            ))}
          </div>
          <div className="developer-grid">
            {DEVELOPER_PLAYER_FIELDS.map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  step="1"
                  value={current[key]}
                  onChange={(e) =>
                    setPlayers(
                      (old) =>
                        old && {
                          ...old,
                          [side]: {
                            ...old[side],
                            [key]: Number(e.target.value),
                          },
                        },
                    )
                  }
                />
              </label>
            ))}
          </div>
          <label className="developer-pause">
            <input
              type="checkbox"
              checked={current.informationUsed}
              onChange={(e) =>
                setPlayers(
                  (old) =>
                    old && {
                      ...old,
                      [side]: {
                        ...old[side],
                        informationUsed: e.target.checked,
                      },
                    },
                )
              }
            />
            本回合已使用信息牌（仅统计）
          </label>
          <p className="developer-footnote">
            当前行动点不能超过上限，压力不能超过压力上限。行动点设为 0
            不会判负；满压力会立即判负；不会回退已提交的猜歌、响应或事件。调低手牌上限后仍在回合末弃牌。
          </p>
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="developer-footer">
        <button
          className="mg-btn"
          onClick={() => setRules(structuredClone(DEFAULT_RULES))}
        >
          填入默认规则
        </button>
        <button
          className="mg-btn mg-primary"
          disabled={busy}
          onClick={() => void apply()}
        >
          {busy ? '保存中…' : room.game ? '应用到当前测试局' : '保存房间规则'}
        </button>
      </div>
    </MangaDialog>
  );
}
