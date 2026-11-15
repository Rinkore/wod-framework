import { z } from "zod";

/**
 * 角色基础数值。旧版八维属性（力/体/智/灵/魅/敏/感/志）已删除：
 * 这些数值由过往初始值 + 等级成长 + 技能树被动共同提供。
 */
export const BASE_STAT_KEYS = [
  "hp",
  "mana",
  "attack",
  "armor",
  "hit",
  "evasion",
  "initiative",
  "crit",
] as const;
export const baseStatKeySchema = z.enum(BASE_STAT_KEYS);
export type BaseStatKey = z.infer<typeof baseStatKeySchema>;

export const DAMAGE_TYPES = [
  "crushing",
  "cutting",
  "piercing",
  "fire",
  "ice",
  "lightning",
  "sleep",
  "poison",
] as const;
export const damageTypeSchema = z.enum(DAMAGE_TYPES);
export type DamageType = z.infer<typeof damageTypeSchema>;

export const AILMENTS = [
  "burn",
  "freeze",
  "paralysis",
  "sleep",
  "poison",
  "bleed",
  "stun",
  "wound",
] as const;
export const ailmentSchema = z.enum(AILMENTS);
export type Ailment = z.infer<typeof ailmentSchema>;

export const AILMENT_LABELS: Record<Ailment, string> = {
  burn: "灼伤",
  freeze: "冰冻",
  paralysis: "麻痹",
  sleep: "睡眠",
  poison: "中毒",
  bleed: "流血",
  stun: "晕眩",
  wound: "伤口",
};

/** 每种伤害类型对应的异常。 */
export const AILMENT_FOR_DAMAGE_TYPE: Record<DamageType, Ailment> = {
  crushing: "stun",
  cutting: "bleed",
  piercing: "wound",
  fire: "burn",
  ice: "freeze",
  lightning: "paralysis",
  sleep: "sleep",
  poison: "poison",
};

export function ailmentForDamageType(type: DamageType): Ailment {
  return AILMENT_FOR_DAMAGE_TYPE[type];
}

export const RARITIES = ["common", "uncommon", "rare", "epic"] as const;
export const raritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof raritySchema>;

export const SLOTS = ["weapon", "armor", "trinket"] as const;
export const slotSchema = z.enum(SLOTS);
export type Slot = z.infer<typeof slotSchema>;

/** 物品槽位：三件装备。只有装备可以穿戴。 */
export const ITEM_SLOTS = [...SLOTS] as const;
export const itemSlotSchema = z.enum(ITEM_SLOTS);
export type ItemSlot = z.infer<typeof itemSlotSchema>;

export const ITEM_KINDS = ["equipment"] as const;
export const itemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const WEAPON_TYPES = [
  "sword",
  "axe",
  "hammer",
  "bow",
  "dagger",
  "staff",
  "book",
  "instrument",
] as const;
export const weaponTypeSchema = z.enum(WEAPON_TYPES);
export type WeaponType = z.infer<typeof weaponTypeSchema>;

export const WEAPON_TYPE_LABELS: Record<WeaponType, string> = {
  sword: "剑",
  axe: "斧",
  hammer: "锤",
  bow: "弓",
  staff: "法杖",
  dagger: "匕首",
  book: "经卷",
  instrument: "乐器",
};

export const BASE_STAT_LABELS: Record<BaseStatKey, string> = {
  hp: "生命",
  mana: "法力",
  attack: "攻击",
  armor: "护甲",
  hit: "命中",
  evasion: "闪避",
  initiative: "先攻",
  crit: "暴击",
};

export const BASE_STAT_SHORT_LABELS: Record<BaseStatKey, string> = {
  hp: "生命",
  mana: "法力",
  attack: "攻击",
  armor: "护甲",
  hit: "命中",
  evasion: "闪避",
  initiative: "先攻",
  crit: "暴击",
};

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  crushing: "打击",
  cutting: "斩击",
  piercing: "穿刺",
  fire: "火焰",
  ice: "寒冰",
  lightning: "雷电",
  sleep: "眠",
  poison: "毒",
};

/**
 * 伤害减免通道：物理走护甲，元素与混沌各走对应抗性。
 * 抗性不再按 10 系单独配置，只保留元素/混沌两条。
 */
export const DAMAGE_CHANNELS = ["physical", "elemental", "chaos"] as const;
export type DamageChannel = (typeof DAMAGE_CHANNELS)[number];

export const DAMAGE_CHANNEL_LABELS: Record<DamageChannel, string> = {
  physical: "物理",
  elemental: "元素",
  chaos: "混沌",
};

const ELEMENTAL_DAMAGE_TYPES: ReadonlySet<DamageType> = new Set([
  "fire",
  "ice",
  "lightning",
]);

/** 伤害类型归属的减免通道。 */
export function damageChannel(type: DamageType): DamageChannel {
  if (type === "crushing" || type === "cutting" || type === "piercing") return "physical";
  if (ELEMENTAL_DAMAGE_TYPES.has(type)) return "elemental";
  return "chaos";
}

/** 判断伤害类型是否为物理三系（受护甲减免、吃武器伤害）。 */
export function isPhysicalDamageType(type: DamageType): boolean {
  return damageChannel(type) === "physical";
}

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "普通",
  uncommon: "精良",
  rare: "稀有",
  epic: "史诗",
};

export const RARITY_ORDER: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
};

export const SLOT_LABELS: Record<Slot, string> = {
  weapon: "武器",
  armor: "护甲",
  trinket: "饰品",
};

export const ITEM_SLOT_LABELS: Record<ItemSlot, string> = {
  ...SLOT_LABELS,
};

export const positionSchema = z.enum(["front", "flank", "back"]);
export type Position = z.infer<typeof positionSchema>;

/** 默认站在后排的远程武器。 */
const BACKLINE_WEAPON_TYPES = new Set<WeaponType>([
  "bow",
  "staff",
  "book",
  "instrument",
]);

/** 创建角色时默认预设的站位：远程武器后排，近战武器前排。 */
export function defaultPositionForWeapon(weaponType: WeaponType): Position {
  return BACKLINE_WEAPON_TYPES.has(weaponType) ? "back" : "front";
}

/** 队伍可见性：决定是否出现在公开列表，以及哪些人可以凭队伍编号加入。 */
export const GROUP_VISIBILITIES = [
  "public",
  "invite",
  "friends",
  "guild",
  "guild-friends",
] as const;
export const groupVisibilitySchema = z.enum(GROUP_VISIBILITIES);
export type GroupVisibility = z.infer<typeof groupVisibilitySchema>;

export const GROUP_VISIBILITY_LABELS: Record<GroupVisibility, string> = {
  public: "公开",
  invite: "仅邀请",
  friends: "仅好友",
  guild: "仅公会",
  "guild-friends": "仅公会和好友",
};

export const TARGET_PRIORITIES = ["nearest", "lowest-hp", "caster", "strongest"] as const;
export const targetPrioritySchema = z.enum(TARGET_PRIORITIES);
export type TargetPriority = z.infer<typeof targetPrioritySchema>;

export const TARGET_PRIORITY_LABELS: Record<TargetPriority, string> = {
  nearest: "最近目标",
  "lowest-hp": "最低生命",
  caster: "施法者优先",
  strongest: "最强目标",
};

export const SKILL_PHASES = ["pre", "initiative", "main"] as const;
export const skillPhaseSchema = z.enum(SKILL_PHASES);
export type SkillPhase = z.infer<typeof skillPhaseSchema>;

export const SKILL_PHASE_LABELS: Record<SkillPhase, string> = {
  pre: "回合前",
  initiative: "先攻",
  main: "主回合",
};

export const phaseSettingsSchema = z
  .object({
    skillIds: z.array(z.string().min(1)).max(12).optional(),
    targetPriority: targetPrioritySchema.optional(),
  })
  .strict();
export type PhaseSettings = z.infer<typeof phaseSettingsSchema>;

export const phaseSettingsMapSchema = z
  .object({
    pre: phaseSettingsSchema.optional(),
    initiative: phaseSettingsSchema.optional(),
    main: phaseSettingsSchema.optional(),
  })
  .strict();
export type PhaseSettingsMap = z.infer<typeof phaseSettingsMapSchema>;

export const floorCombatSettingsSchema = z
  .object({
    targetPriority: targetPrioritySchema.optional(),
    phases: phaseSettingsMapSchema.optional(),
  })
  .strict();
export type FloorCombatSettings = z.infer<typeof floorCombatSettingsSchema>;

export const EVACUATION_TYPES = ["hp", "downed", "rooms"] as const;
export const evacuationTypeSchema = z.enum(EVACUATION_TYPES);
export type EvacuationType = z.infer<typeof evacuationTypeSchema>;

export const EVACUATION_TYPE_LABELS: Record<EvacuationType, string> = {
  hp: "自身生命低于",
  downed: "队伍倒地达到",
  rooms: "已推进房间达到",
};

/** 撤离条件：任意角色在房间清空后达成即全员成功撤离（保留已得掉落，无人死亡）。 */
export const evacuationSchema = z
  .object({
    type: evacuationTypeSchema,
    value: z.number().int().min(1).max(99),
  })
  .strict();
export type Evacuation = z.infer<typeof evacuationSchema>;

export const heroCombatSettingsSchema = z
  .object({
    targetPriority: targetPrioritySchema.optional(),
    /** 撤离条件；不填表示不自动撤离。 */
    evacuation: evacuationSchema.optional(),
    /** @deprecated 旧预设字段，已不参与命中/闪避结算；保留仅为兼容旧存档。 */
    defenseSkillId: z.string().min(1).optional(),
    phases: phaseSettingsMapSchema.optional(),
    floors: z
      .record(z.string().regex(/^[1-9][0-9]?$/), floorCombatSettingsSchema)
      .optional(),
    boundDungeonId: z.string().min(1).optional(),
  })
  .strict();
export type HeroCombatSettings = z.infer<typeof heroCombatSettingsSchema>;

/**
 * 角色/怪物基础数值。crit 使用百分点（3 = 3%），其余为平值。
 * 英雄由过往初始 + 等级成长 + 被动提供；怪物由内容包的 base + 等级成长提供。
 */
export const baseStatsSchema = z
  .object({
    hp: z.number().min(0).max(9999),
    mana: z.number().min(0).max(9999),
    attack: z.number().min(0).max(999),
    armor: z.number().min(0).max(999),
    hit: z.number().min(0).max(999),
    evasion: z.number().min(0).max(999),
    initiative: z.number().min(0).max(999),
    crit: z.number().min(0).max(100),
  })
  .strict();

export const partialBaseStatsSchema = baseStatsSchema.partial();

export type BaseStats = z.infer<typeof baseStatsSchema>;
export type PartialBaseStats = z.infer<typeof partialBaseStatsSchema>;

/** 内容包里的固定 NPC 支援；不是玩家英雄，不进入英雄结算。 */
export const npcSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    raceId: z.string().min(1),
    weaponType: weaponTypeSchema,
    level: z.number().int().min(1).max(99).default(1),
    /** NPC 可固定携带的被动节点；不填则只有过往 base。 */
    passiveSkillIds: z.array(z.string().min(1)).default([]),
    skillLevels: z.record(z.string(), z.number().int().min(1)).default({}),
    equipment: z.array(z.string().min(1)).default([]),
    position: positionSchema.default("front"),
  })
  .strict();

export type Npc = z.infer<typeof npcSchema>;

/** 称号：按声望阈值解锁，或由任务直接授予；仅展示。 */
export const titleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    /** 达到该声望自动解锁；任务专属称号填一个不可达值。 */
    fameThreshold: z.number().int().min(0).default(9999),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .strict();

export const questObjectiveSchema = z
  .object({
    type: z.enum([
      "complete-dungeon",
      "win-expedition",
      "defeat-monsters",
      "win-duel",
      "earn-fame",
    ]),
    /** complete-dungeon 需要填写迷宫 id。 */
    targetId: z.string().min(1).optional(),
    count: z.number().int().min(1),
  })
  .strict();

export const questSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    category: z.enum(["main", "side"]).default("side"),
    objectives: z.array(questObjectiveSchema).min(1),
    rewards: z
      .object({
        gold: z.number().int().min(0).default(0),
        ep: z.number().int().min(0).default(0),
        fame: z.number().int().min(0).default(0),
        titleId: z.string().min(1).optional(),
      })
      .strict(),
    prerequisiteQuestIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type Title = z.infer<typeof titleSchema>;
export type Quest = z.infer<typeof questSchema>;
export type QuestObjective = z.infer<typeof questObjectiveSchema>;

/** 双通道抗性：元素与混沌，取值为小数比例（0.3 = 30% 减免，可为负表易伤）。 */
export const resistanceSchema = z
  .object({
    elemental: z.number().min(-1).max(1).optional(),
    chaos: z.number().min(-1).max(1).optional(),
  })
  .strict();
export type Resistance = z.infer<typeof resistanceSchema>;

/**
 * 统一修正体系：装备词条、被动加成与战斗 buff 共用同一套修正。
 * amount 语义按 kind 分两类：
 * - 百分比类（PCT）：单位为百分点，8 表示 +8%。
 * - 平值类（FLAT）：直接加减对应评分（命中/闪避/护甲/先攻）或每回合资源。
 */
export const MODIFIER_KINDS = [
  "damageDealt",
  "damageTaken",
  "healing",
  "hit",
  "evasion",
  "crit",
  "critDamage",
  "armor",
  "elementalResist",
  "chaosResist",
  "initiative",
  "energyRegen",
  "lifesteal",
  "dotPotency",
  "ailmentEfficiency",
  "ailmentResistance",
] as const;
export const modifierKindSchema = z.enum(MODIFIER_KINDS);
export type ModifierKind = z.infer<typeof modifierKindSchema>;

export const MODIFIER_KIND_LABELS: Record<ModifierKind, string> = {
  damageDealt: "造成伤害",
  damageTaken: "受到伤害",
  healing: "治疗效果",
  hit: "命中",
  evasion: "闪避",
  crit: "暴击率",
  critDamage: "暴击伤害",
  armor: "护甲",
  elementalResist: "元素抗性",
  chaosResist: "混沌抗性",
  initiative: "先攻",
  energyRegen: "法力回复",
  lifesteal: "吸血",
  dotPotency: "持续伤害",
  ailmentEfficiency: "异常效率",
  ailmentResistance: "异常抗性",
};

/** 百分比语义的修正种类；其余为平值加减。 */
export const MODIFIER_PCT_KINDS: ReadonlySet<ModifierKind> = new Set([
  "damageDealt",
  "damageTaken",
  "healing",
  "crit",
  "critDamage",
  "elementalResist",
  "chaosResist",
  "lifesteal",
  "dotPotency",
  "ailmentResistance",
]);

export function isPctModifierKind(kind: ModifierKind): boolean {
  return MODIFIER_PCT_KINDS.has(kind);
}

export const modifierSchema = z
  .object({
    kind: modifierKindSchema,
    amount: z.number(),
  })
  .strict();
export type Modifier = z.infer<typeof modifierSchema>;

/** 该修正变化对持有者是否有利（受到伤害降低也是增益，用于战报配色）。 */
export function modifierBeneficial(kind: ModifierKind, amount: number): boolean {
  return kind === "damageTaken" ? amount < 0 : amount > 0;
}

/** 修正幅度展示文本：+8% / -3 / +2。 */
export function modifierAmountText(kind: ModifierKind, amount: number): string {
  const sign = amount >= 0 ? "+" : "";
  const clean = Number(amount.toFixed(2));
  return isPctModifierKind(kind) ? `${sign}${clean}%` : `${sign}${clean}`;
}

export const passiveSchema = z
  .object({
    hpPct: z.number().min(-1).max(2).optional(),
    manaPct: z.number().min(-1).max(2).optional(),
    energyPct: z.number().min(-1).max(2).optional(),
    initiativePct: z.number().min(-1).max(2).optional(),
    critPct: z.number().min(-1).max(1).optional(),
    resist: resistanceSchema.optional(),
  })
  .strict();

/** 站位条件修正组：只有站在指定位置时这些修正才生效。 */
export const positionModifierGroupSchema = z
  .object({
    position: positionSchema,
    modifiers: z.array(modifierSchema).min(1),
  })
  .strict();
export type PositionModifierGroup = z.infer<typeof positionModifierGroupSchema>;

/**
 * 过往与被动共用的"钩子"：站位、连击、减益对抗、技能构筑、极端组合。
 * 过往与被动的钩子会相加/取或后生效。
 */
export const hooksSchema = z
  .object({
    /** 站位条件修正。 */
    positionModifiers: z.array(positionModifierGroupSchema).default([]),
    /** 近战可越过敌方前排选目标。 */
    ignoresEnemyFormation: z.boolean().default(false),
    /** 旧内容兼容字段；当前不会增加整回合主要行动。 */
    extraActions: z.number().int().min(0).max(1).default(0),
    /** 群攻每多命中一个目标，伤害额外提高的比例（小数）。 */
    multiTargetBonusPct: z.number().min(0).max(0.5).default(0),
    /** 改变技能形态：单体攻击技能扩散为全体。 */
    spreadSingleTarget: z.boolean().default(false),
    /** 扩散后的伤害修正（负数表示惩罚）。 */
    spreadPenaltyPct: z.number().min(-0.6).max(0).default(-0.25),
    /** 受到的负面效果持续回合数减少。 */
    debuffDurationReduction: z.number().int().min(0).max(3).default(0),
    /** 受到负面效果时反弹给施加者的概率。 */
    debuffReflectChance: z.number().min(0).max(1).default(0),
    /** 受到的负修正符号反转为增益。 */
    invertDebuffSign: z.boolean().default(false),
    /** 按技能种类(攻击/治疗/增益)分别加成等级。 */
    skillLevelBonus: z
      .object({
        attack: z.number().int().min(0).max(3).default(0),
        heal: z.number().int().min(0).max(3).default(0),
        buff: z.number().int().min(0).max(3).default(0),
      })
      .strict()
      .default({ attack: 0, heal: 0, buff: 0 }),
    /** 技能法力消耗修正。 */
    energyCostPct: z.number().min(-0.5).max(0.5).default(0),
    /** 技能冷却减少回合数。 */
    cooldownReduction: z.number().int().min(0).max(2).default(0),
    /** 全部技能量级（伤害/治疗/持续/护盾）提升比例。 */
    skillPowerPct: z.number().min(0).max(0.5).default(0),
    /** 生命低于 40% 时造成伤害提升比例。 */
    lowHpFuryPct: z.number().min(0).max(1).default(0),
    /** 法力低于 30% 时每回合额外恢复。 */
    energySurgeRegen: z.number().int().min(0).max(10).default(0),
  })
  .strict();
export type TraitHooks = z.infer<typeof hooksSchema>;

export function emptyHooks(): TraitHooks {
  return hooksSchema.parse({});
}

/** 合并多组钩子：数值相加、布尔取或、站位组拼接。 */
export function mergeHooks(...parts: Array<TraitHooks | undefined>): TraitHooks {
  const merged = emptyHooks();
  for (const part of parts) {
    if (!part) continue;
    merged.positionModifiers.push(...part.positionModifiers);
    merged.ignoresEnemyFormation ||= part.ignoresEnemyFormation;
    merged.extraActions += part.extraActions;
    merged.multiTargetBonusPct += part.multiTargetBonusPct;
    merged.spreadSingleTarget ||= part.spreadSingleTarget;
    merged.spreadPenaltyPct = Math.min(merged.spreadPenaltyPct, part.spreadPenaltyPct);
    merged.debuffDurationReduction += part.debuffDurationReduction;
    merged.debuffReflectChance += part.debuffReflectChance;
    merged.invertDebuffSign ||= part.invertDebuffSign;
    merged.skillLevelBonus = {
      attack: Math.min(3, merged.skillLevelBonus.attack + part.skillLevelBonus.attack),
      heal: Math.min(3, merged.skillLevelBonus.heal + part.skillLevelBonus.heal),
      buff: Math.min(3, merged.skillLevelBonus.buff + part.skillLevelBonus.buff),
    };
    merged.energyCostPct += part.energyCostPct;
    merged.cooldownReduction += part.cooldownReduction;
    merged.skillPowerPct += part.skillPowerPct;
    merged.lowHpFuryPct += part.lowHpFuryPct;
    merged.energySurgeRegen += part.energySurgeRegen;
  }
  merged.extraActions = Math.min(2, merged.extraActions);
  merged.debuffDurationReduction = Math.min(3, merged.debuffDurationReduction);
  merged.debuffReflectChance = Math.min(1, merged.debuffReflectChance);
  merged.cooldownReduction = Math.min(2, merged.cooldownReduction);
  merged.energyCostPct = Math.min(0.5, Math.max(-0.5, merged.energyCostPct));
  merged.skillPowerPct = Math.min(0.5, merged.skillPowerPct);
  merged.lowHpFuryPct = Math.min(1, merged.lowHpFuryPct);
  merged.energySurgeRegen = Math.min(10, merged.energySurgeRegen);
  return merged;
}

export const POSITION_LABELS: Record<Position, string> = {
  front: "前排",
  flank: "游走",
  back: "后排",
};

/** 钩子的人话描述列表（只列出非默认项），供创建页/图鉴/英雄面板展示。 */
export function hooksTexts(hooks: TraitHooks): string[] {
  const rows: string[] = [];
  for (const group of hooks.positionModifiers) {
    const mods = group.modifiers
      .map((row) => `${MODIFIER_KIND_LABELS[row.kind]} ${modifierAmountText(row.kind, row.amount)}`)
      .join("、");
    rows.push(`${POSITION_LABELS[group.position]}时：${mods}`);
  }
  if (hooks.ignoresEnemyFormation) rows.push("近战攻击可越过敌方前排");
  if (hooks.extraActions > 0) rows.push("旧版额外行动钩子（当前不增加主要行动）");
  if (hooks.multiTargetBonusPct > 0) {
    rows.push(`群攻每多命中 1 个目标，伤害 +${Math.round(hooks.multiTargetBonusPct * 100)}%`);
  }
  if (hooks.spreadSingleTarget) {
    rows.push(`单体攻击技能扩散为全体（伤害 ${Math.round(hooks.spreadPenaltyPct * 100)}%）`);
  }
  if (hooks.debuffDurationReduction > 0) {
    rows.push(`受到的负面效果持续 -${hooks.debuffDurationReduction} 回合`);
  }
  if (hooks.debuffReflectChance > 0) {
    rows.push(`受到负面效果时 ${Math.round(hooks.debuffReflectChance * 100)}% 概率反弹给施加者`);
  }
  if (hooks.invertDebuffSign) rows.push("受到的负修正反转为增益");
  if (hooks.skillLevelBonus.attack > 0) rows.push(`攻击类技能等级 +${hooks.skillLevelBonus.attack}`);
  if (hooks.skillLevelBonus.heal > 0) rows.push(`治疗类技能等级 +${hooks.skillLevelBonus.heal}`);
  if (hooks.skillLevelBonus.buff > 0) rows.push(`增益类技能等级 +${hooks.skillLevelBonus.buff}`);
  if (hooks.energyCostPct !== 0) {
    rows.push(`技能法力消耗 ${Math.round(hooks.energyCostPct * 100)}%`);
  }
  if (hooks.cooldownReduction > 0) rows.push(`技能冷却 -${hooks.cooldownReduction}`);
  if (hooks.skillPowerPct > 0) rows.push(`所有技能量级 +${Math.round(hooks.skillPowerPct * 100)}%`);
  if (hooks.lowHpFuryPct > 0) {
    rows.push(`生命低于 40% 时造成伤害 +${Math.round(hooks.lowHpFuryPct * 100)}%`);
  }
  if (hooks.energySurgeRegen > 0) {
    rows.push(`法力低于 30% 时每回合额外恢复 ${hooks.energySurgeRegen} 点法力`);
  }
  return rows;
}

/**
 * 迷宫亲和福利：按迷宫标签匹配后生效的"定性"效果（不提供任何属性数值）。
 * - extra-loot：每清一个房间额外一次战利品判定
 * - swift：往返耗时可缩短
 * - field-rest：房间之间休整更充分
 */
export const AFFINITY_PERKS = ["extra-loot", "swift", "field-rest"] as const;
export const affinityPerkSchema = z.enum(AFFINITY_PERKS);
export type AffinityPerk = z.infer<typeof affinityPerkSchema>;

export const AFFINITY_PERK_LABELS: Record<AffinityPerk, string> = {
  "extra-loot": "熟路搜刮",
  swift: "熟路往返",
  "field-rest": "就地扎营",
};

export const AFFINITY_PERK_TEXTS: Record<AffinityPerk, string> = {
  "extra-loot": "清理房间战利品增加",
  swift: "队伍可使用更多路线",
  "field-rest": "清理房间后充分休息",
};

/** 该过往的亲和是否匹配迷宫标签；匹配则返回生效的福利。 */
export function affinityPerkFor(race: Race, dungeonTags: string[]): AffinityPerk | null {
  const affinity = race.dungeonAffinity;
  if (!affinity) return null;
  return affinity.tags.some((tag) => dungeonTags.includes(tag)) ? affinity.perk : null;
}

export const raceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "id 只能包含小写字母、数字和连字符"),
    name: z.string().min(1),
    subtitle: z.string().min(1),
    description: z.string().min(1),
    /** 过往决定的初始基础数值；等级成长与被动在引擎中叠加。 */
    base: baseStatsSchema,
    passive: passiveSchema.optional(),
    /** 该过往独占的特质技能；自动生效，不可升级。 */
    traitSkillId: z.string().min(1),
    /** 迷宫亲和：每个角色只有一种类型，最多匹配两个标签。 */
    dungeonAffinity: z
      .object({
        tags: z.array(z.string().min(1)).min(1).max(2),
        perk: affinityPerkSchema,
        label: z.string().optional(),
      })
      .strict()
      .optional(),
    trait: z.object({ name: z.string(), description: z.string() }).strict(),
  })
  .strict();

export const targetSchema = z.enum(["enemy", "all-enemies", "ally", "all-allies", "self"]);
export type TargetType = z.infer<typeof targetSchema>;

/**
 * 战斗中的主动效果（技能组件）。所有幅度都由等级推导：
 * - mod/dot/hot/shield：幅度 = base + perLevel × 施放者等级，再乘技能等级倍率。
 * - mod 正负号即强化/弱化；施加方向由技能 kind 决定（attack 技能上正修正给自己、
 *   负修正给目标；heal/buff 技能全部给目标）。
 * - dot/hot/shield 在施加时快照为固定值，tick 不再重算。
 */
export const effectSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("mod"),
      kind: modifierKindSchema,
      base: z.number(),
      perLevel: z.number().default(0),
      duration: z.number().int().min(1).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal("dot"),
      base: z.number().min(0),
      perLevel: z.number().min(0).default(0),
      duration: z.number().int().min(1).max(10),
      damageType: damageTypeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("hot"),
      base: z.number().min(0),
      perLevel: z.number().min(0).default(0),
      duration: z.number().int().min(1).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal("stun"),
      chance: z.number().min(0).max(1),
      duration: z.number().int().min(1).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("shield"),
      base: z.number().min(0),
      perLevel: z.number().min(0).default(0),
      duration: z.number().int().min(1).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal("silence"),
      chance: z.number().min(0).max(1),
      duration: z.number().int().min(1).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("taunt"),
      duration: z.number().int().min(1).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("reflect"),
      percent: z.number().min(0).max(2),
      duration: z.number().int().min(1).max(10),
    })
    .strict(),
]);

/** 装备特效触发时机。 */
export const ITEM_EFFECT_TRIGGERS = ["onHit", "onCrit", "onHurt", "onKill"] as const;
export const itemEffectTriggerSchema = z.enum(ITEM_EFFECT_TRIGGERS);
export type ItemEffectTrigger = z.infer<typeof itemEffectTriggerSchema>;

export const ITEM_EFFECT_TRIGGER_LABELS: Record<ItemEffectTrigger, string> = {
  onHit: "命中时",
  onCrit: "暴击时",
  onHurt: "受击时",
  onKill: "击杀时",
};

/** 装备特效的触发结果；数值为固定值，不吃强化与属性。 */
export const itemEffectPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("dot"),
      base: z.number().min(0),
      duration: z.number().int().min(1).max(5),
      damageType: damageTypeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("mod"),
      kind: modifierKindSchema,
      amount: z.number(),
      duration: z.number().int().min(1).max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal("shield"),
      base: z.number().min(0),
      duration: z.number().int().min(1).max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal("reflect"),
      percent: z.number().min(0).max(2),
      duration: z.number().int().min(1).max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal("energy"),
      amount: z.number().int().min(1),
    })
    .strict(),
]);
export type ItemEffectPayload = z.infer<typeof itemEffectPayloadSchema>;

/**
 * 装备特效词条。
 * target = self：效果作用于装备持有者；target = victim：作用于对方
 * （onHit/onCrit 时是被攻击者，onHurt 时是攻击者，onKill 时无意义）。
 */
export const itemEffectSchema = z
  .object({
    trigger: itemEffectTriggerSchema,
    chance: z.number().min(0).max(1),
    target: z.enum(["self", "victim"]).default("victim"),
    payload: itemEffectPayloadSchema,
  })
  .strict();
export type ItemEffect = z.infer<typeof itemEffectSchema>;

/**
 * 技能树被动节点的载荷。旧职业加成全部落在这里：
 * 生命/法力百分比、基础数值、常驻修正、钩子、武器熟练。
 * 多个被动可以同时学习，效果相加；钩子由 mergeHooks 处理上限。
 */
export const skillPassiveSchema = z
  .object({
    hpPct: z.number().min(-1).max(2).default(0),
    manaPct: z.number().min(-1).max(2).default(0),
    base: partialBaseStatsSchema.default({}),
    modifiers: z.array(modifierSchema).default([]),
    hooks: hooksSchema.default({}),
    weaponProficiencies: z.array(weaponTypeSchema).default([]),
  })
  .strict();
export type SkillPassive = z.infer<typeof skillPassiveSchema>;

/** 特质触发：攻击后排时的暴击加成，以及命中后排后的可叠加闪避/暴击 buff。 */
export const traitBacklineHunterSchema = z
  .object({
    critBonus: z.number().min(0).max(100),
    evasionBonus: z.number().min(0).max(100),
    /** 效果持续回合数；引擎按回合开始结算。 */
    duration: z.number().int().min(1).max(5),
    maxStacks: z.number().int().min(1).max(10).default(5),
  })
  .strict();
export type TraitBacklineHunter = z.infer<typeof traitBacklineHunterSchema>;

export const traitPayloadSchema = z
  .object({
    modifiers: z.array(modifierSchema).default([]),
    hooks: hooksSchema.default({}),
    backlineHunter: traitBacklineHunterSchema.optional(),
  })
  .strict();
export type TraitPayload = z.infer<typeof traitPayloadSchema>;

export const skillSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    kind: z.enum(["attack", "heal", "buff", "passive", "trait"]),
    category: z.enum(["basic", "secondary", "foreign", "class"]).default("basic"),
    maxLevel: z.number().int().min(1).max(50).default(20),
    range: z.enum(["melee", "ranged", "magic"]).optional(),
    weaponTypes: z.array(weaponTypeSchema).min(1).optional(),
    damageType: damageTypeSchema.optional(),
    /** 每英雄等级提供的伤害/治疗基础值。 */
    levelScale: z.number().min(0).max(10).default(0),
    /** 武器伤害倍率；0 表示不吃武器伤害（法术/治疗）。 */
    weaponScale: z.number().min(0).max(3).default(0),
    power: z.number().min(0).default(0),
    /** 技能基础暴击率（百分点）；攻击技能默认 5，其他默认 0。 */
    baseCritRate: z.number().min(0).max(100).optional(),
    /** 技能基础命中率（百分比）；攻击技能默认 90，其他默认 100。 */
    baseHitRate: z.number().min(0).max(100).optional(),
    /** 异常效率：伤害转化为异常值的倍率；默认 2，UI 只在非 2 时显示。 */
    ailmentEfficiency: z.number().min(0).max(20).optional(),
    /** 处决：目标生命比例低于该值时增伤（0–1）。 */
    executeThreshold: z.number().min(0).max(1).optional(),
    /** 处决增伤比例（小数）。 */
    executeBonusPct: z.number().min(0).max(5).optional(),
    /** 异常协同：目标带有本技能伤害对应的异常时增伤（小数）。 */
    ailmentBonusPct: z.number().min(0).max(5).optional(),
    cooldown: z.number().int().min(0).max(20).default(0),
    energyCost: z.number().int().min(0).max(100).default(0),
    target: targetSchema.default("self"),
    effects: z.array(effectSchema).default([]),
    /** 被动节点的载荷；kind = passive 时必填。 */
    passive: skillPassiveSchema.optional(),
    /** 特质载荷；kind = trait 时必填，特质不可升级。 */
    trait: traitPayloadSchema.optional(),
    /** 技能可被用于哪些战斗阶段；不填时 buff 默认回合前+主回合，其余主回合。 */
    phases: z.array(skillPhaseSchema).min(1).optional(),
    logVerb: z.string().optional(),
  })
  .strict()
  .superRefine((skill, ctx) => {
    if (skill.kind === "passive" && !skill.passive) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "被动技能缺少 passive 载荷" });
    }
    if (skill.kind !== "passive" && skill.passive) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "非被动技能不应配置 passive 载荷" });
    }
    if (skill.kind === "trait") {
      if (!skill.trait) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "特质技能缺少 trait 载荷" });
      }
      if (skill.maxLevel !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "特质技能不能升级，maxLevel 必须为 1" });
      }
    }
    if (skill.kind !== "trait" && skill.trait) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "非特质技能不应配置 trait 载荷" });
    }
  });

/** 武器路径：创建页的八种武器、起始装备与树根。 */
export const weaponPathSchema = z
  .object({
    id: weaponTypeSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    icon: z.string().optional(),
    startingItemIds: z.array(z.string().min(1)).min(1),
    rootSkillId: z.string().min(1),
  })
  .strict();
export type WeaponPath = z.infer<typeof weaponPathSchema>;

export const SKILL_TREE_NODE_ROLES = [
  "root",
  "stem",
  "passive",
  "mechanic",
  "terminal",
  "connection",
] as const;
export const skillTreeNodeRoleSchema = z.enum(SKILL_TREE_NODE_ROLES);

/**
 * 技能树节点。每把武器是一把音叉：
 * root → stem×2 → passive×2（分叉点）→ mechanic×2 → terminal×2 → connection×2。
 * requires / requiresAny 只描述自然生长方向；实际解锁按无向图判断：
 * 只要与任一已解锁节点相连即可解锁。connection 的 links 指向相邻武器的 terminal，
 * 因此从连接点进入邻树末端后，可以沿 mechanic → passive → stem → root 向内走。
 */
export const skillTreeNodeSchema = z
  .object({
    id: z.string().min(1),
    tier: z.number().int().min(0).max(5),
    cost: z.number().int().min(0).max(10),
    minLevel: z.number().int().min(1).max(40).default(1),
    /** 布局行：0 = 音叉柄，-1 = 左臂，1 = 右臂。 */
    row: z.number().int().min(-1).max(1).default(0),
    requires: z.array(z.string()).default([]),
    requiresAny: z.array(z.string()).default([]),
    /** 无向跨树连接：目标节点 id（必须是相邻武器的末端节点）。 */
    links: z.array(z.string()).default([]),
    role: skillTreeNodeRoleSchema.optional(),
  })
  .strict();
export type SkillTreeNode = z.infer<typeof skillTreeNodeSchema>;

export const skillTreeSchema = z
  .object({
    weapons: z.record(weaponTypeSchema, z.array(skillTreeNodeSchema).min(1)),
  })
  .strict();
export type SkillTree = z.infer<typeof skillTreeSchema>;

export const itemTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    kind: itemKindSchema.default("equipment"),
    slot: itemSlotSchema,
    rarity: raritySchema,
    level: z.number().int().min(1).max(99),
    value: z.number().int().min(0),
    /** 静态修正词条；装备不再直接提供属性，只提供修正与特效。 */
    modifiers: z.array(modifierSchema).default([]),
    /** 触发型特效词条。 */
    effects: z.array(itemEffectSchema).default([]),
    armor: z.number().int().min(0).optional(),
    weaponDamage: z.number().int().min(0).optional(),
    damageType: damageTypeSchema.optional(),
    weaponType: weaponTypeSchema.optional(),
  })
  .strict();

/**
 * 词缀分两类：
 * - modifier：携带 1-N 条修正，掉落时按 min–max 掷点。
 * - effect：携带一条固定特效，仅稀有及以上品质掉落。
 */
export const affixSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("modifier"),
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(1),
      modifiers: z
        .array(
          z
            .object({
              kind: modifierKindSchema,
              min: z.number(),
              max: z.number(),
            })
            .strict(),
        )
        .min(1),
      slots: z.array(slotSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("effect"),
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(1),
      effect: itemEffectSchema,
      slots: z.array(slotSchema).min(1),
    })
    .strict(),
]);
export type Affix = z.infer<typeof affixSchema>;
export type ModifierAffix = Extract<Affix, { kind: "modifier" }>;
export type EffectAffix = Extract<Affix, { kind: "effect" }>;

export const monsterSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    subtitle: z.string().optional(),
    description: z.string().min(1),
    level: z.number().int().min(1).max(99),
    /** 1 级基础数值；等级成长在引擎中统一叠加。 */
    base: baseStatsSchema,
    hpMultiplier: z.number().min(0.2).max(10).default(1),
    damageMultiplier: z.number().min(0.2).max(5).default(1),
    resist: resistanceSchema.optional(),
    /** 怪物额外的异常效率（用于空庭等高频异常场景）。 */
    ailmentEfficiency: z.number().min(0).max(20).optional(),
    skillIds: z.array(z.string()).min(1),
    xp: z.number().int().min(1),
    gold: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    lootTableId: z.string().optional(),
  })
  .strict();

export const lootTableSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    chance: z.number().min(0).max(1).default(1),
    rolls: z.number().int().min(1).max(5).default(1),
    entries: z
      .array(
        z
          .object({
            templateId: z.string(),
            weight: z.number().min(0.01),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** 迷宫房间类型：入口、战斗、宝箱、boss。 */
export const ROOM_KINDS = ["start", "combat", "treasure", "boss"] as const;
export const roomKindSchema = z.enum(ROOM_KINDS);
export type RoomKind = z.infer<typeof roomKindSchema>;

export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  start: "入口",
  combat: "战斗",
  treasure: "宝箱",
  boss: "首领",
};

/**
 * 迷宫房间。所有房间信息都会展示给玩家，供其规划路线。
 * start / treasure 房没有遭遇；combat / boss 房必须有怪物编成。
 */
export const dungeonRoomSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().optional(),
    kind: roomKindSchema,
    /** 地图坐标（用于前端展示，固定布局）。 */
    x: z.number().int().min(0).max(12),
    y: z.number().int().min(0).max(12),
    monsters: z
      .array(z.object({ monsterId: z.string(), count: z.number().int().min(1).max(12) }).strict())
      .default([]),
    /** 进入该房间所需时间；缺省由迷宫 roomSeconds 提供。 */
    durationSeconds: z.number().int().min(5).max(3600).optional(),
    /** 该房间的怪物强度参考（展示与调平用）。 */
    monsterPower: z.number().int().min(0).default(0),
    /** 清空房间后的额外掉落表（战斗房可携带受守卫的搜刮表）。 */
    lootTableId: z.string().optional(),
    /** 清空房间后的额外金币区间。 */
    gold: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  })
  .strict();
export type DungeonRoom = z.infer<typeof dungeonRoomSchema>;

export const dungeonCompletionRewardSchema = z
  .object({
    gold: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    ep: z.number().int().min(0),
    fame: z.number().int().min(0).default(0),
    lootTableId: z.string().optional(),
  })
  .strict();
export type DungeonCompletionReward = z.infer<typeof dungeonCompletionRewardSchema>;

export const dungeonSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    subtitle: z.string().min(1),
    description: z.string().min(1),
    kind: z.enum(["standard", "appointment"]).default("standard"),
    schedule: z
      .object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(1).max(24),
        repeatDays: z.number().int().min(1).max(30),
      })
      .strict()
      .optional(),
    /** 迷宫房间；必须恰好有一个 start、一个 boss、一个 material 房间。 */
    rooms: z.array(dungeonRoomSchema).min(3).max(24),
    /** 无向连接：[roomA, roomB]。 */
    edges: z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(2),
    /** 进阶副本系列 id；基础副本为空。 */
    seriesId: z.string().regex(/^[a-z0-9-]+$/).optional(),
    /** 系列内深度：0 为基础层；个人迷宫生成区可无限递增。 */
    depth: z.number().int().min(0).optional(),
    /** 进阶副本的统一准入等级。 */
    requiredLevel: z.number().int().min(1).max(40).optional(),
    /** 打通 boss 房的通关奖励（原 boss 线路奖励）。 */
    completionReward: dungeonCompletionRewardSchema,
    /** 亲和标签（过往的迷宫亲和按标签匹配）。 */
    tags: z.array(z.string().min(1)).min(1).default([]),
    /** 默认每间房的探索耗时（秒）；房间可单独覆盖。 */
    roomSeconds: z.number().int().min(5).max(3600).default(45),
    /** 该迷宫允许携带的固定 NPC 支援 id；空数组表示不提供。 */
    npcAssistIds: z.array(z.string().min(1)).default([]),
    theme: z.string().optional(),
  })
  .strict();

export const contentPackSchema = z
  .object({
    formatVersion: z.literal(1),
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string(),
    lore: z.string().default(""),
    races: z.array(raceSchema).min(1),
    weapons: z.array(weaponPathSchema).min(1),
    skillTrees: skillTreeSchema,
    skills: z.array(skillSchema).min(1),
    items: z.array(itemTemplateSchema).min(1),
    affixes: z.array(affixSchema).min(1),
    monsters: z.array(monsterSchema).min(1),
    lootTables: z.array(lootTableSchema).min(1),
    npcs: z.array(npcSchema).default([]),
    titles: z.array(titleSchema).default([]),
    quests: z.array(questSchema).default([]),
    dungeons: z.array(dungeonSchema).min(1),
  })
  .strict();

export type Race = z.infer<typeof raceSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type ItemTemplate = z.infer<typeof itemTemplateSchema>;
export type Monster = z.infer<typeof monsterSchema>;
export type LootTable = z.infer<typeof lootTableSchema>;
export type Dungeon = z.infer<typeof dungeonSchema>;
export type ContentPack = z.infer<typeof contentPackSchema>;

/**
 * 熟路往返：在原有通路上，额外连接网格上相邻但原本不相连的房间。
 * 只增加“临近房间”的通路，不改变房间本身。
 */
export function extraRoutesForDungeon(dungeon: Dungeon): Array<[string, string]> {
  const existing = new Set(
    dungeon.edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)),
  );
  const extra: Array<[string, string]> = [];
  for (let i = 0; i < dungeon.rooms.length; i += 1) {
    for (let j = i + 1; j < dungeon.rooms.length; j += 1) {
      const a = dungeon.rooms[i]!;
      const b = dungeon.rooms[j]!;
      const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      // “临近”按两格以内处理：现有迷宫的正交/对角邻接已全部连通，
      // 额外通路需要跨一格，才能真正增加路线选择。
      if (distance === 0 || distance > 2) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (existing.has(key)) continue;
      existing.add(key);
      extra.push([a.id, b.id]);
    }
  }
  return extra;
}

export function withExtraRoutes(dungeon: Dungeon): Dungeon {
  return { ...dungeon, edges: [...dungeon.edges, ...extraRoutesForDungeon(dungeon)] };
}

/** 判断槽位是否属于可穿戴装备。 */
export function isEquipmentSlot(slot: ItemSlot): slot is Slot {
  return slot === "weapon" || slot === "armor" || slot === "trinket";
}

/** 技能实际可用的战斗阶段；被动不进入战斗行动列表。 */
export function skillPhases(skill: Skill): SkillPhase[] {
  if (skill.kind === "passive" || skill.kind === "trait") return [];
  if (skill.phases && skill.phases.length > 0) return skill.phases;
  return skill.kind === "buff" ? ["pre", "main"] : ["main"];
}

/** 英雄能否使用某件装备：武器需要已解锁的武器熟练，护甲/饰品不限。 */
export function heroCanUseItem(
  proficiencies: readonly WeaponType[],
  item: ItemTemplate,
): boolean {
  if (item.slot === "weapon") {
    return Boolean(item.weaponType && proficiencies.includes(item.weaponType));
  }
  return true;
}

/** 技能是否需要当前武器类型。没有 weaponTypes 的技能视为通用技能。 */
export function skillUsableWithWeapon(
  skill: Skill,
  weaponType: WeaponType | null,
): boolean {
  if (!skill.weaponTypes || skill.weaponTypes.length === 0) return true;
  return Boolean(weaponType && skill.weaponTypes.includes(weaponType));
}

/** 某把武器的技能树节点。 */
export function skillTreeNodesForWeapon(
  pack: ContentPack,
  weaponType: WeaponType,
): SkillTreeNode[] {
  return pack.skillTrees.weapons[weaponType] ?? [];
}

/** 所有玩家可获得技能树节点的 id（去重，不含怪物专用技能）。 */
export function allSkillTreeSkillIds(pack: ContentPack): string[] {
  const ids = new Set<string>();
  for (const nodes of Object.values(pack.skillTrees.weapons)) {
    for (const node of nodes) ids.add(node.id);
  }
  return [...ids];
}

/** 单个技能树节点的定义（跨武器去重，优先返回第一个）。 */
export function findSkillTreeNode(
  pack: ContentPack,
  skillId: string,
): { weaponType: WeaponType; node: SkillTreeNode } | null {
  for (const weaponType of WEAPON_TYPES) {
    const node = (pack.skillTrees.weapons[weaponType] ?? []).find((row) => row.id === skillId);
    if (node) return { weaponType, node };
  }
  return null;
}

/** 武器路径按 id 查找。 */
export function weaponPath(pack: ContentPack, weaponType: WeaponType): WeaponPath | undefined {
  return pack.weapons.find((row) => row.id === weaponType);
}

/** 技能点总量：1 级 0 点，之后每级 +1。 */
export function skillPointsTotal(level: number): number {
  return Math.max(0, Math.floor(level) - 1);
}

/** 已解锁节点的技能点花费（按技能 id 去重）。起始武器根免费，不扣点。 */
export function skillPointsSpent(
  pack: ContentPack,
  unlocked: ReadonlySet<string>,
  startingWeapon?: WeaponType,
): number {
  const costs = new Map<string, number>();
  for (const nodes of Object.values(pack.skillTrees.weapons)) {
    for (const node of nodes) costs.set(node.id, Math.max(costs.get(node.id) ?? 0, node.cost));
  }
  const freeRootId = startingWeapon
    ? (pack.skillTrees.weapons[startingWeapon] ?? []).find(
        (node) => node.tier === 0 || node.role === "root",
      )?.id
    : undefined;
  let spent = 0;
  for (const id of unlocked) {
    if (id === freeRootId) continue;
    spent += costs.get(id) ?? 0;
  }
  return spent;
}

/** 全部玩家技能树节点（8 把武器，按 id 去重）。 */
export function allSkillTreeNodes(pack: ContentPack): SkillTreeNode[] {
  const rows: SkillTreeNode[] = [];
  const seen = new Set<string>();
  const push = (node: SkillTreeNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    rows.push(node);
  };
  for (const nodes of Object.values(pack.skillTrees.weapons)) {
    for (const node of nodes) push(node);
  }
  return rows;
}

/**
 * 技能树无向邻接表。
 * 自然前置（requires/requiresAny）与跨树连接（links）都视为无向边，
 * 因此从连接点进入邻树末端后，可以继续向内解锁。
 */
export function skillTreeAdjacency(pack: ContentPack): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    const left = graph.get(a) ?? new Set<string>();
    left.add(b);
    graph.set(a, left);
    const right = graph.get(b) ?? new Set<string>();
    right.add(a);
    graph.set(b, right);
  };
  for (const node of allSkillTreeNodes(pack)) {
    if (!graph.has(node.id)) graph.set(node.id, new Set());
    for (const parent of [...node.requires, ...node.requiresAny]) add(node.id, parent);
    for (const target of node.links) add(node.id, target);
  }
  return graph;
}

/** 该节点是否与任一已解锁节点相连（无向）。 */
export function skillNodeAdjacentToUnlocked(
  pack: ContentPack,
  unlocked: ReadonlySet<string>,
  skillId: string,
): boolean {
  const neighbors = skillTreeAdjacency(pack).get(skillId);
  if (!neighbors) return false;
  for (const id of neighbors) {
    if (unlocked.has(id)) return true;
  }
  return false;
}

/** 已解锁的武器根：所选武器在创建时已解锁，其他武器根需从连接点向内走解锁。 */
export function unlockedWeaponRoots(
  pack: ContentPack,
  unlocked: ReadonlySet<string>,
): Set<WeaponType> {
  const roots = new Set<WeaponType>();
  for (const weaponType of WEAPON_TYPES) {
    const root = (pack.skillTrees.weapons[weaponType] ?? []).find(
      (node) => node.tier === 0 || node.role === "root",
    );
    if (root && unlocked.has(root.id)) roots.add(weaponType);
  }
  return roots;
}

/** 技能树节点的等级门槛与前置检查结果。 */
export interface SkillNodeLock {
  canUnlock: boolean;
  reason?: string;
}

export function checkSkillNodeUnlock(
  pack: ContentPack,
  unlocked: ReadonlySet<string>,
  skillId: string,
  heroLevel: number,
  pointsAvailable: number,
): SkillNodeLock {
  if (unlocked.has(skillId)) return { canUnlock: false, reason: "已解锁" };
  const found = findSkillTreeNode(pack, skillId);
  if (!found) return { canUnlock: false, reason: "该技能不在技能树中" };
  const { node } = found;
  if (heroLevel < node.minLevel) {
    return { canUnlock: false, reason: `需要英雄等级 ${node.minLevel}` };
  }
  if (pointsAvailable < node.cost) {
    return { canUnlock: false, reason: `技能点不足（需要 ${node.cost}）` };
  }
  if (!skillNodeAdjacentToUnlocked(pack, unlocked, skillId)) {
    return { canUnlock: false, reason: "需要先解锁相邻节点" };
  }
  return { canUnlock: true };
}

/** 跨文件引用与唯一性校验，返回人类可读的错误列表。 */
export function validateContent(pack: ContentPack): string[] {
  const errors: string[] = [];
  const unique = <T>(label: string, rows: T[], key: (row: T) => string) => {
    const seen = new Set<string>();
    for (const row of rows) {
      const id = key(row);
      if (seen.has(id)) errors.push(`${label} 重复 id: ${id}`);
      seen.add(id);
    }
  };

  unique("过往", pack.races, (r) => r.id);
  unique("武器", pack.weapons, (w) => w.id);
  unique("技能", pack.skills, (s) => s.id);
  unique("物品", pack.items, (i) => i.id);
  unique("词缀", pack.affixes, (a) => a.id);
  unique("怪物", pack.monsters, (m) => m.id);
  unique("掉落表", pack.lootTables, (l) => l.id);
  unique("NPC", pack.npcs, (n) => n.id);
  unique("称号", pack.titles, (t) => t.id);
  unique("任务", pack.quests, (q) => q.id);
  unique("迷宫", pack.dungeons, (d) => d.id);

  const skillIds = new Set(pack.skills.map((s) => s.id));
  const skillById = new Map(pack.skills.map((s) => [s.id, s]));
  const raceIds = new Set(pack.races.map((r) => r.id));
  const itemIds = new Set(pack.items.map((i) => i.id));
  const itemById = new Map(pack.items.map((i) => [i.id, i]));
  const monsterIds = new Set(pack.monsters.map((m) => m.id));
  const lootIds = new Set(pack.lootTables.map((l) => l.id));
  const npcIds = new Set(pack.npcs.map((n) => n.id));
  const titleIds = new Set(pack.titles.map((t) => t.id));
  const questIds = new Set(pack.quests.map((q) => q.id));
  const dungeonIds = new Set(pack.dungeons.map((d) => d.id));

  // 八种武器必须各有路径；树根、起始物品、初始武器必须闭合。
  const weaponPathIds = new Set(pack.weapons.map((w) => w.id));
  for (const weapon of WEAPON_TYPES) {
    if (!weaponPathIds.has(weapon)) errors.push(`缺少武器路径 ${weapon}`);
  }
  for (const path of pack.weapons) {
    const nodes = pack.skillTrees.weapons[path.id] ?? [];
    const roots = nodes.filter((node) => node.tier === 0);
    const root = roots[0];
    if (!root || roots.length !== 1) {
      errors.push(`武器 ${path.id} 的技能树必须恰好 1 个根节点（当前 ${roots.length}）`);
    } else if (root.id !== path.rootSkillId) {
      errors.push(`武器 ${path.id} 的根技能 ${path.rootSkillId} 与树根 ${root.id} 不一致`);
    }
    const rootSkill = skillById.get(path.rootSkillId);
    if (!rootSkill) {
      errors.push(`武器 ${path.id} 引用了不存在的根技能 ${path.rootSkillId}`);
    } else if (rootSkill.kind === "passive") {
      errors.push(`武器 ${path.id} 的根技能不能是被动`);
    }
    for (const id of path.startingItemIds) {
      if (!itemIds.has(id)) errors.push(`武器 ${path.id} 引用了不存在的初始物品 ${id}`);
    }
    const startingWeapon = path.startingItemIds
      .map((id) => itemById.get(id))
      .find((item) => item?.slot === "weapon");
    if (!startingWeapon) {
      errors.push(`武器 ${path.id} 没有初始武器`);
    } else if (startingWeapon.weaponType !== path.id) {
      errors.push(
        `武器 ${path.id} 的初始武器 ${startingWeapon.id} 类型是 ${startingWeapon.weaponType ?? "无"}`,
      );
    }
  }

  // 技能树节点：全局唯一、前置存在、音叉结构、连接环合法。
  const globalNodeIds = new Set<string>();
  const globalNodeById = new Map<string, { weaponType: WeaponType; node: SkillTreeNode }>();
  for (const weapon of WEAPON_TYPES) {
    for (const node of pack.skillTrees.weapons[weapon] ?? []) {
      if (globalNodeIds.has(node.id)) {
        errors.push(`技能树节点 ${node.id} 在多把武器中重复；节点 id 必须全局唯一`);
      }
      globalNodeIds.add(node.id);
      globalNodeById.set(node.id, { weaponType: weapon, node });
    }
  }

  const validateLocalPrereqs = (
    label: string,
    nodes: SkillTreeNode[],
    localIds: Set<string>,
  ) => {
    for (const node of nodes) {
      if (!skillIds.has(node.id)) errors.push(`${label} 技能树引用了不存在的技能 ${node.id}`);
      for (const id of [...node.requires, ...node.requiresAny]) {
        if (!localIds.has(id)) {
          errors.push(`${label} 技能树节点 ${node.id} 的前置 ${id} 不在同一棵树中`);
        }
      }
    }
  };

  const validateTuningFork = (weapon: WeaponType, nodes: SkillTreeNode[]) => {
    const label = WEAPON_TYPE_LABELS[weapon];
    const byRole = (role: SkillTreeNode["role"]) => nodes.filter((node) => node.role === role);
    const roots = byRole("root");
    const stems = byRole("stem");
    const passives = byRole("passive");
    const mechanics = byRole("mechanic");
    const terminals = byRole("terminal");
    const connections = byRole("connection");
    if (roots.length !== 1) errors.push(`${label} 音叉树必须恰好 1 个根节点（当前 ${roots.length}）`);
    if (stems.length !== 2) errors.push(`${label} 音叉树必须恰好 2 个柄技能（当前 ${stems.length}）`);
    if (passives.length !== 2) errors.push(`${label} 音叉树必须恰好 2 个被动分叉点（当前 ${passives.length}）`);
    if (mechanics.length !== 2) errors.push(`${label} 音叉树必须恰好 2 个机制技能（当前 ${mechanics.length}）`);
    if (terminals.length !== 2) errors.push(`${label} 音叉树必须恰好 2 个末端技能（当前 ${terminals.length}）`);
    if (connections.length !== 2) errors.push(`${label} 音叉树必须恰好 2 个连接点（当前 ${connections.length}）`);
    if (nodes.length !== 11) errors.push(`${label} 音叉树应为 11 个节点（当前 ${nodes.length}）`);

    for (const node of nodes) {
      const expectedTier: Record<string, number> = {
        root: 0,
        stem: 1,
        passive: 2,
        mechanic: 3,
        terminal: 4,
        connection: 5,
      };
      const role = node.role ?? "";
      if (expectedTier[role] !== node.tier) {
        errors.push(`${label} 节点 ${node.id} 的 role=${role || "未设置"} 与 tier=${node.tier} 不匹配`);
      }
      if (node.id && skillById.get(node.id)?.kind === "passive" && node.role !== "passive") {
        errors.push(`${label} 非被动节点 ${node.id} 使用了被动技能`);
      }
      if (node.role === "passive" && skillById.get(node.id)?.kind !== "passive") {
        errors.push(`${label} 被动节点 ${node.id} 必须是 kind=passive 技能`);
      }
      if (node.role === "root" && node.cost > 1) errors.push(`${label} 根节点 ${node.id} 费用不能超过 1`);
      if (node.role === "stem" && node.cost !== 1) errors.push(`${label} 柄技能 ${node.id} 费用应为 1`);
      if (node.role === "passive" && node.cost !== 2) errors.push(`${label} 被动 ${node.id} 费用应为 2`);
      if ((node.role === "mechanic" || node.role === "terminal") && node.cost !== 3) {
        errors.push(`${label} ${node.role} ${node.id} 费用应为 3`);
      }
      if (node.role === "connection" && node.cost !== 2) {
        errors.push(`${label} 连接点 ${node.id} 费用应为 2`);
      }
      if (node.role === "root" && node.requires.length + node.requiresAny.length > 0) {
        errors.push(`${label} 根节点 ${node.id} 不应有前置`);
      }
      if (node.role !== "connection" && node.links.length > 0) {
        errors.push(`${label} 非连接点 ${node.id} 不应配置 links`);
      }
    }

    if (roots.length === 1 && stems.length === 2 && passives.length === 2) {
      const root = roots[0]!;
      const stem1 = stems.find((node) => node.requires.includes(root.id));
      const stem2 = stem1 ? stems.find((node) => node.requires.includes(stem1.id)) : undefined;
      if (!stem1) errors.push(`${label} 缺少直接连接根节点的柄技能`);
      if (!stem2) errors.push(`${label} 缺少第二段柄技能`);
      if (stem1 && stem2) {
        if (!(stem1.minLevel < stem2.minLevel)) {
          errors.push(`${label} 两段柄技能的等级门槛应为递增`);
        }
        for (const passive of passives) {
          if (!passive.requires.includes(stem2.id)) {
            errors.push(`${label} 被动 ${passive.id} 必须从第二段柄技能分叉`);
          }
        }
        if (!passives.some((node) => node.minLevel === 8)) {
          errors.push(`${label} 第一个被动需要在 8 级解锁`);
        }
        if (!passives.some((node) => node.minLevel === 12)) {
          errors.push(`${label} 第二个被动需要在 12 级解锁`);
        }
        const left = passives.filter((node) => node.row === -1);
        const right = passives.filter((node) => node.row === 1);
        if (left.length !== 1 || right.length !== 1) {
          errors.push(`${label} 两个被动应分别位于左臂(row=-1)与右臂(row=1)`);
        }
      }
    }

    // 一条臂：passive → mechanic → terminal → connection，row 必须一致。
    for (const passive of passives) {
      const mechanic = mechanics.find((node) => node.requires.includes(passive.id));
      const terminal = mechanic
        ? terminals.find((node) => node.requires.includes(mechanic.id))
        : undefined;
      const connection = terminal
        ? connections.find((node) => node.requires.includes(terminal.id))
        : undefined;
      if (!mechanic) {
        errors.push(`${label} 被动 ${passive.id} 后缺少机制技能`);
        continue;
      }
      if (!terminal) {
        errors.push(`${label} 机制 ${mechanic.id} 后缺少末端技能`);
        continue;
      }
      if (!connection) errors.push(`${label} 末端 ${terminal.id} 后缺少连接点`);
      if (mechanic.row !== passive.row || terminal.row !== passive.row ||
          (connection && connection.row !== passive.row)) {
        errors.push(`${label} ${passive.id} 所在的音叉臂 row 不一致`);
      }
      if (mechanic.minLevel < 16) errors.push(`${label} 机制 ${mechanic.id} 的等级门槛应不低于 16`);
      if (terminal.minLevel < 18) errors.push(`${label} 末端 ${terminal.id} 的等级门槛应不低于 18`);
      if (connection && connection.minLevel < 20) {
        errors.push(`${label} 连接点 ${connection.id} 的等级门槛应不低于 20`);
      }
      if (connection && connection.links.length !== 1) {
        errors.push(`${label} 连接点 ${connection.id} 应恰好连接 1 个相邻末端`);
      }
    }
  };

  const ringIndex = new Map(WEAPON_TYPES.map((weapon, index) => [weapon, index]));
  for (const weapon of WEAPON_TYPES) {
    const nodes = pack.skillTrees.weapons[weapon] ?? [];
    const localIds = new Set(nodes.map((node) => node.id));
    validateLocalPrereqs(WEAPON_TYPE_LABELS[weapon], nodes, localIds);
    validateTuningFork(weapon, nodes);
  }

  // 连接点必须指向环上相邻武器的近侧末端；每个末端恰好被连接一次。
  const linkedTerminals = new Set<string>();
  for (const weapon of WEAPON_TYPES) {
    const weaponIndex = ringIndex.get(weapon) ?? 0;
    const nodes = pack.skillTrees.weapons[weapon] ?? [];
    for (const node of nodes.filter((row) => row.role === "connection")) {
      for (const targetId of node.links) {
        const target = globalNodeById.get(targetId);
        if (!target) {
          errors.push(`${WEAPON_TYPE_LABELS[weapon]} 连接点 ${node.id} 指向不存在的节点 ${targetId}`);
          continue;
        }
        if (target.node.role !== "terminal") {
          errors.push(`${WEAPON_TYPE_LABELS[weapon]} 连接点 ${node.id} 必须指向末端技能节点`);
        }
        if (target.weaponType === weapon) {
          errors.push(`${WEAPON_TYPE_LABELS[weapon]} 连接点 ${node.id} 不能连接本武器树`);
        }
        if (target.node.row !== -node.row) {
          errors.push(`${WEAPON_TYPE_LABELS[weapon]} 连接点 ${node.id} 应连接对侧(row=${-node.row})的末端`);
        }
        const expectedIndex =
          node.row === -1
            ? (weaponIndex + WEAPON_TYPES.length - 1) % WEAPON_TYPES.length
            : (weaponIndex + 1) % WEAPON_TYPES.length;
        const expectedWeapon = WEAPON_TYPES[expectedIndex] ?? WEAPON_TYPES[0];
        if (target.weaponType !== expectedWeapon) {
          errors.push(
            `${WEAPON_TYPE_LABELS[weapon]} 连接点 ${node.id} 应连接相邻武器 ${WEAPON_TYPE_LABELS[expectedWeapon]}`,
          );
        }
        if (linkedTerminals.has(targetId)) {
          errors.push(`末端节点 ${targetId} 被多个连接点引用`);
        }
        linkedTerminals.add(targetId);
      }
    }
  }
  for (const weapon of WEAPON_TYPES) {
    for (const terminal of (pack.skillTrees.weapons[weapon] ?? []).filter(
      (node) => node.role === "terminal",
    )) {
      if (!linkedTerminals.has(terminal.id)) {
        errors.push(`末端节点 ${terminal.id} 没有被相邻武器的连接点引用`);
      }
    }
  }

  // 被动技能必须带载荷；主动技能不能带被动载荷。
  for (const skill of pack.skills) {
    if (skill.kind === "passive" && !skill.passive) {
      errors.push(`被动技能 ${skill.id} 缺少 passive 载荷`);
    }
    if (skill.kind !== "passive" && skill.passive) {
      errors.push(`主动技能 ${skill.id} 不应配置 passive 载荷`);
    }
  }

  const dungeonTags = new Set(pack.dungeons.flatMap((dungeon) => dungeon.tags));
  for (const race of pack.races) {
    const traitSkill = skillById.get(race.traitSkillId);
    if (!traitSkill) {
      errors.push(`过往 ${race.id} 引用了不存在的特质技能 ${race.traitSkillId}`);
    } else if (traitSkill.kind !== "trait") {
      errors.push(`过往 ${race.id} 的特质技能 ${race.traitSkillId} 必须是 kind=trait`);
    }
    if (!race.dungeonAffinity) continue;
    for (const tag of race.dungeonAffinity.tags) {
      if (!dungeonTags.has(tag)) {
        errors.push(`过往 ${race.id} 的迷宫亲和引用了不存在的标签 ${tag}`);
      }
    }
  }
  for (const item of pack.items) {
    if (item.slot === "weapon" && !item.weaponType) {
      errors.push(`武器 ${item.id} 缺少 weaponType`);
    }
    if (item.slot !== "weapon" && item.weaponType) {
      errors.push(`非武器物品 ${item.id} 不应配置 weaponType`);
    }
  }
  for (const npc of pack.npcs) {
    if (!raceIds.has(npc.raceId)) errors.push(`NPC ${npc.id} 引用了不存在的过往 ${npc.raceId}`);
    for (const skillId of npc.passiveSkillIds) {
      const skill = skillById.get(skillId);
      if (!skill) errors.push(`NPC ${npc.id} 引用了不存在的被动 ${skillId}`);
      else if (skill.kind !== "passive") {
        errors.push(`NPC ${npc.id} 的 ${skillId} 不是被动技能`);
      }
    }
    for (const id of Object.keys(npc.skillLevels)) {
      if (!skillIds.has(id)) errors.push(`NPC ${npc.id} 引用了不存在的技能 ${id}`);
    }
    for (const id of npc.equipment) {
      const item = itemById.get(id);
      if (!item) {
        errors.push(`NPC ${npc.id} 引用了不存在的装备 ${id}`);
        continue;
      }
      if (item.slot === "weapon" && item.weaponType !== npc.weaponType) {
        errors.push(`NPC ${npc.id} 的武器 ${id} 与武器类型 ${npc.weaponType} 不符`);
      }
    }
  }
  for (const monster of pack.monsters) {
    for (const id of monster.skillIds) {
      if (!skillIds.has(id)) errors.push(`怪物 ${monster.id} 引用了不存在的技能 ${id}`);
    }
    if (monster.lootTableId && !lootIds.has(monster.lootTableId)) {
      errors.push(`怪物 ${monster.id} 引用了不存在的掉落表 ${monster.lootTableId}`);
    }
    if (monster.gold[0] > monster.gold[1]) errors.push(`怪物 ${monster.id} 的金币区间下限大于上限`);
  }
  for (const table of pack.lootTables) {
    for (const entry of table.entries) {
      if (!itemIds.has(entry.templateId)) {
        errors.push(`掉落表 ${table.id} 引用了不存在的物品 ${entry.templateId}`);
      }
    }
  }
  for (const quest of pack.quests) {
    for (const id of quest.prerequisiteQuestIds) {
      if (!questIds.has(id)) {
        errors.push(`任务 ${quest.id} 引用了不存在的前置任务 ${id}`);
      }
      if (id === quest.id) {
        errors.push(`任务 ${quest.id} 不能把自己设为前置`);
      }
    }
    for (const objective of quest.objectives) {
      if (objective.type === "complete-dungeon") {
        if (!objective.targetId) {
          errors.push(`任务 ${quest.id} 的 complete-dungeon 目标缺少迷宫 id`);
        } else if (!dungeonIds.has(objective.targetId)) {
          errors.push(
            `任务 ${quest.id} 引用了不存在的迷宫 ${objective.targetId}`,
          );
        }
      }
    }
    if (quest.rewards.titleId && !titleIds.has(quest.rewards.titleId)) {
      errors.push(`任务 ${quest.id} 引用了不存在的称号 ${quest.rewards.titleId}`);
    }
  }
  for (const dungeon of pack.dungeons) {
    if (dungeon.kind === "appointment" && !dungeon.schedule) {
      errors.push(`预约迷宫 ${dungeon.id} 缺少 schedule`);
    }
    if (dungeon.schedule && dungeon.schedule.startHour >= dungeon.schedule.endHour && dungeon.schedule.endHour !== 24) {
      errors.push(`迷宫 ${dungeon.id} 的预约时间区间无效`);
    }
    if (dungeon.tags.length === 0) {
      errors.push(`迷宫 ${dungeon.id} 缺少亲和标签 tags`);
    }
    const roomIds = new Set<string>();
    const positions = new Set<string>();
    const startRooms: typeof dungeon.rooms = [];
    const bossRooms: typeof dungeon.rooms = [];
    for (const room of dungeon.rooms) {
      if (roomIds.has(room.id)) {
        errors.push(`迷宫 ${dungeon.id} 的房间 id 重复: ${room.id}`);
      }
      roomIds.add(room.id);
      const key = `${room.x},${room.y}`;
      if (positions.has(key)) {
        errors.push(`迷宫 ${dungeon.id} 的房间坐标重复: ${key}`);
      }
      positions.add(key);
      if (room.kind === "start") startRooms.push(room);
      if (room.kind === "boss") bossRooms.push(room);
      if (room.kind === "start" || room.kind === "treasure") {
        if (room.monsters.length > 0) {
          errors.push(`迷宫 ${dungeon.id} 的${room.kind === "start" ? "入口" : "宝箱"}房 ${room.id} 不应有怪物`);
        }
      } else if (room.monsters.length === 0) {
        errors.push(`迷宫 ${dungeon.id} 的房间 ${room.id} 必须有怪物编成`);
      }
      for (const group of room.monsters) {
        if (!monsterIds.has(group.monsterId)) {
          errors.push(`迷宫 ${dungeon.id} 房间 ${room.id} 引用了不存在的怪物 ${group.monsterId}`);
        }
      }
      if (room.lootTableId && !lootIds.has(room.lootTableId)) {
        errors.push(`迷宫 ${dungeon.id} 房间 ${room.id} 引用了不存在的掉落表 ${room.lootTableId}`);
      }
      if (room.gold && room.gold[0] > room.gold[1]) {
        errors.push(`迷宫 ${dungeon.id} 房间 ${room.id} 的金币区间下限大于上限`);
      }
    }
    if (startRooms.length !== 1) errors.push(`迷宫 ${dungeon.id} 必须恰好有一个入口房间`);
    if (bossRooms.length !== 1) errors.push(`迷宫 ${dungeon.id} 必须恰好有一个 boss 房间`);
    const adjacency = new Map<string, Set<string>>();
    for (const room of dungeon.rooms) adjacency.set(room.id, new Set());
    for (const [a, b] of dungeon.edges) {
      if (!roomIds.has(a) || !roomIds.has(b)) {
        errors.push(`迷宫 ${dungeon.id} 的连接引用了不存在的房间 ${!roomIds.has(a) ? a : b}`);
        continue;
      }
      if (a === b) {
        errors.push(`迷宫 ${dungeon.id} 的房间 ${a} 不能连接自己`);
        continue;
      }
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
    }
    const startRoom = startRooms[0];
    if (startRoom) {
      const visited = new Set<string>([startRoom.id]);
      const queue = [startRoom.id];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of adjacency.get(current) ?? []) {
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }
      for (const room of dungeon.rooms) {
        if (!visited.has(room.id)) {
          errors.push(`迷宫 ${dungeon.id} 的房间 ${room.id} 从入口不可达`);
        }
      }
    }
    if (dungeon.completionReward.lootTableId && !lootIds.has(dungeon.completionReward.lootTableId)) {
      errors.push(`迷宫 ${dungeon.id} 的通关奖励引用了不存在的掉落表 ${dungeon.completionReward.lootTableId}`);
    }
    if (dungeon.completionReward.gold[0] > dungeon.completionReward.gold[1]) {
      errors.push(`迷宫 ${dungeon.id} 的通关金币区间下限大于上限`);
    }
    for (const id of dungeon.npcAssistIds) {
      if (!npcIds.has(id)) {
        errors.push(`迷宫 ${dungeon.id} 引用了不存在的 NPC 支援 ${id}`);
      }
    }
  }
  for (const affix of pack.affixes) {
    if (affix.kind === "modifier") {
      for (const entry of affix.modifiers) {
        if (entry.min > entry.max) {
          errors.push(`词缀 ${affix.id} 的修正 ${entry.kind} min 大于 max`);
        }
      }
    }
  }
  return errors;
}
