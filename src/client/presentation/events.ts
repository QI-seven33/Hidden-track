/** Consumes only the already redacted player log. Never imports server state. */
export interface PresentationEvent {
  id: number;
  kind: string;
  side?: 'a' | 'b';
  amount?: number;
  title?: string;
  text?: string;
  cardId?: string;
}
export class PresentationCursor {
  private room = '';
  private last?: number;
  next(
    roomId: string,
    events: readonly PresentationEvent[],
    visible = true,
  ): PresentationEvent[] {
    const sorted = [...events].sort((a, b) => a.id - b.id);
    const maximum = sorted.at(-1)?.id ?? 0;
    const baseline =
      this.room !== roomId || this.last === undefined || !visible;
    const previous = this.last ?? maximum;
    this.room = roomId;
    this.last = baseline ? maximum : Math.max(previous, maximum);
    // A skipped range indicates a truncated/recovered snapshot. Do not replay a burst of old effects.
    const fresh = sorted.filter((event) => event.id > previous);
    if (baseline || (fresh.length && fresh[0]!.id > previous + 24)) return [];
    return fresh
      .slice(-8)
      .map(({ id, kind, side, amount, title, text, cardId }) => ({
        id,
        kind,
        side,
        ...(amount !== undefined ? { amount } : {}),
        ...(title ? { title } : {}),
        ...(text ? { text } : {}),
        ...(cardId ? { cardId } : {}),
      }));
  }
}
