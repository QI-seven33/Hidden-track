import versions from '../../shared/asset-versions.json';
import type { CardId, GameEvent } from '../../game/types';
export interface ArtAsset {
  src: string;
  position?: string;
}
export interface EffectAsset extends ArtAsset {
  durationMs: number;
}
export interface ArtPack {
  version: string;
  cards: Partial<Record<CardId, ArtAsset>>;
  cardFrame?: ArtAsset;
  cardBack?: ArtAsset;
  events?: Partial<
    Record<'silver' | 'gold' | 'prismatic', { front: ArtAsset; back: ArtAsset }>
  >;
  scene?: ArtAsset;
  scenes?: { salon?: ArtAsset };
  effects: Partial<Record<GameEvent['kind'], EffectAsset>>;
}
/** User-supplied provisional frame, reverse and table assets. No animation runtime. */
export const ART_PACK: ArtPack = {
  version: 'user-art-duel-20261101',
  cards: {
    probe: { src: '/art/duel-20261101/probe.webp' },
    information: { src: '/art/duel-20261101/information.webp' },
    pause: { src: '/art/duel-20261101/pause.webp' },
    rps: { src: '/art/duel-20261101/rps.webp' },
    intercept: { src: '/art/duel-20261101/intercept.webp' },
    strike: { src: '/art/duel-20261101/strike.webp' },
    breathe: { src: '/art/duel-20261101/breathe.webp' },
    drawOne: { src: '/art/duel-20261101/drawOne.webp' },
    rest: { src: '/art/duel-20261101/rest.webp' },
  },
  cardFrame: { src: '/art/hand-front-v2.webp' },
  cardBack: { src: '/art/duel-20261101/card-back.webp' },
  scene: { src: '/art/table-desk.webp' },
  scenes: { salon: { src: '/art/table-salon.webp' } },
  events: {
    silver: {
      front: { src: '/art/duel-20261101/event-silver.webp' },
      back: { src: '/art/duel-20261101/event-back.webp' },
    },
    gold: {
      front: { src: '/art/duel-20261101/event-gold.webp' },
      back: { src: '/art/duel-20261101/event-back.webp' },
    },
    prismatic: {
      front: { src: '/art/duel-20261101/event-prismatic.webp' },
      back: { src: '/art/duel-20261101/event-back.webp' },
    },
  },
  effects: {},
};
export function artPath(asset?: ArtAsset): string | undefined {
  const src = asset?.src;
  return src &&
    /^\/art\/[A-Za-z0-9_/-]+\.(?:png|webp|avif|jpg|jpeg|svg)$/.test(src) &&
    !src.includes('..')
    ? src +
        (versions[src as keyof typeof versions]
          ? `?v=${versions[src as keyof typeof versions]}`
          : '')
    : undefined;
}
