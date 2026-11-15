import { z } from "zod";
import {
  groupVisibilitySchema,
  heroCombatSettingsSchema,
  positionSchema,
  slotSchema,
  weaponTypeSchema,
} from "./schemas.js";

export const registerInputSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "用户名至少 3 个字符")
      .max(20, "用户名最多 20 个字符")
      .regex(/^[\p{L}\p{N}_]+$/u, "用户名只能包含文字、数字和下划线"),
    password: z.string().min(6, "密码至少 6 位").max(72, "密码最多 72 位"),
  })
  .strict();

export const loginInputSchema = registerInputSchema;

export const createHeroInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "请填写英雄名")
      .max(12, "英雄名最多 12 个字符")
      .regex(/^[^\u0000-\u001f<>]+$/u, "英雄名包含非法字符"),
    raceId: z.string().min(1),
    weaponType: weaponTypeSchema,
    /** 一次建号抽选会话 id；raceId/weaponType 必须出自该次抽选。 */
    draftId: z.string().min(1),
  })
  .strict();

export const trainInputSchema = z
  .object({
    target: z.literal("skill"),
    key: z.string().min(1),
  })
  .strict();

/** 预览后一次性提交的技能训练/技能树解锁（增量，均为正数）。 */
export const trainBatchInputSchema = z
  .object({
    skills: z.record(z.string().min(1), z.number().int().min(1).max(19)).optional(),
    /** 本次要解锁的技能树节点 id。 */
    unlocks: z.array(z.string().min(1)).max(24).optional(),
  })
  .strict();

export const queueGroupInputSchema = z
  .object({
    dungeonId: z.string().min(1),
    /** 迷宫路径（房间 id，从入口开始）；不传时使用最短通路。 */
    roomPath: z.array(z.string().min(1)).min(1).max(24).optional(),
  })
  .strict();

export const dispatchInputSchema = z
  .object({
    dungeonId: z.string().min(1),
    /** 迷宫路径（房间 id，从入口开始，沿连接相邻前进）；不传时使用最短通路。 */
    roomPath: z.array(z.string().min(1)).min(1).max(24).optional(),
    heroIds: z.array(z.string().min(1)).min(3, "队伍至少 3 名英雄").max(4, "队伍最多 4 名英雄"),
    positions: z.record(z.string(), positionSchema).optional(),
    /** 英雄 id → 预设 id；不传时使用绑定该迷宫的预设或默认预设。 */
    presetIds: z.record(z.string(), z.string().min(1)).optional(),
    /** 可选的内容包 NPC 支援 id。 */
    npcIds: z.array(z.string().min(1)).max(2, "最多 2 名 NPC 支援").optional(),
    /** 本次远征的临时战前配置；不写回预设。键必须是 heroIds 中的英雄。 */
    settingsByHero: z.record(z.string(), heroCombatSettingsSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.heroIds).size !== value.heroIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "英雄不能重复" });
    }
    const npcIds = value.npcIds ?? [];
    if (new Set(npcIds).size !== npcIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "NPC 不能重复" });
    }
    for (const id of Object.keys(value.settingsByHero ?? {})) {
      if (!value.heroIds.includes(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "临时配置包含未参战的英雄",
        });
      }
    }
  });

/** 主动删除英雄：支付金币并输入英雄全名二次确认。 */
export const heroDeleteInputSchema = z
  .object({ confirmName: z.string().min(1, "请输入英雄全名确认") })
  .strict();

/** 使用死亡赦免/赎回券复活角色。 */
export const reviveHeroInputSchema = z
  .object({ token: z.enum(["pardon", "redemption"]) })
  .strict();

export const equipInputSchema = z.object({ itemId: z.string().min(1) }).strict();
export const unequipInputSchema = z.object({ slot: slotSchema }).strict();
export const idParamSchema = z.object({ id: z.string().min(1) });

/** 领取任务奖励；带英雄奖励时可指定领取英雄。 */
export const claimQuestInputSchema = z
  .object({ heroId: z.string().min(1).optional() })
  .strict();

/** 选择展示中的称号；null 表示不展示。 */
export const selectTitleInputSchema = z
  .object({ titleId: z.string().min(1).nullable() })
  .strict();

export const heroPresetInputSchema = z
  .object({
    name: z.string().trim().min(1, "请填写预设名").max(24, "预设名最多 24 个字符"),
    position: positionSchema,
    settings: heroCombatSettingsSchema.optional(),
  })
  .strict();

export const heroPresetUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "请填写预设名").max(24, "预设名最多 24 个字符").optional(),
    position: positionSchema.optional(),
    settings: heroCombatSettingsSchema.optional(),
  })
  .strict();

export const heroPresetParamsSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().min(1),
});

export type HeroDeleteInput = z.infer<typeof heroDeleteInputSchema>;
export type ReviveHeroInput = z.infer<typeof reviveHeroInputSchema>;

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type CreateHeroInput = z.infer<typeof createHeroInputSchema>;
export type TrainInput = z.infer<typeof trainInputSchema>;
export type TrainBatchInput = z.infer<typeof trainBatchInputSchema>;
export type DispatchInput = z.infer<typeof dispatchInputSchema>;
export type EquipInput = z.infer<typeof equipInputSchema>;
export type UnequipInput = z.infer<typeof unequipInputSchema>;
export type HeroPresetInput = z.infer<typeof heroPresetInputSchema>;
export type HeroPresetUpdateInput = z.infer<typeof heroPresetUpdateSchema>;
export type ClaimQuestInput = z.infer<typeof claimQuestInputSchema>;
export type SelectTitleInput = z.infer<typeof selectTitleInputSchema>;

export const createGroupInputSchema = z
  .object({
    name: z.string().trim().min(2, "队伍名至少 2 个字符").max(24, "队伍名最多 24 个字符"),
    visibility: groupVisibilitySchema.default("public"),
  })
  .strict();

export const friendRequestInputSchema = z
  .object({
    username: z.string().trim().min(1, "请填写用户名").max(20),
  })
  .strict();

export const joinGroupInputSchema = z
  .object({ code: z.string().trim().min(4, "请填写队伍邀请码").max(16) })
  .strict();

export const groupHeroInputSchema = z
  .object({
    heroId: z.string().min(1),
    position: positionSchema.default("front"),
  })
  .strict();

export const groupPositionInputSchema = z
  .object({
    heroId: z.string().min(1),
    position: positionSchema,
    /** 可选：同时为该英雄选定战斗预设。 */
    presetId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const groupHeroSettingsInputSchema = z
  .object({
    heroId: z.string().min(1),
    settings: heroCombatSettingsSchema,
  })
  .strict();

export const groupStartInputSchema = z
  .object({
    dungeonId: z.string().min(1),
    routeId: z.string().min(1).optional(),
    depth: z.number().int().min(1).max(10).optional(),
  })
  .strict();

/** 炼药：选择 1-2 个不同效果类别的材料堆叠。 */
export const alchemyCraftInputSchema = z
  .object({
    ingredientIds: z.array(z.string().min(1)).min(1).max(2, "最多混合两种效果"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.ingredientIds).size !== value.ingredientIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "材料不能重复" });
    }
  });

export const forgeItemInputSchema = z.object({ itemId: z.string().min(1) }).strict();

export const dungeonPreferenceInputSchema = z
  .object({ routeId: z.string().min(1) })
  .strict();

export const lotteryEnterInputSchema = z
  .object({ count: z.number().int().min(1).max(10000) })
  .strict();

export const lotteryUseManualInputSchema = z
  .object({ heroId: z.string().min(1) })
  .strict();

export const personalMazeExpandInputSchema = z
  .object({ seriesId: z.string().regex(/^[a-z0-9-]+$/) })
  .strict();

export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;
export type JoinGroupInput = z.infer<typeof joinGroupInputSchema>;
export type GroupHeroInput = z.infer<typeof groupHeroInputSchema>;
export type GroupPositionInput = z.infer<typeof groupPositionInputSchema>;
export type GroupHeroSettingsInput = z.infer<typeof groupHeroSettingsInputSchema>;
export type GroupStartInput = z.infer<typeof groupStartInputSchema>;
export type AlchemyCraftInput = z.infer<typeof alchemyCraftInputSchema>;
export type ForgeItemInput = z.infer<typeof forgeItemInputSchema>;
export type DungeonPreferenceInput = z.infer<typeof dungeonPreferenceInputSchema>;

export const marketListInputSchema = z
  .object({
    itemId: z.string().min(1),
    price: z.number().int().min(1, "价格至少 1 金币").max(1_000_000, "价格过高"),
  })
  .strict();

export type MarketListInput = z.infer<typeof marketListInputSchema>;

export const auctionListInputSchema = z
  .object({
    itemId: z.string().min(1),
    startPrice: z.number().int().min(1).max(1_000_000),
    buyoutPrice: z.number().int().min(1).max(1_000_000).optional(),
    durationHours: z.number().int().min(1).max(72).default(24),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.buyoutPrice !== undefined && value.buyoutPrice <= value.startPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "一口价必须高于起拍价",
      });
    }
  });

export const auctionBidInputSchema = z
  .object({ amount: z.number().int().min(1).max(1_000_000) })
  .strict();

export type AuctionListInput = z.infer<typeof auctionListInputSchema>;
export type AuctionBidInput = z.infer<typeof auctionBidInputSchema>;

export const createClanInputSchema = z
  .object({
    name: z.string().trim().min(2, "公会名至少 2 个字符").max(24, "公会名最多 24 个字符"),
    tag: z
      .string()
      .trim()
      .min(2, "标签至少 2 个字符")
      .max(6, "标签最多 6 个字符")
      .regex(/^[A-Za-z0-9]+$/, "标签只能包含字母和数字"),
  })
  .strict();

export const joinClanInputSchema = z
  .object({ tag: z.string().trim().min(2).max(6) })
  .strict();

export type CreateClanInput = z.infer<typeof createClanInputSchema>;
export type JoinClanInput = z.infer<typeof joinClanInputSchema>;

export const duelInputSchema = z
  .object({
    heroId: z.string().min(1),
    opponentHeroId: z.string().min(1),
  })
  .strict();

/** Arena teams are always exactly four distinct heroes with explicit positions. */
export const arenaTeamInputSchema = z
  .object({
    members: z
      .array(
        z.object({ heroId: z.string().min(1), position: positionSchema }).strict(),
      )
      .length(4, "竞技场队伍必须有 4 名英雄"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.members.map((member) => member.heroId)).size !== 4) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "竞技场英雄不能重复" });
    }
  });

export const arenaChallengeInputSchema = z
  .object({ opponentTeamId: z.string().min(1) })
  .strict();

export type DuelInput = z.infer<typeof duelInputSchema>;
export type ArenaTeamInput = z.infer<typeof arenaTeamInputSchema>;
export type ArenaChallengeInput = z.infer<typeof arenaChallengeInputSchema>;

export const clanGoldInputSchema = z
  .object({ amount: z.number().int().min(1).max(1_000_000) })
  .strict();

export const clanItemInputSchema = z.object({ itemId: z.string().min(1) }).strict();

export const chatInputSchema = z
  .object({
    channel: z.enum(["global", "clan", "group"]),
    groupId: z.string().min(1).optional(),
    message: z.string().trim().min(1, "消息不能为空").max(200, "消息最多 200 字"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channel === "group" && !value.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "队伍频道需要 groupId",
      });
    }
    if (value.channel !== "group" && value.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "只有队伍频道可以携带 groupId",
      });
    }
  });

export type ClanGoldInput = z.infer<typeof clanGoldInputSchema>;
export type ClanItemInput = z.infer<typeof clanItemInputSchema>;
export type ChatInput = z.infer<typeof chatInputSchema>;
