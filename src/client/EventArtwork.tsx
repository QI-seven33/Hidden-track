import { ART_PACK, artPath } from './presentation/skin';
/** 0.9 front and reverse are separate, text-free user-supplied templates. */
export function EventArtwork({
  rarity,
  face,
}: {
  rarity: string;
  face: 'front' | 'back';
}) {
  const asset =
    ART_PACK.events?.[rarity as 'silver' | 'gold' | 'prismatic']?.[face];
  const source = artPath(asset);
  return source ? (
    <img
      className="event-artwork"
      src={source}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="eager"
      decoding="sync"
    />
  ) : null;
}
