import { z } from 'zod';

/** Local test controls are separate from the ordinary multiplayer rules contract. */
export const DEVELOPER_RULE_FIELDS = [
  ['maxEnergy', '行动点上限', 1, 99],
  ['startingEnergy', '回合起始行动点', 1, 99],
  ['initialHand', '起手张数', 0, 22],
  ['drawPerTurn', '每回合摸牌', 0, 22],
  ['handLimit', '手牌上限', 0, 99],
  ['pressureLimit', '压力上限 %', 1, 500],
  ['damagePressure', '每次攻击增加压力', 0, 100],
  ['guessMissPressure', '猜错基础压力', 0, 100],
  ['maxRounds', '轮数上限（0 为不限）', 0, 100],
] as const;
export const developerRulesSchema = z
  .object({
    maxEnergy: z.number().int().min(1).max(99),
    startingEnergy: z.number().int().min(1).max(99),
    initialHand: z.number().int().min(0).max(22),
    drawPerTurn: z.number().int().min(0).max(22),
    handLimit: z.number().int().min(0).max(99),
    pressureLimit: z.number().int().min(1).max(500),
    damagePressure: z.number().int().min(0).max(100),
    guessMissPressure: z.number().int().min(0).max(100),
    maxRounds: z.number().int().min(0).max(100),
    cluePressure: z
      .object({
        1: z.number().int().min(0).max(100),
        2: z.number().int().min(0).max(100),
        3: z.number().int().min(0).max(100),
        4: z.number().int().min(0).max(100),
      })
      .strict(),
    clueOdds: z
      .object({
        1: z.tuple([
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
        ]),
        2: z.tuple([
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
        ]),
        3: z.tuple([
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
        ]),
        4: z.tuple([
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
          z.number().int().min(0).max(100),
        ]),
      })
      .strict(),
    fusion: z.boolean(),
  })
  .strict()
  .refine((r) => r.startingEnergy <= r.maxEnergy, '回合起始行动点不能超过上限');
export const DEVELOPER_PLAYER_FIELDS = [
  ['energy', '当前行动点', 0, 99],
  ['maxEnergy', '行动点上限', 1, 99],
  ['pressure', '当前压力 %', 0, 500],
  ['pressureCap', '压力上限 %', 1, 500],
  ['guessesRemaining', '永久猜歌次数', 0, 99],
  ['refreshes', '储备事件刷新次数', 0, 99],
  ['attackLimit', '攻击统计上限（不限制出牌）', 0, 99],
  ['attacksUsed', '本回合已用攻击次数', 0, 99],
  ['damageBonus', '下次伤害加成', 0, 99],
  ['shields', '护盾次数', 0, 99],
  ['extraDraw', '额外摸牌数', 0, 22],
] as const;
const playerValues = z
  .object({
    energy: z.number().int().min(0).max(99),
    maxEnergy: z.number().int().min(1).max(99),
    pressure: z.number().int().min(0).max(500),
    pressureCap: z.number().int().min(1).max(500),
    guessesRemaining: z.number().int().min(0).max(99),
    refreshes: z.number().int().min(0).max(99),
    attackLimit: z.number().int().min(0).max(99),
    attacksUsed: z.number().int().min(0).max(99),
    damageBonus: z.number().int().min(0).max(99),
    shields: z.number().int().min(0).max(99),
    extraDraw: z.number().int().min(0).max(22),
    informationUsed: z.boolean(),
  })
  .strict();
export type DeveloperPlayerValues = z.infer<typeof playerValues>;
export const developerPatchSchema = z
  .object({
    rules: developerRulesSchema.optional(),
    players: z
      .object({ a: playerValues.optional(), b: playerValues.optional() })
      .strict()
      .optional(),
    paused: z.boolean().optional(),
  })
  .strict()
  .refine(
    (p) => p.rules || p.players || p.paused !== undefined,
    '请选择需要调整的数值',
  );
export type DeveloperPatch = z.infer<typeof developerPatchSchema>;
export const developerCommandSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    patch: developerPatchSchema,
  })
  .strict();
export type DeveloperCommand = z.infer<typeof developerCommandSchema>;
