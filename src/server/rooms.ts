import {
  developerCommandSchema,
  DEVELOPER_PLAYER_FIELDS,
  type DeveloperCommand,
} from '../shared/developer';
import { record } from '../game/operations';
import { cardViewDefinition, guessMissCost } from '../game/budget';
import { settleDeveloperChanges } from '../game/engine';
import { clockPhase, timeoutAction, updateClock } from '../game/timing';
import {
  availableGuesses,
  handLimit,
  isLocked,
  playerStatuses,
} from '../game/passives';
import { waitingForEvents, canRefreshEvent } from '../game/stage-events';
import { STAGE_EVENT_BY_ID } from '../shared/stage-events';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import type {
  GameAction,
  GameRules,
  GameState,
  Side,
  Song,
} from '../game/types';
import { createGame, transition, cardUnavailableReason } from '../game/engine';
import { botAction, BOT_ACTION_DELAY } from './practice-bot';
import { CARD_BY_ID, buildDeck } from '../shared/cards';
import { DEFAULT_RULES } from '../shared/rules';
import { SONGS } from '../game/catalog';
import {
  PROTOCOL_VERSION,
  type MusicMode,
  type PlayerAction,
  type RoomView,
} from '../shared/protocol';
import { AppError } from './errors';
import { Store } from './store';
import { RULESET, digest, supportsRuleset, type RulesetStamp } from './ruleset';

export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export interface Room {
  ruleset?: RulesetStamp;
  /** Server only: even a hash of a hidden song can enable dictionary attacks. */
  match?: {
    id?: string;
    startedAt: number;
    rulesHash: string;
    catalogHash: string;
  };
  id: string;
  version: number;
  mode: MusicMode;
  bot: boolean;
  createdAt: number;
  expiresAt: number;
  inviteHash: string;
  joinCode?: string;
  developer?: { used: boolean; paused: boolean };
  rules: GameRules;
  players: Partial<
    Record<
      Side,
      {
        session: string;
        name: string;
        avatar?: string;
        song?: Song;
        ready?: boolean;
      }
    >
  >;
  game?: GameState;
  /** 换位申请：对方点了「同意」才真的交换座位。 */
  swapAsk?: { from: Side; at: number };
  commands: { key: string; fingerprint: string }[];
}
const summary = (song: Song) => ({
  id: song.id,
  title: song.title,
  artists: song.artists,
  album: song.album,
  provider: song.provider,
  cover: song.cover,
  providerMid: song.providerMid,
  albumId: song.albumId,
  albumMid: song.albumMid,
});
export class Rooms {
  private closed = false;
  // socket → 会话，而不是座位：换位之后座位会变，会话不会。
  private clients = new Map<string, Map<WebSocket, string>>();
  private deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private timers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; version: number }
  >();
  private swapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private store: Store,
    private developerEnabled = false,
    private practiceCatalog: (session: string) => readonly Song[] = () => SONGS,
    private onBotError: (details: {
      code: string;
      action: string;
    }) => void = () => {},
  ) {}
  get(id: string): Room {
    const room = this.store.getRoom<Room>(id);
    if (!room) throw new AppError(404, '房间不存在或已过期', 'ROOM_NOT_FOUND');
    if (
      !room.ruleset ||
      !supportsRuleset(room.ruleset) ||
      (room.game && room.game.schemaVersion !== 12)
    )
      throw new AppError(
        409,
        '此房间使用其他版本的规则，请新建房间；原记录仍保留',
        'RULESET_UNSUPPORTED',
      );
    // Metadata only: existing supported waiting rooms can use the new code entry.
    if (!room.joinCode && !room.game && !room.bot) {
      room.joinCode = this.newRoomCode();
      this.save(room);
    }
    if (room.swapAsk && (room.game || Date.now() - room.swapAsk.at >= 60000)) {
      this.cancelSwap(room);
      room.version++;
      this.save(room);
      this.publish(room);
    }
    this.scheduleSwapExpiry(room);
    this.expire(room);
    this.scheduleDeadline(room);
    return room;
  }
  private expire(room: Room, now = Date.now()) {
    if (!room.game) return;
    let count = 0,
      changed = false;
    while (room.game.clock && room.game.clock.deadline <= now && count++ < 16) {
      const action = timeoutAction(room.game);
      if (!action) break;
      const result = transition(room.game, action, now);
      if (result.error) break;
      room.game = result.state;
      room.version++;
      changed = true;
    }
    if (changed) {
      this.save(room);
      queueMicrotask(() => {
        if (!this.closed) this.publish(room);
      });
    }
  }
  private scheduleDeadline(room: Room) {
    if (this.closed || this.deadlines.has(room.id) || !room.game?.clock) return;
    const timer = setTimeout(
      () => {
        this.deadlines.delete(room.id);
        try {
          const latest = this.get(room.id);
          this.publish(latest);
        } catch {}
      },
      Math.max(1, room.game.clock.deadline - Date.now()),
    );
    timer.unref();
    this.deadlines.set(room.id, timer);
  }
  setAvatar(id: string, session: string, avatar?: string) {
    const room = this.get(id),
      seat = this.seat(room, session);
    room.players[seat]!.avatar = avatar;
    this.save(room);
    this.publish(room);
  }
  rematch(id: string, session: string, expected: number) {
    const room = this.get(id);
    this.seat(room, session);
    this.version(room, expected);
    if (room.game?.phase !== 'finished')
      throw new AppError(409, '对局结束后才能继续游戏');
    this.cancelSwap(room);
    room.commands = [];
    room.game = undefined;
    if (room.developer) room.developer.paused = false;
    room.match = undefined;
    for (const p of Object.values(room.players)) {
      if (p) {
        p.song = undefined;
        p.ready = false;
      }
    }
    room.version++;
    this.save(room);
    this.publish(room);
    return this.view(room, session);
  }
  /** 练习房间里电脑坐哪一边；换位后可能变成 a。 */
  private botSeat(room: Room): Side {
    return room.players.a?.session.startsWith('bot:') ? 'a' : 'b';
  }
  /** 房主座位：真人房间固定 a，练习房间永远是真人那一侧。 */
  private hostSeat(room: Room): Side {
    return room.bot ? (this.botSeat(room) === 'a' ? 'b' : 'a') : 'a';
  }
  seat(room: Room, session: string): Side {
    const seat = (['a', 'b'] as const).find(
      (s) => room.players[s]?.session === session,
    );
    if (!seat)
      throw new AppError(403, '你不是这个房间的玩家', 'ROOM_FORBIDDEN');
    return seat;
  }
  save(room: Room) {
    this.store.saveRoom(room.id, room, room.expiresAt);
  }
  private newRoomCode() {
    let code: string;
    do {
      code = [...randomBytes(8)]
        .map((n) => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[n & 31])
        .join('');
    } while (this.store.getRoomByCode(code, true));
    return code;
  }
  joinByCode(code: string, session: string, name: string) {
    const found = this.store.getRoomByCode<Room>(code);
    if (!found || found.bot) throw new AppError(404, '房间号无效或已过期');
    const room = this.get(found.id);
    return this.addSeat(room, session, name);
  }
  create(session: string, name: string, mode: MusicMode, bot: boolean) {
    if (bot && mode === 'qq')
      throw new AppError(
        400,
        '真实曲目模式先使用双人房间；练习电脑仅用于本地测试',
      );
    const invite = randomBytes(24).toString('base64url');
    const id = randomBytes(9).toString('base64url');
    const room: Room = {
      ruleset: structuredClone(RULESET),
      id,
      version: 0,
      mode,
      bot,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600000,
      inviteHash: hash(invite),
      joinCode: this.newRoomCode(),
      rules: structuredClone(DEFAULT_RULES),
      players: {
        a: { session, name },
      },
      commands: [],
    };
    if (bot) room.players.b = { session: `bot:${id}`, name: '练习电脑' };
    this.save(room);
    return { room: this.view(room, session), invite };
  }
  join(id: string, invite: string, session: string, name: string) {
    const room = this.get(id);
    if (Object.values(room.players).some((p) => p?.session === session))
      return this.view(room, session);
    if (hash(invite) !== room.inviteHash)
      throw new AppError(403, '邀请链接无效');
    return this.addSeat(room, session, name);
  }
  private addSeat(room: Room, session: string, name: string) {
    if (Object.values(room.players).some((p) => p?.session === session))
      return this.view(room, session);
    if (room.game || room.players.b)
      throw new AppError(409, '房间已满或已经开局');
    room.players.b = {
      session,
      name,
    };
    room.version++;
    this.save(room);
    this.publish(room);
    return this.view(room, session);
  }
  /**
   * 换位：双方交换座位，也就交换了先手（座位 a 固定先手）。
   * 只在开局前可用；底牌、准备状态、头像都跟着人走。
   * 真人对手必须先同意，所以这里只登记申请。
   */
  requestSwap(id: string, session: string, expected: number) {
    const room = this.get(id);
    const seat = this.seat(room, session);
    this.version(room, expected);
    if (room.game) throw new AppError(409, '开局后不能换位');
    if (!room.players.b) throw new AppError(409, '等对手加入后再换位');
    if (room.swapAsk?.from === seat) return this.view(room, session);
    if (room.swapAsk) throw new AppError(409, '请先回应对方的换位申请');
    room.swapAsk = { from: seat, at: Date.now() };
    room.version++;
    this.save(room);
    this.publish(room);
    // 练习房里没人能点「同意」，让电脑过一拍自己答应，顺便把动画演完。
    if (room.bot) {
      const at = room.swapAsk.at;
      const timer = setTimeout(() => {
        this.swapTimers.delete(id);
        try {
          const latest = this.get(id);
          if (latest.swapAsk?.at !== at || latest.game) return;
          this.applySwap(latest);
          latest.version++;
          this.save(latest);
          this.publish(latest);
        } catch {
          /* 房间过期就算了 */
        }
      }, 1100);
      timer.unref?.();
      this.swapTimers.set(id, timer);
    } else this.scheduleSwapExpiry(room);
    return this.view(room, session);
  }
  /** 被申请的一方表态；同意才换。 */
  respondSwap(id: string, session: string, accept: boolean, expected: number) {
    const room = this.get(id);
    const seat = this.seat(room, session);
    this.version(room, expected);
    if (room.game) throw new AppError(409, '开局后不能换位');
    const ask = room.swapAsk;
    if (!ask) throw new AppError(409, '没有待处理的换位申请');
    if (ask.from === seat) throw new AppError(409, '等对方确认后再看');
    const pending = this.swapTimers.get(id);
    if (pending) {
      clearTimeout(pending);
      this.swapTimers.delete(id);
    }
    delete room.swapAsk;
    if (accept) this.applySwap(room);
    room.version++;
    this.save(room);
    this.publish(room);
    return this.view(room, session);
  }
  private scheduleSwapExpiry(room: Room) {
    if (room.swapAsk && !room.bot && !this.swapTimers.has(room.id)) {
      const timer = setTimeout(
        () => {
          this.swapTimers.delete(room.id);
          try {
            this.get(room.id);
          } catch {
            /* Expired room needs no broadcast. */
          }
        },
        Math.max(1, room.swapAsk.at + 60000 - Date.now()),
      );
      timer.unref();
      this.swapTimers.set(room.id, timer);
    }
  }
  private cancelSwap(room: Room) {
    const timer = this.swapTimers.get(room.id);
    if (timer) clearTimeout(timer);
    this.swapTimers.delete(room.id);
    delete room.swapAsk;
  }
  private applySwap(room: Room) {
    const a = room.players.a,
      b = room.players.b;
    if (!a || !b) throw new AppError(409, '等对手加入后再换位');
    room.players.a = b;
    room.players.b = a;
    delete room.swapAsk;
  }
  invite(id: string, session: string) {
    const room = this.get(id);
    if (
      this.seat(room, session) !== 'a' ||
      room.game ||
      (room.players.b && !room.bot)
    )
      throw new AppError(409, '当前不能更新邀请');
    const invite = randomBytes(24).toString('base64url');
    room.inviteHash = hash(invite);
    room.joinCode = this.newRoomCode();
    this.save(room);
    return invite;
  }
  select(
    id: string,
    session: string,
    song: Song,
    expected: number,
    prepared = true,
  ) {
    const room = this.get(id);
    const seat = this.seat(room, session);
    this.version(room, expected);
    if (room.game) throw new AppError(409, '开局后不能更换底牌');
    if (song.provider !== room.mode)
      throw new AppError(400, '歌曲数据源与房间模式不一致');
    room.players[seat]!.song = song;
    room.players[seat]!.ready = prepared;
    if (room.bot) {
      const bot = this.botSeat(room);
      const choices = this.practiceCatalog(session).filter(
        (s) => s.id !== song.id,
      );
      if (!choices.length)
        throw new AppError(503, '完整练习曲目不足，请稍后重试');
      // 早先取 choices[0]：电脑的底牌等于「曲库里第一首不是你的歌」，
      // 于是永远在愿与愁 / 珊瑚海之间循环。改为等概率随机。
      room.players[bot]!.song = structuredClone(
        choices[randomInt(choices.length)]!,
      );
      room.players[bot]!.ready = true;
    }
    room.version++;
    this.save(room);
    this.publish(room);
    return this.view(room, session);
  }
  rules(id: string, session: string, rules: GameRules, expected: number) {
    const room = this.get(id);
    this.version(room, expected);
    if (this.seat(room, session) !== this.hostSeat(room) || room.game)
      throw new AppError(403, '仅房主可以在开局前调整参数');
    room.rules = rules;
    for (const player of Object.values(room.players))
      if (player) player.ready = false;
    if (room.bot) room.players[this.botSeat(room)]!.ready = true;
    room.version++;
    this.save(room);
    this.publish(room);
    return this.view(room, session);
  }
  develop(id: string, session: string, command: DeveloperCommand) {
    const room = this.get(id),
      seat = this.seat(room, session);
    if (
      !this.developerEnabled ||
      room.mode !== 'fixture' ||
      !room.bot ||
      seat !== this.hostSeat(room)
    )
      throw new AppError(403, '开发者调数仅供本机练习房间的房主使用');
    const parsed = developerCommandSchema.parse(command);
    const key = 'developer:' + seat + ':' + parsed.id,
      fingerprint = hash(JSON.stringify(parsed.patch));
    const prior = room.commands.find((c) => c.key === key);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new AppError(409, '动作 ID 已用于不同内容', 'COMMAND_REUSED');
      return { room: this.view(room, session), replayed: true };
    }
    this.version(room, parsed.version);
    if (room.game?.phase === 'finished')
      throw new AppError(409, '本局已结束，请续局后调整');
    if (
      !room.game &&
      (parsed.patch.players || parsed.patch.paused !== undefined)
    )
      throw new AppError(409, '开局前只能调整规则');
    if (room.commands.length >= 3000)
      throw new AppError(409, '此局已达到操作上限，请新建房间');
    const next = structuredClone(room),
      game = next.game,
      patch = parsed.patch;
    if (patch.rules) next.rules = patch.rules;
    if (patch.players)
      for (const side of ['a', 'b'] as const) {
        const p = patch.players[side];
        if (!p) continue;
        if (p.energy > p.maxEnergy)
          throw new AppError(400, '当前行动点不能超过上限');
        if (p.pressure > p.pressureCap)
          throw new AppError(400, '当前压力不能超过上限');
        Object.assign(game!.players[side], p);
      }
    const paused = patch.paused ?? next.developer?.paused ?? false;
    next.developer = { used: true, paused };
    if (game) {
      if (patch.rules) game.rules = structuredClone(patch.rules);
      record(game, {
        kind: 'system',
        title: '开发者调整',
        text:
          '房主调整了本地测试数值' +
          (paused ? '，电脑与计时已暂停。' : '，电脑与计时正常运行。'),
      });
      settleDeveloperChanges(game);
      const wasPaused = !!room.developer?.paused;
      if (paused) game.clock = null;
      else {
        if (wasPaused) game.clock = null;
        updateClock(game, Date.now());
      }
      if (next.match) next.match.rulesHash = digest(next.rules);
    } else {
      for (const player of Object.values(next.players))
        if (player) player.ready = false;
      next.players[this.botSeat(next)]!.ready = true;
    }
    next.commands.push({ key, fingerprint });
    next.version++;
    this.save(next);
    this.publish(next);
    return { room: this.view(next, session), replayed: false };
  }
  ready(id: string, session: string, expected: number, prepared = true) {
    const room = this.get(id);
    const seat = this.seat(room, session);
    this.version(room, expected);
    if (room.game || !room.players[seat]?.song)
      throw new AppError(409, '请先选择底牌');
    room.players[seat]!.ready = prepared;
    room.version++;
    this.save(room);
    this.publish(room);
    return this.view(room, session);
  }
  assertCanStart(room: Room, session: string) {
    if (this.seat(room, session) !== this.hostSeat(room) || room.game)
      throw new AppError(409, '当前不能开局');
  }
  start(id: string, session: string, expected: number) {
    const room = this.get(id);
    this.version(room, expected);
    this.assertCanStart(room, session);
    const a = room.players.a?.song,
      b = room.players.b?.song;
    if (!a || !b || !room.players.a?.ready || !room.players.b?.ready)
      throw new AppError(409, '双方需要先选好底牌并确认当前规则');
    this.cancelSwap(room);
    if (a.id === b.id && digest(playFacts(a)) !== digest(playFacts(b)))
      throw new AppError(
        409,
        '同一录音的资料不一致，请双方重新选曲后开局',
        'SONG_SNAPSHOT_CONFLICT',
      );
    room.game = createGame(
      a.id,
      b.id,
      randomBytes(4).readUInt32LE(),
      room.rules,
      a.id === b.id ? [a] : [a, b],
      {
        mode: 'random',
      },
    );
    room.game.clock = null;
    updateClock(room.game, Date.now());
    room.match = {
      id: randomBytes(16).toString('hex'),
      startedAt: Date.now(),
      rulesHash: digest(room.rules),
      catalogHash: digest(room.game.catalog),
    };
    room.version++;
    this.save(room);
    this.publish(room);
    return this.view(room, session);
  }
  act(
    id: string,
    session: string,
    command: { id: string; version: number; action: PlayerAction },
  ) {
    const room = this.get(id);
    const side = this.seat(room, session);
    const key = `${side}:${command.id}`;
    const fingerprint = hash(JSON.stringify(command.action));
    const prior = room.commands.find((c) => c.key === key);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new AppError(409, '动作 ID 已用于不同内容', 'COMMAND_REUSED');
      return { room: this.view(room, session), replayed: true };
    }
    this.version(room, command.version);
    if (!room.game) throw new AppError(409, '对局尚未开始');
    const result = transition(room.game, {
      ...command.action,
      side,
    } as GameAction);
    if (result.error) throw new AppError(409, result.error, 'ILLEGAL_ACTION');
    room.game = result.state;
    if (room.developer?.paused) room.game.clock = null;
    room.commands.push({ key, fingerprint });
    // Keep accepted commands for the whole bounded match, including across process restarts.
    if (room.commands.length > 3000)
      throw new AppError(409, '此局已达到操作上限，请新建房间');
    room.version++;
    this.save(room);
    this.publish(room);
    return { room: this.view(room, session), replayed: false };
  }
  version(room: Room, expected: number) {
    if (room.version !== expected)
      throw new AppError(409, '房间状态已更新，请同步后重试', 'STALE_VERSION');
  }
  view(room: Room, session: string): RoomView {
    const me = this.seat(room, session);
    const game = room.game;
    const finished = game?.phase === 'finished';
    const view: RoomView = {
      protocol: PROTOCOL_VERSION,
      id: room.id,
      roomCode: room.joinCode,
      version: room.version,
      mode: room.mode,
      bot: room.bot,
      me,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      rules: room.rules,
      ...(this.developerEnabled &&
      room.mode === 'fixture' &&
      room.bot &&
      me === this.hostSeat(room)
        ? {
            developer: {
              used: !!room.developer?.used,
              paused: !!room.developer?.paused,
              ...(game
                ? {
                    players: Object.fromEntries(
                      (['a', 'b'] as const).map((side) => [
                        side,
                        Object.fromEntries([
                          ...DEVELOPER_PLAYER_FIELDS.map(([key]) => [
                            key,
                            game.players[side][key],
                          ]),
                          [
                            'informationUsed',
                            game.players[side].informationUsed,
                          ],
                        ]),
                      ]),
                    ) as NonNullable<RoomView['developer']>['players'],
                  }
                : {}),
            },
          }
        : {}),
      status: !game ? 'waiting' : finished ? 'finished' : 'playing',
      ...(room.swapAsk
        ? { swapAsk: { from: room.swapAsk.from, at: room.swapAsk.at } }
        : {}),
      players: (['a', 'b'] as const).map((seat) => ({
        seat,
        name: room.players[seat]?.name || '等待加入',
        joined: Boolean(room.players[seat]),
        ready: Boolean(room.players[seat]?.song && room.players[seat]?.ready),
        online:
          (room.bot && seat === this.botSeat(room)) ||
          [...(this.clients.get(room.id)?.values() || [])].includes(
            room.players[seat]?.session ?? '',
          ),
        energy: game?.players[seat].energy ?? room.rules.startingEnergy,
        pressure: game?.players[seat].pressure ?? 0,
        pressureCap:
          game?.players[seat].pressureCap ?? room.rules.pressureLimit,
        avatar: room.players[seat]?.avatar,
        maxEnergy: game?.players[seat].maxEnergy ?? room.rules.maxEnergy,
        events: game
          ? game.players[seat].eventHistory.map((h) => ({
              ...STAGE_EVENT_BY_ID[h.id]!,
              round: h.round,
            }))
          : [],
        statuses: game
          ? [
              ...playerStatuses(game, seat),
              ...(game.players[seat].shields
                ? ['伤害免疫 ×' + game.players[seat].shields]
                : []),
              ...(game.players[seat].damageBonus
                ? ['下次伤害 +' + game.players[seat].damageBonus]
                : []),
              ...(game.players[seat].repeatNext
                ? ['下张基础牌额外结算 ×' + game.players[seat].repeatNext]
                : []),
              ...(game.players[seat].extraDraw
                ? ['回合摸牌 +' + game.players[seat].extraDraw]
                : []),
              ...(game.players[seat].effects.noDiscardPhase
                ? ['跳过弃牌阶段']
                : []),
            ]
          : [],
        handCount: game?.players[seat].hand.length ?? 0,
        deckCount: game?.players[seat].deck.length ?? buildDeck(seat).length,
        discardCount: game?.players[seat].discard.length ?? 0,
      })),
      ownSong: room.players[me]?.song
        ? summary(room.players[me]!.song!)
        : undefined,
      canStart:
        me === this.hostSeat(room) &&
        !game &&
        Boolean(
          room.players.a?.song &&
          room.players.b?.song &&
          room.players.a.ready &&
          room.players.b.ready,
        ),
    };
    if (!game) return view;
    const choice = game.pending?.actor === me ? game.pending : undefined;
    view.game = {
      matchId: room.match?.id || String(room.match?.startedAt || room.id),
      phase: game.phase,
      active: game.active,
      round: game.round,
      hand: game.players[me].hand.map((card) => ({
        card,
        definition: cardViewDefinition(game, me, card.cardId),
        unavailable: cardUnavailableReason(game, me, card),
      })),
      clock: game.clock
        ? {
            serverNow: Date.now(),
            deadline: game.clock.deadline,
            kind: clockPhase(game)?.kind || 'play',
            seconds: clockPhase(game)?.seconds,
          }
        : undefined,
      handLimit: handLimit(game, me),
      skipDiscard: game.players[me].effects.noDiscardPhase,
      guessesRemaining: availableGuesses(game, me),
      guessMissPressure: guessMissCost(game, me),
      previewSeconds:
        game.players[me].effects.hideCluesUntilRound >= game.round
          ? 0
          : game.players[me].previewSegments * 10,
      cluesHidden: game.players[me].effects.hideCluesUntilRound >= game.round,
      growthCards: game.players[me].effects.growthCards.map((c) => ({
        id: c.id,
        level: Math.min(2, game.round - c.round),
        unavailable:
          game.phase !== 'playing' ||
          game.active !== me ||
          game.response ||
          game.pending ||
          game.rps ||
          waitingForEvents(game)
            ? '等待自己的出牌阶段'
            : undefined,
      })),
      clues: (game.players[me].effects.hideCluesUntilRound >= game.round
        ? []
        : game.players[me].clues
      ).map(({ source, ...clue }) => ({
        ...clue,
        sourceLabel: source.label,
      })),
      stats: {
        cardsPlayed:
          game.cardsPlayed?.[me] ??
          game.events.filter(
            (event) => event.kind === 'card' && event.side === me,
          ).length,
      },
      log: game.events.slice(-80).map((event) => {
        // 猜错要双方可见：提示条会显示「谁猜了哪首、没中」。
        // 只有「正在猜、结果未知」的情况才对对手隐去文案。
        const hideFromOpponent =
          event.kind === 'guess' && event.side !== me && !finished;
        return {
          id: event.id,
          kind: event.kind,
          amount: event.amount,
          title: event.title,
          cardId: event.cardId,
          responded: event.responded,
          definition: event.kind === 'card' ? event.definition : undefined,
          side: event.side,
          guessMiss: event.guessMiss,
          guessTitle: event.guessMiss ? event.guessTitle : undefined,
          text:
            hideFromOpponent && !event.guessMiss
              ? '对方提交了一次猜测。'
              : event.text,
        };
      }),
      response: game.response
        ? {
            kind: game.response.kind,
            defender: game.response.defender,
            title: game.response.cardId
              ? CARD_BY_ID[game.response.cardId].title
              : game.response.kind === 'dying'
                ? '濒死自救'
                : '事件伤害',
          }
        : undefined,
      waitingForChoice: !!game.pending && game.pending.actor !== me,
      choice: choice
        ? {
            title:
              choice.kind === 'intercept'
                ? '共鸣：选择随机弃牌或失去行动点'
                : choice.kind === 'lock'
                  ? '选择要封锁的对手手牌'
                  : '请选择要弃置的手牌',
            options:
              choice.kind === 'intercept'
                ? [
                    {
                      id: 'discard',
                      label: '随机弃 1 张手牌',
                      disabled: !game.players[me].hand.some(
                        (c) => !isLocked(game, c),
                      ),
                    },
                    {
                      id: 'damage',
                      label: '失去 1 点当前行动点',
                    },
                  ]
                : undefined,
            hiddenCount:
              choice.kind === 'lock'
                ? game.players[choice.target].hand.length
                : undefined,
            lockCount: choice.kind === 'lock' ? choice.remaining : undefined,
            cards: (choice.kind === 'lock'
              ? game.players[choice.target].hand
              : choice.kind === 'discardOwn'
                ? game.players[choice.target].hand.filter(
                    (c) => !c.generated && !isLocked(game, c),
                  )
                : []
            ).map((card) => ({
              card,
              definition: cardViewDefinition(game, choice.target, card.cardId),
              unavailable: isLocked(game, card) ? '已被封锁' : undefined,
            })),
          }
        : undefined,
      stageEvent: {
        refreshable: game.stageEvents.offers[me].filter((id) =>
          canRefreshEvent(game, me, id),
        ),
        refreshes: game.players[me].refreshes,
        freeRefresh: game.stageEvents.freeRefresh[me].reduce(
          (total, left) => total + left,
          0,
        ),
        canRefresh:
          game.phase === 'playing' &&
          waitingForEvents(game) &&
          !game.stageEvents.selected[me] &&
          (game.players[me].refreshes > 0 ||
            game.stageEvents.freeRefresh[me].some((left) => left > 0)),
        stage: game.stageEvents.stage,
        waiting: game.phase === 'playing' && waitingForEvents(game),
        selected: game.stageEvents.selected[me],
        opponentSelected: Boolean(
          game.stageEvents.selected[me === 'a' ? 'b' : 'a'],
        ),
        options: game.stageEvents.offers[me].map((id) => {
          const e = STAGE_EVENT_BY_ID[id]!;
          return {
            id: e.id,
            title: e.title,
            description: e.description,
            rarity: e.rarity,
          };
        }),
      },
      rps: game.rps
        ? {
            round: game.rps.round,
            submitted: !!game.rps.moves[me],
            opponentSubmitted: !!game.rps.moves[me === 'a' ? 'b' : 'a'],
          }
        : undefined,
      turnState: {
        attacksUsed: game.players[me].attacksUsed,
        attackLimit: game.players[me].attackLimit,
        informationUsed: game.players[me].informationUsed,
        activeGuessUsed: availableGuesses(game, me) === 0,
      },
      canEndTurn:
        game.phase === 'playing' &&
        game.active === me &&
        !game.pending &&
        !game.response &&
        !game.rps &&
        !waitingForEvents(game),
      canGuess:
        game.phase !== 'finished' &&
        (game.phase === 'playing' || !game.forcedSides.includes(me)
          ? availableGuesses(game, me) > 0
          : game.forcedSides.includes(me) && !game.guesses[me]),
      mustGuess:
        game.phase !== 'playing' &&
        game.phase !== 'finished' &&
        game.forcedSides.includes(me),
      guessSubmitted: Boolean(game.guesses[me]),
      outcome: game.outcome,
      revealed: finished
        ? (['a', 'b'] as const).map((seat) => ({
            seat,
            song: summary(room.players[seat]!.song!),
          }))
        : undefined,
    };
    return view;
  }
  connect(id: string, session: string, socket: WebSocket) {
    const room = this.get(id);
    this.seat(room, session);
    const set = this.clients.get(id) || new Map<WebSocket, string>();
    if ([...set.values()].filter((value) => value === session).length >= 4) {
      socket.close(1013, '此房间打开的页面过多，请关闭部分页面');
      return;
    }
    set.set(socket, session);
    this.clients.set(id, set);
    this.publish(room);
    socket.on('close', () => {
      set.delete(socket);
      if (!set.size) this.clients.delete(id);
      try {
        this.publish(this.get(id));
      } catch {}
    });
    this.scheduleBot(room);
  }
  publish(room: Room) {
    if (this.closed) return;
    const priorDeadline = this.deadlines.get(room.id);
    if (priorDeadline) clearTimeout(priorDeadline);
    this.deadlines.delete(room.id);
    this.scheduleDeadline(room);
    for (const [socket, session] of this.clients.get(room.id) || []) {
      if (socket.bufferedAmount > 256 * 1024) {
        socket.terminate();
        continue;
      }
      if (socket.readyState !== 1) continue;
      try {
        socket.send(
          JSON.stringify({
            type: 'snapshot',
            room: this.view(room, session),
          }),
        );
      } catch {
        /* 会话已经不在这个房间里了，下一拍自然不会再发 */
      }
    }
    this.scheduleBot(room);
  }
  private scheduleBot(room: Room) {
    const prior = this.timers.get(room.id);
    if (prior?.version === room.version) return;
    if (prior) clearTimeout(prior.timer);
    this.timers.delete(room.id);
    if (
      this.closed ||
      !room.bot ||
      room.developer?.paused ||
      !room.game ||
      room.game.phase === 'finished'
    )
      return;
    const seat = this.botSeat(room);
    const action = botAction(room.game, seat);
    if (!action) return;
    // A delay belongs to this snapshot only. A new response/choice must receive
    // its full delay rather than inheriting a nearly expired previous timer.
    const version = room.version;
    const timer = setTimeout(() => {
      this.timers.delete(room.id);
      try {
        const latest = this.get(room.id);
        if (
          this.closed ||
          latest.version !== version ||
          latest.developer?.paused
        ) {
          this.scheduleBot(latest);
          return;
        }
        this.act(room.id, latest.players[seat]!.session, {
          id: crypto.randomUUID(),
          version,
          action,
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'ROOM_NOT_FOUND')
          return;
        // Do not silently turn invalid bot moves into a wait for the human timeout.
        // Log only a code and action type, never private songs or session IDs.
        this.onBotError({
          code: error instanceof AppError ? error.code : 'BOT_ACTION_FAILED',
          action: action.type,
        });
      }
    }, BOT_ACTION_DELAY);
    timer.unref();
    this.timers.set(room.id, { timer, version });
  }
  close() {
    this.closed = true;
    for (const { timer } of this.timers.values()) clearTimeout(timer);
    for (const clients of this.clients.values())
      for (const socket of clients.keys()) socket.terminate();
    for (const timer of this.swapTimers.values()) clearTimeout(timer);
    this.swapTimers.clear();
    for (const timer of this.deadlines.values()) clearTimeout(timer);
    this.deadlines.clear();
    this.clients.clear();
    this.timers.clear();
  }
}

function playFacts(song: Song) {
  // Ignore cover URLs, reference links and fetch times when comparing the same recording.
  return {
    id: song.id,
    title: song.title,
    artists: song.artists,
    album: song.album,
    aliases: song.aliases,
    year: song.year,
    language: song.language,
    genre: song.genre,
    bpm: song.bpm,
    lyricists: song.lyricists,
    composers: song.composers,
    hasFemaleVoice: song.hasFemaleVoice,
    lyricHint: song.lyricHint,
    lyricHints: song.lyricHints,
    duration: song.duration,
    policy: song.evidence?.policyVersion,
    allowedSources: song.evidence?.allowedSources,
    facts:
      song.evidence &&
      Object.fromEntries(
        Object.entries(song.evidence.facts).map(([key, fact]) => [
          key,
          {
            status: fact.status,
            value: fact.selected?.value,
            source: fact.selected?.source,
          },
        ]),
      ),
  };
}
