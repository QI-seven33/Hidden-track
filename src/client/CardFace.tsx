import type { CardDefinition } from '../game/types';
import { CARD_KINDS } from '../shared/cards';
import { Artwork } from './presentation/Artwork';
import { ART_PACK } from './presentation/skin';
export function CardFace({
  definition: d,
  generated = false,
}: {
  definition: CardDefinition;
  generated?: boolean;
}) {
  const illustrated = !!ART_PACK.cards[d.id];
  return (
    <span
      className={
        'card-face kind-' +
        d.kind +
        (illustrated ? ' illustrated art-duel' : '')
      }
    >
      <Artwork
        asset={ART_PACK.cards[d.id] || ART_PACK.cardFrame}
        className="card-frame"
      />
      <strong className="face-title">{d.title}</strong>
      <span className="face-cost" aria-label={`费用 ${d.cost} 行动点`}>
        {d.cost}
      </span>
      {!illustrated && (
        <span className="face-illustration">
          <b>{CARD_KINDS[d.kind].label}</b>
          <small>插画待绘</small>
        </span>
      )}
      <span className="face-category">
        {generated ? '独立牌 · ' : ''}
        {CARD_KINDS[d.kind].label}牌
      </span>
      <span
        className={
          'face-description' +
          (d.description.length > 88
            ? ' long-copy'
            : d.description.length > 52
              ? ' medium-copy'
              : '')
        }
      >
        {d.description}
      </span>
    </span>
  );
}
