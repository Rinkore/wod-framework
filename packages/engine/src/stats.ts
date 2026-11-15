import {
  allSkillTreeNodes,
  allSkillTreeSkillIds,
  clamp,
  findSkillTreeNode,
  heroCanUseItem,
  isPctModifierKind,
  isPhysicalDamageType,
  mergeHooks,
  skillUsableWithWeapon,
  unlockedWeaponRoots,
  weaponPath,
  type AffixRoll,
  type BaseStats,
  type ContentPack,
  type DamageType,
  type ItemEffect,
  type Modifier,
  type ModifierKind,
  type PartialBaseStats,
  type Position,
  type Race,
  type Resistance,
  type Skill,
  type SkillPassive,
  type TraitBacklineHunter,
  type TraitHooks,
  type WeaponPath,
  type WeaponType,
  type HeroCombatSettings,
} from "@wod/shared";

export interface EquippedItemRef {
  templateId: string;
  affixes: AffixRoll[];
}

/** 护甲减伤：护甲 / (护甲 + 系数 × 本次物理伤害)，对低伤害更有效。 */
export const ARMOR_DAMAGE_FACTOR = 4;
export const ARMOR_CAP = 0.9;
/** 元素/混沌抗性上下限（小数比例）。 */
export const RESIST_MIN = -0.5;
export const RESIST_MAX = 0.8;
/** 命中/闪避评分换算为概率的曲线参数（先快后慢）。 */
export const HIT_RATING_FACTOR = 1.1;
export const EVASION_RATING_FACTOR = 0.5;
export const EVASION_RATING_EXPONENT = 0.9;
export const HIT_CHANCE_MIN = 0.05;
export const HIT_CHANCE_MAX = 0.98;
/** 技能基础概率：攻击技能默认 5% 暴击 / 90% 命中，其他技能默认 0 / 100。 */
export const DEFAULT_ATTACK_CRIT_RATE = 5;
export const DEFAULT_ATTACK_HIT_RATE = 90;

/** 技能基础暴击率（百分点）。 */
export function skillBaseCritRate(skill: Pick<Skill, "kind" | "baseCritRate">): number {
  if (skill.kind !== "attack") return skill.baseCritRate ?? 0;
  return skill.baseCritRate ?? DEFAULT_ATTACK_CRIT_RATE;
}

/** 技能基础命中率（百分比）。 */
export function skillBaseHitRate(skill: Pick<Skill, "kind" | "baseHitRate">): number {
  if (skill.kind !== "attack") return skill.baseHitRate ?? 100;
  return skill.baseHitRate ?? DEFAULT_ATTACK_HIT_RATE;
}

/** 技能基础暴击率叠加到角色暴击率；技能等级不改变基础概率。 */
export function skillCritChance(critChance: number, baseCritRate: number): number {
  return Math.max(0, critChance + baseCritRate / 100);
}

/** 技能基础命中率相对 90% 基准的偏移，叠加到命中率曲线结果。 */
export function applySkillHitBase(hitChance: number, baseHitRate: number): number {
  return clamp(
    hitChance + (baseHitRate - DEFAULT_ATTACK_HIT_RATE) / 100,
    HIT_CHANCE_MIN,
    HIT_CHANCE_MAX,
  );
}

/** 本次物理伤害下，护甲提供的实际减伤率。 */
export function physicalDamageReduction(armor: number, damage: number): number {
  const a = Math.max(0, armor);
  const d = Math.max(1, damage);
  return clamp(a / (a + ARMOR_DAMAGE_FACTOR * d), 0, ARMOR_CAP);
}

/** 命中评分对闪避评分的实际命中率；比例曲线先快后慢。 */
export function hitChanceFromRatings(hit: number, evasion: number): number {
  const h = Math.max(0, hit);
  const e = Math.max(0, evasion);
  if (h <= 0) return e <= 0 ? 0.5 : HIT_CHANCE_MIN;
  const denominator = h + Math.pow(e * EVASION_RATING_FACTOR, EVASION_RATING_EXPONENT);
  if (denominator <= 0) return HIT_CHANCE_MIN;
  return clamp((HIT_RATING_FACTOR * h) / denominator, HIT_CHANCE_MIN, HIT_CHANCE_MAX);
}

/** 英雄每级基础数值成长。 */
export const HERO_LEVEL_GROWTH: BaseStats = {
  hp: 8,
  mana: 2.5,
  attack: 1,
  armor: 0.5,
  hit: 0.6,
  evasion: 0.5,
  initiative: 0.5,
  crit: 0.08,
};

/** 怪物每级基础数值成长（保持旧版等级项的量级）。 */
export const MONSTER_LEVEL_GROWTH: BaseStats = {
  hp: 3,
  mana: 2,
  attack: 0,
  armor: 0,
  hit: 0.5,
  evasion: 0.5,
  initiative: 1.5,
  crit: 0,
};


export interface HeroRunSpec {
  id: string;
  name: string;
  level: number;
  epEarned: number;
  raceId: string;
  /** 创建时选择的武器路径。 */
  weaponType: WeaponType;
  /** 已解锁技能等级；被动节点也以 1 级存在。 */
  skillLevels: Record<string, number>;
  /** NPC 固定被动；玩家英雄通常为空，被动在 skillLevels 中。 */
  passiveSkillIds?: string[];
  position?: Position;
  equipment: EquippedItemRef[];
  /** 由预设解析出的战斗设置。 */
  settings?: HeroCombatSettings;
}

/** 携带来源的装备特效（用于战报归因与去重）。 */
export type SourcedItemEffect = ItemEffect & {
  sourceId: string;
  sourceName: string;
};

export interface HeroItemBonuses {
  armor: number;
  weaponDamage: number;
  weaponDamageType: DamageType | null;
  /** 装备提供的全部静态修正（含词缀 roll）。 */
  modifiers: Modifier[];
  /** 装备提供的全部触发特效（含词缀特效）。 */
  effects: SourcedItemEffect[];
}

export interface HeroDerived {
  race: Race;
  path: WeaponPath;
  /** 过往初始 + 等级成长 + 被动后的裸值；只用于需求校验/调试，面板请用 finalStats。 */
  baseStats: BaseStats;
  /** 面板最终数值：已计入特质、被动、装备词条与强化，不含局内 buff。 */
  finalStats: BaseStats;
  maxHp: number;
  maxEnergy: number;
  /** 先攻（已含常驻修正）。 */
  initiative: number;
  /** 护甲（已含基础、装备与常驻修正）。 */
  armor: number;
  /** 对同级标准物理攻击的减伤率（0–0.9）；实际战斗按本次伤害重算。 */
  physicalReduction: number;
  /** 命中评分（已含常驻修正）。 */
  hit: number;
  /** 对同级标准怪物的实际命中率。 */
  hitRate: number;
  /** 闪避评分（已含常驻修正）。 */
  evasion: number;
  /** 对同级标准怪物的实际闪避率（1 − 对方命中率）。 */
  evasionRate: number;
  /** 面板概率的参考对手。 */
  reference: CombatReference;
  /** 暴击率（小数比例，已含常驻修正）。 */
  critChance: number;
  /** 当前攻击力（基础攻击 + 武器伤害）；技能按 weaponScale 使用。 */
  attackPower: number;
  /** 每回合主要行动次数；当前固定为 1，先攻只决定顺序。 */
  actionsPerRound: number;
  resistances: Resistance;
  /** 常驻修正汇总：特质 + 被动 + 装备词条。 */
  modifiers: Modifier[];
  /** 过往特质与被动合并后的钩子。 */
  hooks: TraitHooks;
  /** 需要战斗内触发的特质。 */
  trait?: HeroTraitRuntime;
  /** 装备特效（触发型词条）。 */
  itemEffects: SourcedItemEffect[];
  weaponDamage: number;
  weaponDamageType: DamageType;
  weaponType: WeaponType | null;
  /** 已解锁武器熟练（起始武器 + 已解锁武器根 + 被动授予）。 */
  weaponProficiencies: WeaponType[];
  skills: Skill[];
}

export interface HeroTraitRuntime {
  id: string;
  name: string;
  backlineHunter: TraitBacklineHunter;
}

/** 面板括号内概率的参考对手：同级标准怪物。 */
export interface CombatReference {
  /** 参考怪物的等级（可能因内容断层取最近等级）。 */
  level: number;
  hit: number;
  evasion: number;
  /** 参考怪物一次标准物理攻击的税前伤害。 */
  hitDamage: number;
}

/**
 * 取同级 ±2 级怪物的平均命中/闪避与标准物理伤害。
 * 用于面板显示「命中率/闪避率/物理减伤」的参考口径，不参与战斗结算。
 * 用一个小等级池而不是单一等级，避免某级只有 Boss 时把参考值拉成 Boss 面板。
 */
export function referenceMonsterStats(content: ContentPack, level: number): CombatReference {
  const nearby = content.monsters.filter((monster) => Math.abs(monster.level - level) <= 2);
  const levels = [...new Set(content.monsters.map((monster) => monster.level))].sort(
    (a, b) => a - b,
  );
  const fallbackLevel = levels[0] ?? 1;
  const nearestLevel = levels.reduce(
    (best, current) =>
      Math.abs(current - level) <= Math.abs(best - level) ? current : best,
    fallbackLevel,
  );
  const monsters =
    nearby.length > 0
      ? nearby
      : content.monsters.filter((monster) => monster.level === nearestLevel);
  if (monsters.length === 0) {
    return {
      level: nearestLevel,
      hit: 10 + 2 * level,
      evasion: 8 + 2 * level,
      hitDamage: 6 + 2.2 * level,
    };
  }
  const avg = (pick: (monster: (typeof monsters)[number]) => number) =>
    monsters.reduce((sum, monster) => sum + pick(monster), 0) / monsters.length;
  const physicalHits: number[] = [];
  for (const monster of monsters) {
    for (const skillId of monster.skillIds) {
      const skill = content.skills.find((row) => row.id === skillId);
      if (!skill || skill.kind !== "attack") continue;
      if (!isPhysicalDamageType(skill.damageType ?? "crushing")) continue;
      const skillLevel = Math.max(1, Math.floor(monster.level / 2));
      physicalHits.push(
        (skill.power + skill.levelScale * monster.level) *
          skillMagnitudeMultiplier(skillLevel) *
          monster.damageMultiplier,
      );
    }
  }
  const hitDamage =
    physicalHits.length > 0
      ? physicalHits.reduce((sum, value) => sum + value, 0) / physicalHits.length
      : 6 + 2.2 * level;
  return {
    level: Math.round(level),
    hit: avg((monster) => monster.base.hit + MONSTER_LEVEL_GROWTH.hit * (monster.level - 1)),
    evasion: avg(
      (monster) => monster.base.evasion + MONSTER_LEVEL_GROWTH.evasion * (monster.level - 1),
    ),
    hitDamage,
  };
}

export function getRace(content: ContentPack, id: string): Race {
  const race = content.races.find((row) => row.id === id);
  if (!race) throw new Error(`内容包中不存在过往 ${id}`);
  return race;
}

export function getWeaponPath(content: ContentPack, id: WeaponType): WeaponPath {
  const path = weaponPath(content, id);
  if (!path) throw new Error(`内容包中不存在武器路径 ${id}`);
  return path;
}

export function getSkill(content: ContentPack, id: string): Skill {
  const skill = content.skills.find((row) => row.id === id);
  if (!skill) throw new Error(`内容包中不存在技能 ${id}`);
  return skill;
}

/** 按修正种类求和（单位：百分点或平值，取决于种类）。 */
export function sumModifiers(modifiers: Modifier[], kind: ModifierKind): number {
  return modifiers.reduce((sum, row) => (row.kind === kind ? sum + row.amount : sum), 0);
}


export function itemBonuses(content: ContentPack, equipment: EquippedItemRef[]): HeroItemBonuses {
  let armor = 0;
  let weaponDamage = 0;
  let weaponDamageType: DamageType | null = null;
  const modifiers: Modifier[] = [];
  const effects: SourcedItemEffect[] = [];

  for (const equipped of equipment) {
    const template = content.items.find((row) => row.id === equipped.templateId);
    if (!template) {
      continue;
    }
    armor += template.armor ?? 0;
    if (template.weaponDamage) {
      weaponDamage += template.weaponDamage;
      if (template.damageType) weaponDamageType = template.damageType;
    }
    for (const modifier of template.modifiers) {
      modifiers.push({ ...modifier });
    }
    for (const effect of template.effects) {
      effects.push({ ...effect, sourceId: template.id, sourceName: template.name });
    }
    for (const affix of equipped.affixes) {
      for (const modifier of affix.modifiers ?? []) {
        modifiers.push({ ...modifier });
      }
      if (affix.effect) {
        effects.push({ ...affix.effect, sourceId: affix.affixId, sourceName: affix.name });
      }
    }
  }

  return { armor, weaponDamage, weaponDamageType, modifiers, effects };
}

/** 技能量级倍率：打击/治疗/DoT/HoT/护盾随技能等级线性成长。 */
export function skillMagnitudeMultiplier(level: number): number {
  return 1 + 0.06 * (Math.max(1, level) - 1);
}

/** 修正类效果每技能等级额外获得的百分点。 */
export function skillModBonusPerLevel(level: number): number {
  return 0.01 * (Math.max(1, level) - 1) * 100;
}

/** 技能伤害构成；只含技能自身量级，不含命中/暴击/目标减伤。 */
export interface SkillDamageBreakdown {
  /** 技能固定威力。 */
  power: number;
  /** 每英雄等级成长 × 英雄等级。 */
  levelScaling: number;
  /** 武器伤害倍率 × 攻击力。 */
  attackScaling: number;
  /** 三项合计，未乘技能等级/增伤。 */
  baseMagnitude: number;
  /** 技能等级倍率。 */
  levelMultiplier: number;
  /** 技能增伤倍率（1 + skillPowerPct）。 */
  powerMultiplier: number;
  /** 最终技能量级（仍未计命中/暴击/目标减伤）。 */
  total: number;
}

export function skillDamageBreakdown(
  heroLevel: number,
  attackPower: number,
  skill: Pick<Skill, "power" | "levelScale" | "weaponScale">,
  skillLevel: number,
  hooks: TraitHooks,
): SkillDamageBreakdown {
  const power = skill.power;
  const levelScaling = skill.levelScale * heroLevel;
  const attackScaling = skill.weaponScale * attackPower;
  const baseMagnitude = power + levelScaling + attackScaling;
  const levelMultiplier = skillMagnitudeMultiplier(skillLevel);
  const powerMultiplier = 1 + hooks.skillPowerPct;
  return {
    power,
    levelScaling,
    attackScaling,
    baseMagnitude,
    levelMultiplier,
    powerMultiplier,
    total: baseMagnitude * levelMultiplier * powerMultiplier,
  };
}

/** 常驻「造成伤害」修正倍率；与战斗内乘区一致，但不含局内 buff。 */
export function outgoingDamageMultiplier(modifiers: Modifier[]): number {
  return 1 + clamp(sumModifiers(modifiers, "damageDealt") / 100, -0.6, 1.5);
}

function addBase(base: BaseStats, delta: PartialBaseStats): BaseStats {
  return {
    hp: base.hp + (delta.hp ?? 0),
    mana: base.mana + (delta.mana ?? 0),
    attack: base.attack + (delta.attack ?? 0),
    armor: base.armor + (delta.armor ?? 0),
    hit: base.hit + (delta.hit ?? 0),
    evasion: base.evasion + (delta.evasion ?? 0),
    initiative: base.initiative + (delta.initiative ?? 0),
    crit: base.crit + (delta.crit ?? 0),
  };
}

function scaleBase(base: BaseStats, level: number): BaseStats {
  const steps = Math.max(0, level - 1);
  return {
    hp: base.hp + HERO_LEVEL_GROWTH.hp * steps,
    mana: base.mana + HERO_LEVEL_GROWTH.mana * steps,
    attack: base.attack + HERO_LEVEL_GROWTH.attack * steps,
    armor: base.armor + HERO_LEVEL_GROWTH.armor * steps,
    hit: base.hit + HERO_LEVEL_GROWTH.hit * steps,
    evasion: base.evasion + HERO_LEVEL_GROWTH.evasion * steps,
    initiative: base.initiative + HERO_LEVEL_GROWTH.initiative * steps,
    crit: base.crit + HERO_LEVEL_GROWTH.crit * steps,
  };
}

/** 收集已解锁被动（玩家在 skillLevels 中，NPC 可额外指定）。 */
export function unlockedPassiveSkills(content: ContentPack, spec: HeroRunSpec): Skill[] {
  const ids = new Set<string>(spec.passiveSkillIds ?? []);
  for (const [id, level] of Object.entries(spec.skillLevels ?? {})) {
    if (level > 0) ids.add(id);
  }
  const rows: Skill[] = [];
  for (const id of ids) {
    const skill = content.skills.find((row) => row.id === id);
    if (skill?.kind === "passive" && skill.passive) rows.push(skill);
  }
  return rows;
}

function mergePassives(passives: Skill[]): {
  base: BaseStats;
  hpPct: number;
  manaPct: number;
  modifiers: Modifier[];
  hooks: TraitHooks;
  weaponProficiencies: WeaponType[];
} {
  let base: BaseStats = { hp: 0, mana: 0, attack: 0, armor: 0, hit: 0, evasion: 0, initiative: 0, crit: 0 };
  let hpPct = 0;
  let manaPct = 0;
  const modifiers: Modifier[] = [];
  const hooks: TraitHooks[] = [];
  const proficiencies = new Set<WeaponType>();
  for (const skill of passives) {
    const payload = skill.passive as SkillPassive;
    base = addBase(base, payload.base);
    hpPct += payload.hpPct;
    manaPct += payload.manaPct;
    modifiers.push(...payload.modifiers);
    hooks.push(payload.hooks);
    for (const weapon of payload.weaponProficiencies) proficiencies.add(weapon);
  }
  return {
    base,
    hpPct,
    manaPct,
    modifiers,
    hooks: mergeHooks(...hooks),
    weaponProficiencies: [...proficiencies],
  };
}

export function computeHeroDerived(content: ContentPack, spec: HeroRunSpec): HeroDerived {
  const race = getRace(content, spec.raceId);
  const path = getWeaponPath(content, spec.weaponType);
  const gear = itemBonuses(content, spec.equipment);
  const equippedWeapon = spec.equipment
    .map((ref) => content.items.find((item) => item.id === ref.templateId))
    .find((item) => item?.slot === "weapon");
  const passives = unlockedPassiveSkills(content, spec);
  const passive = mergePassives(passives);
  const pas = race.passive ?? {};
  const hpPct = (pas.hpPct ?? 0) + passive.hpPct;
  const manaPct = (pas.manaPct ?? 0) + (pas.energyPct ?? 0) + passive.manaPct;

  const baseStats = scaleBase(addBase({ ...race.base }, passive.base), spec.level);
  const traitSkill = content.skills.find(
    (skill) => skill.id === race.traitSkillId && skill.kind === "trait",
  );
  const traitPayload = traitSkill?.trait;
  const traitRuntime: HeroTraitRuntime | undefined =
    traitSkill && traitPayload?.backlineHunter
      ? {
          id: traitSkill.id,
          name: traitSkill.name,
          backlineHunter: traitPayload.backlineHunter,
        }
      : undefined;

  // 常驻修正 = 特质修正 + 被动修正 + 装备词条 + 被动站位条件修正。
  const hooks = mergeHooks(traitPayload?.hooks, passive.hooks);
  const modifiers: Modifier[] = [
    ...(traitPayload?.modifiers ?? []),
    ...passive.modifiers,
    ...gear.modifiers,
  ];
  for (const group of hooks.positionModifiers) {
    if (group.position === (spec.position ?? "front")) {
      modifiers.push(...group.modifiers);
    }
  }

  const maxHp = Math.round(baseStats.hp * (1 + hpPct));
  const maxEnergy = Math.round(baseStats.mana * (1 + manaPct));
  const hit = baseStats.hit + sumModifiers(modifiers, "hit");
  const evasion = baseStats.evasion + sumModifiers(modifiers, "evasion");
  const armor = baseStats.armor + gear.armor + sumModifiers(modifiers, "armor");
  const initiative = Math.round(baseStats.initiative + sumModifiers(modifiers, "initiative"));
  const critPoints = baseStats.crit + sumModifiers(modifiers, "crit");
  const critChance = Math.max(0.02, critPoints / 100);
  const attackPower = baseStats.attack + gear.weaponDamage;
  const resistances: Resistance = {
    elemental: clamp(
      (pas.resist?.elemental ?? 0) + sumModifiers(modifiers, "elementalResist") / 100,
      RESIST_MIN,
      RESIST_MAX,
    ),
    chaos: clamp(
      (pas.resist?.chaos ?? 0) + sumModifiers(modifiers, "chaosResist") / 100,
      RESIST_MIN,
      RESIST_MAX,
    ),
  };
  // 先攻只负责排序；额外行动钩子不再直接增加整回合行动，避免跨阈值滚雪球。
  const actionsPerRound = 1;
  const reference = referenceMonsterStats(content, spec.level);
  const hitRate = hitChanceFromRatings(hit, reference.evasion);
  const evasionRate = 1 - hitChanceFromRatings(reference.hit, evasion);
  const physicalReduction = physicalDamageReduction(armor, reference.hitDamage);
  const finalStats: BaseStats = {
    hp: maxHp,
    mana: maxEnergy,
    attack: attackPower,
    armor,
    hit,
    evasion,
    initiative,
    crit: critChance * 100,
  };

  // 武器熟练 = 起始武器 + 已解锁武器根 + 被动授予。
  const unlocked = new Set(
    Object.entries(spec.skillLevels ?? {})
      .filter(([, level]) => level > 0)
      .map(([id]) => id),
  );
  const roots = unlockedWeaponRoots(content, unlocked);
  const proficiencies = new Set<WeaponType>([
    spec.weaponType,
    ...roots,
    ...passive.weaponProficiencies,
  ]);
  const weaponType =
    equippedWeapon && heroCanUseItem([...proficiencies], equippedWeapon)
      ? (equippedWeapon.weaponType ?? null)
      : null;

  // 已解锁主动技能：跨树连接后，邻树技能也会进入可用列表。
  const nodes = allSkillTreeNodes(content);
  const seen = new Set<string>();
  const skills: Skill[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    if ((spec.skillLevels[node.id] ?? 0) <= 0) continue;
    const skill = content.skills.find((row) => row.id === node.id);
    if (!skill || skill.kind === "passive" || skill.kind === "trait") continue;
    skills.push(skill);
  }
  const power = powerAttackFor();
  if ((spec.skillLevels[power.id] ?? 0) > 0) skills.push(power);

  return {
    race,
    path,
    baseStats,
    finalStats,
    maxHp: Math.max(1, maxHp),
    maxEnergy: Math.max(1, maxEnergy),
    initiative,
    armor,
    physicalReduction,
    hit,
    hitRate,
    evasion,
    evasionRate,
    reference,
    critChance,
    attackPower,
    actionsPerRound,
    resistances,
    modifiers,
    hooks,
    trait: traitRuntime,
    itemEffects: gear.effects,
    weaponDamage: gear.weaponDamage,
    weaponDamageType: gear.weaponDamageType ?? "crushing",
    weaponType,
    weaponProficiencies: [...proficiencies],
    skills,
  };
}

export const BASIC_ATTACK_ID = "basic-attack";
export const POWER_ATTACK_ID = "power-attack";

export function basicAttackFor(path: WeaponPath, weaponDamageType: DamageType): Skill {
  return {
    id: BASIC_ATTACK_ID,
    name: "普通攻击",
    description: `${path.name}的一次朴素攻击，不消耗法力；伤害随等级与武器伤害提升。`,
    kind: "attack",
    category: "basic",
    maxLevel: 20,
    damageType: weaponDamageType,
    levelScale: 0.5,
    weaponScale: 1,
    power: 4,
    cooldown: 0,
    energyCost: 0,
    target: "enemy",
    effects: [],
  };
}

export function powerAttackFor(): Skill {
  return {
    id: POWER_ATTACK_ID,
    name: "强力攻击",
    description: "蓄力挥出的一击，消耗法力；伤害随等级与武器伤害提升。",
    kind: "attack",
    category: "secondary",
    maxLevel: 20,
    damageType: "crushing",
    levelScale: 0.8,
    weaponScale: 1.1,
    power: 8,
    cooldown: 2,
    energyCost: 7,
    target: "enemy",
    effects: [],
  };
}

export function monsterBasicAttack(): Skill {
  return {
    id: "monster-basic-attack",
    name: "攻击",
    description: "怪物发起的一次攻击。",
    kind: "attack",
    category: "basic",
    maxLevel: 20,
    damageType: "crushing",
    levelScale: 0.9,
    weaponScale: 0,
    power: 4,
    cooldown: 0,
    energyCost: 0,
    target: "enemy",
    effects: [],
  };
}

/** 全部玩家可获得技能 id（用于内容校验/模拟）。 */
export function playerSkillIds(content: ContentPack): string[] {
  return allSkillTreeSkillIds(content);
}

/** 技能是否需要当前武器类型。 */
export { skillUsableWithWeapon, findSkillTreeNode };

/** 修正幅度展示文本（平值/百分比），供面板与日志共用。 */
export function modifierText(kind: ModifierKind, amount: number): string {
  const sign = amount >= 0 ? "+" : "";
  return isPctModifierKind(kind) ? `${sign}${amount}%` : `${sign}${amount}`;
}
