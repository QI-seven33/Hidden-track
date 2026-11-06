import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RARITY_LABELS } from '../shared/stage-events';
import { EventArtwork } from './EventArtwork';
type EventOption = {
  id: string;
  title: string;
  description: string;
  rarity: string;
};
export function EventCard({
  event: e,
  index,
  locked,
  disabled,
  refreshable,
  revealed,
  choose,
  refresh,
}: {
  event: EventOption;
  index: number;
  locked: boolean;
  disabled: boolean;
  refreshable: boolean;
  revealed: boolean;
  choose: () => void;
  refresh: () => void;
}) {
  const rarity =
    e.rarity in RARITY_LABELS
      ? (e.rarity as keyof typeof RARITY_LABELS)
      : 'silver';
  // 刷新时只是换了一张牌：原地翻一下，比整卡闪一下自然得多。
  const lastId = useRef(e.id);
  const [flipping, setFlipping] = useState(false);
  useEffect(() => {
    if (lastId.current === e.id) return;
    lastId.current = e.id;
    setFlipping(true);
    const timer = setTimeout(() => setFlipping(false), 560);
    return () => clearTimeout(timer);
  }, [e.id]);
  return (
    <article
      className={
        'gt-event-wrap rarity-' +
        rarity +
        (locked ? ' selected-event' : '') +
        (flipping ? ' is-refreshing' : '')
      }
      style={
        {
          '--ev-delay': index * 55 + 'ms',
        } as CSSProperties
      }
    >
      <button
        type="button"
        className={'gt-event' + (revealed ? ' is-revealed' : '')}
        disabled={disabled || !revealed}
        aria-label={
          revealed
            ? e.title + '：' + e.description + '，点击选择'
            : '事件卡背，即将自动翻开'
        }
        aria-pressed={locked}
        onClick={choose}
      >
        <span className="event-flipper">
          <span className="event-back" aria-hidden="true">
            <EventArtwork rarity={rarity} face="back" />
          </span>
          <span className="event-front" aria-hidden={!revealed}>
            <EventArtwork rarity={rarity} face="front" />
            {revealed && (
              <>
                <span className="gt-event-rarity">
                  {RARITY_LABELS[rarity]}事件
                </span>
                <strong className="gt-event-title">{e.title}</strong>
                <span className="gt-event-desc">{e.description}</span>
              </>
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="gt-refresh"
        disabled={disabled || !revealed || !refreshable}
        aria-label={'刷新第' + (index + 1) + '项事件'}
        title="只刷新这一项"
        onClick={refresh}
      >
        ↻
      </button>
    </article>
  );
}
