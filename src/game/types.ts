import type { MusicEvidenceSnapshot } from '../shared/music-evidence';
export type Side = 'a' | 'b';
export type Tier = 1 | 2 | 3 | 4;
export type CardKind = 'attack' | 'defense' | 'information' | 'special';
export type CardId =
  | 'rest'
  | 'breathe'
  | 'pause'
  | 'strike'
  | 'information'
  | 'intercept'
  | 'drawOne'
  | 'probe'
  | 'rps';
export interface CardInstance {
  id: string;
  cardId: CardId;
  generated?: boolean;
  lockedUntilTurn?: number;
}
export interface Source {
  label: string;
  url: string;
}
export interface Song {
  evidence?: MusicEvidenceSnapshot;
  lyricHint?: string;
  lyricHints?: string[];
  lyricTranslations?: Record<string, string>;
  translatedTitle?: string;
  artistGender?: string;
  previewAvailable?: boolean;
  id: string;
  title: string;
  aliases?: string[];
  artists: string[];
  year?: number;
  album: string;
  language?: string;
  genre?: string;
  bpm?: number;
  duration?: number;
  hasFemaleVoice?: boolean;
  lyricists: string[];
  composers: string[];
  sources: Source[];
  provider: 'fixture' | 'qq';
  providerId?: string;
  providerMid?: string;
  cover?: string;
  albumId?: string;
  albumMid?: string;
  description?: string;
}
export interface Clue {
  id: string;
  tier: Tier;
  label: string;
  value: string;
  text: string;
  source: Source;
  image?: string;
  translation?: string;
  /** 已作为合成原料消耗：仍然展示，但不能再次参与合成。 */
  spent?: boolean;
  /** 由合成生成：可以再次作为下一次合成的原料。 */
  fused?: boolean;
}
export interface GuessAnswer {
  title: string;
  artist?: string;
}
export interface Player {
  songId: string;
  energy: number;
  pressure: number;
  pressureCap: number;
  hand: CardInstance[];
  deck: CardInstance[];
  discard: CardInstance[];
  clues: Clue[];
  activeGuessUsed: boolean;
  turnsStarted: number;
  attacksUsed: number;
  attackLimit: number;
  informationUsed: boolean;
  playedIds: CardId[];
  maxEnergy: number;
  guessesRemaining: number;
  temporaryGuesses: { count: number; untilTurn: number };
  previewSegments: number;
  lyricCursor: number;
  effects: PlayerEffects;
  seenEvents: string[];
  eventHistory: { id: string; round: number; origin: 'choice' | 'bonus' }[];
  refreshes: number;
  repeatNext: number;
  damageBonus: number;
  shields: number;
  extraDraw: number;
}
export interface PlayerEffects {
  apBonus: number;
  freeFirstAttack: boolean;
  freeFirstAttackUsed: boolean;
  restBonus: number;
  carryApEnabled: boolean;
  carryAp: number;
  handLimitDelta: number;
  tier3Downgrade: boolean;
  infoCostDelta: number;
  infoPressureTax: number;
  damageApRefund: number;
  attackApRefund: number;
  damageMul: number;
  pauseClue: boolean;
  guessMissDelta: number;
  freeGuessPerRound: boolean;
  freeGuessUsedRound: number;
  blindGuesses: number;
  tier3BlockFromRound: number;
  tier3BlockUntilRound: number;
  rescueAt80: boolean;
  noReliefUntil: number;
  nextUnrespondableUntil: number;
  turnHandBonusUntil: number;
  freeInformationUntil: number;
  freeInformationUsed: boolean;
  roundFive: number;
  morphLeft: boolean;
  damageClues: number;
  attackBonus: number;
  regenPressure: number;
  hideCluesUntilRound: number;
  cluesRelief: number;
  clueCount: number;
  drawPenalty: number;
  endDamageClueUntil: number;
  damageThisTurn: boolean;
  playSecondsPenalty: number;
  freeCluesUntilRound: number;
  extraDrawFromRound: number;
  extraDrawGrantedThisRound: number;
  skipPlay: number;
  discardOnPlay: number;
  growthCards: { id: string; round: number }[];
  roundClues: number;
  energyGuess: boolean;
  noDiscardPhase: boolean;
  slowBreath: boolean;
  regenAppliedRound: number;
  dualResonance: boolean;
}
/** 每一档的抽中概率（百分比，四档合计 100）。 */
export type ClueOddsRow = [number, number, number, number];
export type ClueOdds = Record<Tier, ClueOddsRow>;
export interface GameRules {
  maxRounds: number;
  maxEnergy: number;
  startingEnergy: number;
  initialHand: number;
  drawPerTurn: number;
  handLimit: number;
  pressureLimit: number;
  damagePressure: number;
  guessMissPressure: number;
  cluePressure: Record<Tier, number>;
  /** 按回合（1–4）查表：搜索用本回合行，分享用下一回合行。 */
  clueOdds: ClueOdds;
  /** 两条同档信息自动生成一条高一档信息。 */
  fusion: boolean;
}
export interface GameEvent {
  id: number;
  kind:
    | 'card'
    | 'turn'
    | 'damage'
    | 'heal'
    | 'draw'
    | 'discard'
    | 'clue'
    | 'pressure'
    | 'guess'
    | 'response'
    | 'system';
  side?: Side;
  target?: Side;
  title: string;
  text: string;
  amount?: number;
  cardId?: CardId;
  /** Public snapshot at commit time; old records may omit it. */
  definition?: CardDefinition;
  /** 这张牌是作为「响应」打出的（受击时用蓝调），界面要单独标注。 */
  responded?: boolean;
  /** 猜歌失败：双方都要看到「谁猜了什么、没中」，用于提示条。 */
  guessMiss?: boolean;
  /** 猜歌提交的歌名，供提示条直接显示。 */
  guessTitle?: string;
  clue?: Clue;
}
export interface PendingChoice {
  choiceId?: number;
  kind: 'discardOwn' | 'intercept' | 'lock';
  actor: Side;
  target: Side;
  remaining: number;
}
export interface ResponseWindow {
  windowId?: number;
  kind: 'attack' | 'dying';
  attacker: Side;
  defender: Side;
  cardId?: CardId;
  damage: number;
  unblockable?: boolean;
  isDamage?: boolean;
}
export interface Outcome {
  winner: Side | 'draw';
  reason: 'energy' | 'activeGuess' | 'pressureGuess' | 'finalGuess';
  text: string;
  /** 压力到顶的具体来源：结算页要回答「我到底是怎么输的」。 */
  cause?: string;
}
export interface GameState {
  schemaVersion: 12;
  catalog: readonly Song[];
  rules: GameRules;
  round: number;
  turn: number;
  firstSide: Side;
  active: Side;
  phase: 'playing' | 'forcedGuess' | 'finalGuess' | 'finished';
  players: Record<Side, Player>;
  rng: number;
  events: GameEvent[];
  nextEventId: number;
  cardsPlayed?: Record<Side, number>;
  pending: PendingChoice | null;
  response: ResponseWindow | null;
  forcedSides: Side[];
  guesses: Partial<Record<Side, GuessAnswer>>;
  outcome: Outcome | null;
  /** 最后一次加压的来源，仅在压力到顶时写进 outcome.cause。 */
  pressureTally?: Partial<
    Record<
      Side,
      { cause: string; amount: number; turn: number; fatal?: boolean }
    >
  >;
  endingTurn: boolean;
  queue: { side: Side; cardId: CardId; unrespondable?: boolean }[];
  eventQueue: {
    side: Side;
    eventId: string;
    depth: number;
    bonusRarity?: 'silver' | 'gold' | 'prismatic' | 'any';
  }[];
  nextGeneratedId: number;
  clock: {
    key: string;
    deadline: number;
    remainingPlay: number;
    playKey: string;
    updatedAt: number;
  } | null;
  rps: {
    actor: Side;
    round: number;
    moves: Partial<Record<Side, 'rock' | 'paper' | 'scissors'>>;
  } | null;
  stageEvents: {
    stage: Tier;
    round: number;
    freeRefresh: Record<Side, number[]>;
    resolved: boolean;
    drawn: boolean;
    rarity: 'silver' | 'gold' | 'prismatic';
    offers: Record<Side, string[]>;
    selected: Partial<Record<Side, string>>;
  };
}
export type GameAction =
  | { type: 'chooseLocks'; side: Side; indices: number[] }
  | { type: 'useGrowth'; side: Side; instanceId: string }
  | { type: 'refreshEvents'; side: Side; eventId: string }
  | { type: 'chooseOption'; side: Side; option: 'discard' | 'damage' }
  | { type: 'rps'; side: Side; move: 'rock' | 'paper' | 'scissors' }
  | { type: 'chooseEvent'; side: Side; eventId: string }
  | { type: 'playCard'; side: Side; instanceId: string }
  | { type: 'respond'; side: Side; instanceId: string | null }
  | { type: 'endTurn'; side: Side }
  | { type: 'chooseDiscard'; side: Side; instanceId: string }
  | { type: 'guess'; side: Side; answer: GuessAnswer };
export interface Transition {
  state: GameState;
  error?: string;
}
export interface CardDefinition {
  id: CardId;
  title: string;
  kind: CardKind;
  timing: 'play' | 'attackResponse' | 'rest';
  copies: number;
  cost: number;
  description: string;
  short: string;
  tag: string;
  art: number;
}
