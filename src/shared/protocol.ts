import { z } from 'zod';
import type {
  CardDefinition,
  CardInstance,
  Clue,
  GameRules,
  GameState,
  Side,
  Song,
} from '../game/types';

export const PROTOCOL_VERSION = 10;
export const modeSchema = z.enum(['fixture', 'qq']);
export type MusicMode = z.infer<typeof modeSchema>;
const oddsRowSchema = z.tuple([
  z.number().int().min(0).max(100),
  z.number().int().min(0).max(100),
  z.number().int().min(0).max(100),
  z.number().int().min(0).max(100),
]);
export const rulesSchema = z
  .object({
    maxRounds: z.number().int().min(0).max(20),
    maxEnergy: z.number().int().min(1).max(10),
    startingEnergy: z.number().int().min(1).max(10),
    initialHand: z.number().int().min(3).max(10),
    drawPerTurn: z.number().int().min(1).max(5),
    handLimit: z.number().int().min(1).max(15),
    pressureLimit: z.literal(100),
    damagePressure: z.number().int().min(0).max(50),
    guessMissPressure: z.number().int().min(0).max(100),
    cluePressure: z.object({
      1: z.number().int().min(0).max(50),
      2: z.number().int().min(0).max(50),
      3: z.number().int().min(0).max(50),
      4: z.number().int().min(0).max(50),
    }),
    clueOdds: z.object({
      1: oddsRowSchema,
      2: oddsRowSchema,
      3: oddsRowSchema,
      4: oddsRowSchema,
    }),
    fusion: z.boolean(),
  })
  .strict()
  .refine((r) => r.startingEnergy <= r.maxEnergy, '回合行动点不能超过上限')
  .refine(
    (r) =>
      Object.values(r.clueOdds).every(
        (row) => row.reduce((a, b) => a + b, 0) === 100,
      ),
    '每轮线索概率之和必须为 100',
  );
export const actionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('refreshEvents'),
      eventId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal('chooseOption'),
      option: z.enum(['discard', 'damage']),
    })
    .strict(),
  z
    .object({
      type: z.literal('rps'),
      move: z.enum(['rock', 'paper', 'scissors']),
    })
    .strict(),
  z
    .object({
      type: z.literal('chooseLocks'),
      indices: z.array(z.number().int().min(0).max(200)).min(1).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal('useGrowth'),
      instanceId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({ type: z.literal('playCard'), instanceId: z.string().max(100) })
    .strict(),
  z
    .object({
      type: z.literal('chooseEvent'),
      eventId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal('respond'),
      instanceId: z.string().max(100).nullable(),
    })
    .strict(),
  z.object({ type: z.literal('endTurn') }).strict(),
  z
    .object({
      type: z.literal('chooseDiscard'),
      instanceId: z.string().max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal('guess'),
      answer: z
        .object({
          title: z.string().trim().min(1).max(100),
          artist: z.string().max(100).optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type PlayerAction = z.infer<typeof actionSchema>;
export const commandSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    action: actionSchema,
  })
  .strict();
export type SongSummary = Pick<
  Song,
  | 'id'
  | 'title'
  | 'artists'
  | 'album'
  | 'provider'
  | 'cover'
  | 'providerMid'
  | 'albumId'
  | 'albumMid'
> & {
  /** 选歌页右侧资料卡用的展示字段，不参与任何线索结算。 */
  year?: number;
  duration?: number;
};
export interface RoomView {
  protocol: number;
  id: string;
  roomCode?: string;
  version: number;
  mode: MusicMode;
  bot: boolean;
  me: Side;
  createdAt: number;
  expiresAt: number;
  status: 'waiting' | 'playing' | 'finished';
  /** 换位申请：from 是发起方，被申请方需要同意后才真的交换座位。 */
  swapAsk?: { from: Side; at: number };
  rules: GameRules;
  players: {
    seat: Side;
    name: string;
    joined: boolean;
    ready: boolean;
    online: boolean;
    energy: number;
    pressure: number;
    pressureCap: number;
    avatar?: string;
    maxEnergy: number;
    statuses: string[];
    events: {
      id: string;
      title: string;
      description: string;
      rarity: string;
      round: number;
    }[];
    handCount: number;
    deckCount: number;
    discardCount?: number;
  }[];
  ownSong?: SongSummary;
  canStart: boolean;
  developer?: {
    used: boolean;
    paused: boolean;
    players?: Record<Side, import('./developer').DeveloperPlayerValues>;
  };
  game?: {
    matchId: string;
    phase: GameState['phase'];
    active: Side;
    round: number;
    hand: {
      card: CardInstance;
      definition: CardDefinition;
      unavailable?: string;
    }[];
    clues: (Omit<Clue, 'source'> & { sourceLabel?: string })[];
    log: {
      id: number;
      kind: string;
      text: string;
      side?: Side;
      amount?: number;
      title?: string;
      cardId?: string;
      definition?: CardDefinition;
      responded?: boolean;
      /** 猜歌没中：用于双方可见的失败提示条。 */
      guessMiss?: boolean;
      /** 猜的歌名（仅在猜错时下发，双方可见）。 */
      guessTitle?: string;
    }[];
    response?: { kind: string; defender: Side; title: string };
    waitingForChoice: boolean;
    clock?: {
      serverNow: number;
      deadline: number;
      kind: string;
      /** 本次阶段的总时长，供响应进度条算比例 */
      seconds?: number;
    };
    stats?: { cardsPlayed: number };
    handLimit: number;
    skipDiscard: boolean;
    guessesRemaining: number;
    guessMissPressure: number;
    previewSeconds: number;
    cluesHidden: boolean;
    growthCards: { id: string; level: number; unavailable?: string }[];
    choice?: {
      title: string;
      hiddenCount?: number;
      lockCount?: number;
      options?: {
        id: 'discard' | 'damage';
        label: string;
        disabled?: boolean;
      }[];
      cards: {
        card: CardInstance;
        definition: CardDefinition;
        unavailable?: string;
      }[];
    };
    stageEvent: {
      stage: 1 | 2 | 3 | 4;
      waiting: boolean;
      selected?: string;
      opponentSelected?: boolean;
      refreshes: number;
      freeRefresh: number;
      canRefresh: boolean;
      refreshable: string[];
      options: {
        id: string;
        title: string;
        description: string;
        rarity: string;
      }[];
    };
    rps?: { round: number; submitted: boolean; opponentSubmitted: boolean };
    turnState: {
      attacksUsed: number;
      attackLimit: number;
      informationUsed: boolean;
      activeGuessUsed: boolean;
    };
    canEndTurn: boolean;
    canGuess: boolean;
    mustGuess: boolean;
    guessSubmitted: boolean;
    revealed?: { seat: Side; song: SongSummary }[];
    outcome: GameState['outcome'];
  };
}
export interface ProbeResult {
  capability: string;
  status: 'available' | 'denied' | 'needs_login' | 'missing_config' | 'error';
  code?: number;
  message: string;
  elapsedMs: number;
  fields: string[];
  sample?: unknown;
}
export interface InspectionSection {
  key: string;
  title: string;
  code?: number;
  status: 'success' | 'upstream_error' | 'connection_error';
  rows: { path: string; value: string }[];
}
export interface MusicInspection {
  checkedAt: string;
  identity: 'authorized' | 'anonymous';
  song: SongSummary;
  profile: MusicProfile;
  sections: InspectionSection[];
}
export interface MusicFact {
  label: string;
  value: string;
  note?: string;
}
export interface OfficialSongAssociations {
  status: 'complete' | 'partial' | 'unavailable';
  checkedAt: string;
  scannedLists: number;
  totalLists: number;
  recordingCount: number;
  matchesPerListLimit: number;
  matches: {
    groupId: string;
    categoryId: string;
    group: string;
    label: string;
  }[];
}
export interface MusicProfile {
  facts: MusicFact[];
  description?: string;
  albumSongNote?: string;
  missing: string[];
  metadataNotice?: string;
  referenceLinks?: { title: string; url: string }[];
  album: {
    title: string;
    cover?: string;
    facts: MusicFact[];
    description?: string;
  };
  singer: {
    name: string;
    portrait?: string;
    facts: MusicFact[];
    biography?: string;
    chapters: { title: string; body: string }[];
  };
  listening: {
    fullAllowed: boolean;
    delivery: 'full' | 'preview' | 'unavailable';
    explanation: string;
    resources: {
      label: string;
      format: string;
      size?: string;
      kind: 'full' | 'preview';
    }[];
  };
  chorus?: { begin: number; end: number };
  lyrics: { label: string; available: boolean; characters: number }[];
  versions: SongSummary[];
  similar: SongSummary[];
  notices: string[];
}
