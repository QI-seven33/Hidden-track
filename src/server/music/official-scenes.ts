import type { OfficialSongAssociations } from '../../shared/protocol';

type Row = Record<string, unknown>;
type Read = (
  command: string,
  args: Record<string, string | number>,
) => Promise<Row>;
const row = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};
const id = (value: unknown) =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : '';
const label = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 120) : '';
const ok = (data: Row) => Number(data.ret) === 0 && Number(data.vcheck) !== 1;
type Snapshot = Omit<OfficialSongAssociations, 'matches'> & {
  index: Map<string, OfficialSongAssociations['matches']>;
};

/** Anonymous official editorial lists only. Shared memory cache, no user assets,
 * no public-client APIs and no inference from a missing list membership. */
export class OfficialSceneReader {
  private cached?: { expires: number; value: Snapshot };
  private pending?: Promise<Snapshot>;
  constructor(
    private read: Read,
    private now = () => Date.now(),
  ) {}

  async get(mid: string, songId: string): Promise<OfficialSongAssociations> {
    let snapshot =
      this.cached && this.cached.expires > this.now()
        ? this.cached.value
        : undefined;
    if (!snapshot) {
      this.pending ??= this.load()
        .then((value) => {
          this.cached = {
            expires:
              this.now() + (value.status === 'complete' ? 30 * 60_000 : 30_000),
            value,
          };
          return value;
        })
        .finally(() => {
          this.pending = undefined;
        });
      snapshot = await this.pending;
    }
    const { index, ...summary } = snapshot;
    return {
      ...summary,
      matches:
        mid && id(songId) ? [...(index.get(`${mid}:${songId}`) || [])] : [],
    };
  }

  private async load(): Promise<Snapshot> {
    const snapshot: Snapshot = {
      status: 'unavailable',
      checkedAt: new Date(this.now()).toISOString(),
      scannedLists: 0,
      totalLists: 0,
      recordingCount: 0,
      matchesPerListLimit: 100,
      index: new Map(),
    };
    try {
      const directory = await this.read(
        'fcg_music_get_scene_songlist_category.fcg',
        {},
      );
      if (!ok(directory) || !Array.isArray(directory.group_list))
        return snapshot;
      const categories = new Map<
        string,
        { groupId: string; categoryId: string; group: string; label: string }
      >();
      for (const value of directory.group_list) {
        const group = row(value);
        if (
          !id(group.group_id) ||
          !label(group.title) ||
          !Array.isArray(group.subCategory)
        )
          continue;
        for (const value of group.subCategory) {
          const sub = row(value),
            categoryId = id(sub.sub_id),
            groupId = id(group.group_id);
          if (categoryId && label(sub.subtitle))
            categories.set(`${groupId}:${categoryId}`, {
              groupId,
              categoryId,
              group: label(group.title),
              label: label(sub.subtitle),
            });
        }
      }
      snapshot.totalLists = categories.size;
      // Bound upstream work even if the official taxonomy grows unexpectedly.
      for (const category of [...categories.values()].slice(0, 32)) {
        try {
          const data = await this.read(
            'fcg_music_get_scene_songlist_track_detail.fcg',
            { group_id: category.groupId, sub_id: category.categoryId },
          );
          if (!ok(data) || !Array.isArray(data.songlist)) continue;
          // If response IDs are provided they must agree with the requested list.
          if (
            (data.sub_id !== undefined &&
              id(data.sub_id) !== category.categoryId) ||
            (id(data.group_id) && id(data.group_id) !== category.groupId)
          )
            continue;
          snapshot.scannedLists++;
          for (const value of data.songlist.slice(0, 100)) {
            const song = row(value),
              mid = label(song.song_mid),
              songId = id(song.song_id);
            if (!mid || !songId) continue;
            const key = `${mid}:${songId}`,
              matches = snapshot.index.get(key) || [];
            if (
              !matches.some(
                (m) =>
                  m.groupId === category.groupId &&
                  m.categoryId === category.categoryId,
              )
            )
              matches.push({ ...category });
            snapshot.index.set(key, matches);
          }
        } catch {
          /* A partial list failure cannot erase the other positive evidence. */
        }
      }
      snapshot.recordingCount = snapshot.index.size;
      snapshot.status =
        snapshot.scannedLists === snapshot.totalLists && snapshot.totalLists > 0
          ? 'complete'
          : snapshot.scannedLists
            ? 'partial'
            : 'unavailable';
    } catch {
      /* Optional metadata must stay readable when upstream is unavailable. */
    }
    return snapshot;
  }
}
