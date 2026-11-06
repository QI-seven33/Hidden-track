import fixtures from './fixtures.json';
import type { Song } from './types';
// Test data only. This module must never be imported by the client runtime.
export const SONGS = fixtures as Song[];
export function getSong(id: string, catalog: readonly Song[] = SONGS): Song {
  const song = catalog.find((item) => item.id === id);
  if (!song) throw new Error('曲目不存在');
  return song;
}
