import { createHash } from 'node:crypto';
import { CARDS } from '../shared/cards';
import { STAGE_EVENTS } from '../shared/stage-events';
import { DEFAULT_RULES } from '../shared/rules';
import { FACT_TEMPLATES } from '../game/clues';

/** Bump revision for changes to engine/effects/opening/answers/evidence semantics.
 * Data-only changes are also detected by contentHash. This is not a multi-engine loader. */
export const RULESET = {
  id: 'music-duel-draft',
  revision: 15,
  contentHash: digest({
    cards: CARDS,
    stages: STAGE_EVENTS,
    defaults: DEFAULT_RULES,
    clues: FACT_TEMPLATES.map(({ value: _value, ...definition }) => definition),
    evidencePolicy: 'music-evidence-v1',
  }),
};
export type RulesetStamp = typeof RULESET;
/** Old matches are retained, never interpreted with the new draft engine. */
export function supportsRuleset(stamp: RulesetStamp): boolean {
  return (
    stamp.id === RULESET.id &&
    stamp.revision === RULESET.revision &&
    stamp.contentHash === RULESET.contentHash
  );
}
/** Stable key order for metadata and configuration, independent of timestamps. */
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
