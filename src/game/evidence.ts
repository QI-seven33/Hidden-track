import {
  MUSIC_FIELDS,
  MUSIC_SOURCES,
  type EvidenceValue,
  type MusicEntity,
  type MusicEvidence,
  type MusicEvidenceSnapshot,
  type MusicField,
  type MusicSource,
  type ResolvedFact,
} from "../shared/music-evidence";

function normalize(
  field: MusicField,
  value: EvidenceValue,
): EvidenceValue | undefined {
  switch (MUSIC_FIELDS[field].kind) {
    case "text":
      return typeof value === "string" && value.trim()
        ? value.trim()
        : undefined;
    case "names":
      return Array.isArray(value) &&
        value.length &&
        value.every((v) => typeof v === "string" && v.trim())
        ? [...new Set(value.map((v) => v.trim()))].sort()
        : undefined;
    case "positive":
      return typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0 &&
        (field !== "bpm" || value <= 500)
        ? value
        : undefined;
    case "year":
      return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1000 &&
        value <= 2999
        ? value
        : undefined;
  }
}
/** Strict entity + scope matching. Unknown, synonyms and conflicting values are not guessed. */
export function resolveFact(
  field: MusicField,
  entity: MusicEntity,
  evidence: readonly MusicEvidence[],
  allowedSources: readonly MusicSource[],
): ResolvedFact {
  const candidates = evidence
    .flatMap((item) => {
      if (
        item.field !== field ||
        item.entity.scope !== MUSIC_FIELDS[field].scope ||
        item.entity.scope !== entity.scope ||
        item.entity.id !== entity.id ||
        !allowedSources.includes(item.source)
      )
        return [];
      const value = normalize(field, item.value);
      return value === undefined ? [] : [{ ...structuredClone(item), value }];
    })
    .sort(
      (a, b) =>
        MUSIC_SOURCES[b.source].priority - MUSIC_SOURCES[a.source].priority ||
        a.basis.localeCompare(b.basis),
    );
  const values = new Set(candidates.map((item) => JSON.stringify(item.value)));
  return {
    status:
      values.size === 0 ? "unknown" : values.size === 1 ? "known" : "conflict",
    selected: candidates[0],
    candidates,
  };
}
export function evidenceSnapshot(
  entity: MusicEntity,
  evidence: readonly MusicEvidence[],
  allowedSources: MusicSource[],
  capturedAt: string,
): MusicEvidenceSnapshot {
  return {
    schemaVersion: 1,
    policyVersion: "music-evidence-v1",
    capturedAt,
    entity: structuredClone(entity),
    allowedSources: [...allowedSources],
    facts: Object.fromEntries(
      (Object.keys(MUSIC_FIELDS) as MusicField[])
        .filter((field) => MUSIC_FIELDS[field].scope === entity.scope)
        .map((field) => [
          field,
          resolveFact(field, entity, evidence, allowedSources),
        ]),
    ),
  };
}
/** Deliberately no numerical confidence or gameplay weight here. */
export function usableFact(
  snapshot: MusicEvidenceSnapshot,
  field: MusicField,
): MusicEvidence | undefined {
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.policyVersion !== "music-evidence-v1"
  )
    return;
  const fact = snapshot.facts[field];
  return fact?.status === "known" ? fact.selected : undefined;
}
