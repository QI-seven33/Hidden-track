import { randomBytes } from 'node:crypto';
export interface PreviewSource {
  session: string;
  roomId: string;
  matchId: string;
  segments: number;
  authKey: string;
  audio: Buffer;
  expiresAt: number;
}
/** Bounded, ephemeral official snippets. Opaque handles are also bound to the listener session. */
export class PreviewSources {
  private entries = new Map<string, PreviewSource>();
  prune(now = Date.now()) {
    for (const [id, entry] of this.entries)
      if (entry.expiresAt <= now) this.entries.delete(id);
  }
  put(entry: Omit<PreviewSource, 'expiresAt'>, now = Date.now()) {
    this.prune(now);
    // A reload replaces only this listener's old source, keeping total memory bounded.
    for (const [id, item] of this.entries)
      if (item.session === entry.session) this.entries.delete(id);
    if (this.entries.size >= 16 || entry.audio.length > 2 * 1024 * 1024) return;
    const id = randomBytes(24).toString('base64url'),
      expiresAt = now + 120000;
    this.entries.set(id, { ...entry, expiresAt });
    return { id, expiresAt };
  }
  get(id: string, session: string, now = Date.now()) {
    this.prune(now);
    const entry = this.entries.get(id);
    return entry?.session === session ? entry : undefined;
  }
}
/** Single HTTP byte range, including suffix ranges; malformed or unsatisfiable requests fail closed. */
export function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | undefined {
  if (header === undefined) return;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : undefined,
    last = match[2] ? Number(match[2]) : undefined;
  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last))
  )
    return null;
  if (first === undefined) {
    if (!last || size < 1) return null;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== undefined && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
