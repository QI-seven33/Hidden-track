import type { ResultKind } from './result-copy';

/**
 * 结束瞬间的结果横幅。
 *
 * 存在的理由：outcome 一到，GameBoard 会整屏换成 SongReveal，以前是同一帧完成，
 * 玩家只感觉到「啪」一下换屏，连输赢都要去 9px 的徽章里找。
 * 这一层只负责把结果放大、停一下，然后在交接时收缩飞向结算卡左上角。
 *
 * 纯展示：不读房间状态、不发请求；点击回调交给外层决定要不要跳过。
 */
export function ResultBanner({
  kind,
  kicker,
  headline,
  note,
  leaving = false,
  skip,
}: {
  kind: ResultKind;
  kicker: string;
  headline: string;
  note: string;
  leaving?: boolean;
  skip: () => void;
}) {
  return (
    <div
      className={'end-curtain' + (leaving ? ' leaving' : '')}
      data-kind={kind}
      onPointerDown={skip}
      role="presentation"
    >
      <div className="end-bar" role="status" aria-live="assertive">
        <span className="end-kicker">{kicker}</span>
        <strong>{headline}</strong>
        <span className="end-note">{note}</span>
      </div>
      {!leaving && <span className="end-skip">轻触跳过</span>}
    </div>
  );
}
