import { useEffect, useRef, useState } from 'react';
import type { RoomView } from '../shared/protocol';
import { EventCard } from './EventCard';
import { EVENT_NAMES } from './DuelUI';
type Stage = NonNullable<RoomView['game']>['stageEvent'];
/** Local selection previews; confirmation alone commits on the server. */
export function EventSelection({
  stage,
  busy,
  choose,
  refresh,
  round,
  open,
  collapse,
}: {
  stage: Stage;
  busy: boolean;
  choose: (id: string) => void;
  refresh: (id: string) => void;
  round: number;
  open: boolean;
  collapse: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState(''),
    [revealed, setRevealed] = useState(false);
  const choosing = stage.waiting && !stage.selected;
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 220);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (open && choosing && node && !node.open) node.showModal();
    else node?.close();
  }, [open, choosing]);
  useEffect(() => {
    if (!stage.options.some((e) => e.id === picked)) setPicked('');
  }, [stage.options, picked]);
  useEffect(() => () => dialog.current?.close(), []);
  const rarity = stage.options[0]?.rarity || 'silver';
  const choice = stage.options.find((e) => e.id === picked);
  if (!choosing) return null;
  return (
    <dialog
      ref={dialog}
      className="dlg-frame duel-event-dialog"
      aria-labelledby="duel-event-title"
      onCancel={(e) => {
        e.preventDefault();
        collapse();
      }}
    >
      <section className="evwin">
        <header className="evhead">
          <div className="evttl">
            <span className="flag">阶段前</span>
            <b id="duel-event-title">第 {round} 轮开始前 · 选择事件</b>
          </div>
          <div className="tabs" aria-label="事件阶段">
            {['silver', 'gold', 'prismatic'].map((r, i) => (
              <i
                key={r}
                className={
                  r === rarity
                    ? 'on'
                    : i < ['silver', 'gold', 'prismatic'].indexOf(rarity)
                      ? 'done'
                      : ''
                }
              >
                {EVENT_NAMES[r]}
              </i>
            ))}
          </div>
          <span className="pill">
            {stage.opponentSelected ? '对手已锁定' : '对手选择中'}
          </span>
          <button
            className="ev-close"
            aria-label="收起事件，查看牌桌"
            onClick={collapse}
          >
            收起
          </button>
        </header>
        <div className="evgrid">
          {stage.options.map((event, index) => (
            <EventCard
              // 用位置做 key：刷新后同一张卡不重新挂载，图片不会白一下，
              // 也能让 EventCard 自己播放一次「换牌」翻转动画。
              key={index}
              event={event}
              index={index}
              locked={picked === event.id}
              disabled={busy}
              revealed={revealed}
              refreshable={stage.refreshable.includes(event.id)}
              choose={() => setPicked(event.id)}
              refresh={() => refresh(event.id)}
            />
          ))}
        </div>
        <footer className="evfoot">
          <p className="evnote">
            每张卡各有 <b>1 次</b>免费刷新 · 剩余{' '}
            <b>
              {stage.freeRefresh} / {stage.options.length}
            </b>
            {stage.refreshes > 0 ? ` · 储备 ${stage.refreshes}` : ''}
          </p>
          <button
            className={'pgo' + (choice ? ' on' : '')}
            disabled={busy || !choice || !revealed}
            onClick={() => {
              if (choice) choose(choice.id);
            }}
          >
            {choice ? '确认 · ' + choice.title : '先选择一个事件'}
          </button>
        </footer>
      </section>
    </dialog>
  );
}
