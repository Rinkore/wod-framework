import {
  AILMENTS,
  AILMENT_LABELS,
  DAMAGE_CHANNEL_LABELS,
  DAMAGE_TYPE_LABELS,
  ITEM_EFFECT_TRIGGER_LABELS,
  MODIFIER_KIND_LABELS,
  SKILL_PHASES,
  ailmentForDamageType,
  clamp,
  damageChannel,
  emptyHooks,
  isPctModifierKind,
  isPhysicalDamageType,
  modifierAmountText,
  modifierBeneficial,
  skillPhases,
  skillUsableWithWeapon,
  type Ailment,
  type CombatLogAilmentProgress,
  type CombatLogEffect,
  type CombatLogEntry,
  type CombatLogParticipant,
  type CombatantSnapshot,
  type ContentPack,
  type DamageType,
  type Effect,
  type HeroCombatSettings,
  type ItemEffect,
  type Modifier,
  type ModifierKind,
  type Monster,
  type PhaseSettingsMap,
  type Position as SharedPosition,
  type Resistance,
  type Skill,
  type SkillPhase,
  type TargetPriority,
  type TraitHooks,
  type WeaponType,
} from "@wod/shared";
import type { EncounterResult } from "@wod/shared";
import type { Rng } from "./rng.js";
import {
  ARMOR_CAP,
  ARMOR_DAMAGE_FACTOR,
  RESIST_MAX,
  RESIST_MIN,
  basicAttackFor,
  computeHeroDerived,
  hitChanceFromRatings,
  monsterBasicAttack,
  MONSTER_LEVEL_GROWTH,
  physicalDamageReduction,
  skillMagnitudeMultiplier,
  skillModBonusPerLevel,
  skillBaseCritRate,
  skillBaseHitRate,
  skillCritChance,
  applySkillHitBase,
  sumModifiers,
  type HeroRunSpec,
  type HeroTraitRuntime,
  type SourcedItemEffect,
} from "./stats.js";

/** 战斗数值常量：调平衡只需要改这一处。 */
export const COMBAT_CONSTANTS = {
  /** 每回合基础回蓝；与普通技能成本保持可持续循环。 */
  energyRegenBase: 8,
  /** 单位每回合固定一项主要行动；先攻只决定顺序。 */
  primaryActionsPerRound: 1,
  /** 中毒/伤口的最大叠层，避免长战百分比伤害失控。 */
  persistentAilmentMaxStacks: 3,
  /** 触发型异常的最大持续回合。 */
  persistentAilmentMaxDuration: 6,
  /** 每次暴击判定提供的额外伤害。 */
  critDamagePerTier: 0.5,
  /** 护甲减伤：护甲 / (护甲 + 系数 × 本次伤害)，对低伤害更有效。 */
  armorDamageFactor: ARMOR_DAMAGE_FACTOR,
  /** 护甲减伤上限。 */
  armorCap: ARMOR_CAP,
  /** 抗性（元素/混沌）比例上下限。 */
  resistMin: RESIST_MIN,
  resistMax: RESIST_MAX,
  /** 旧内容兼容字段：怪物不再因等级获得第二次主要行动。 */
  monsterSecondActionLevel: 7,
  /** 出伤/承伤修正总和的上下限。 */
  damageModMin: -0.6,
  damageModMax: 1.5,
  /** 技能量级每级成长。 */
  skillMagnitudeRate: 0.06,
} as const;

/** 怪物和英雄统一每回合一次主要行动；等级只影响面板与行动顺序。 */
export function monsterActionsPerRound(_level: number): number {
  return COMBAT_CONSTANTS.primaryActionsPerRound;
}

/** 携带来源的装备特效（见 stats.ts；此处 re-export 保持兼容）。 */
export type { SourcedItemEffect } from "./stats.js";

export interface ActiveEffect {
  uid: number;
  /** 来源技能或装备词条 id，用于同类刷新去重。 */
  sourceSkillId: string;
  sourceSkillName: string;
  /** 施加该效果的角色或怪物名称。 */
  sourceName: string;
  type:
    | "mod"
    | "dot"
    | "hot"
    | "stun"
    | "shield"
    | "silence"
    | "taunt"
    | "reflect"
    | "burn"
    | "freeze"
    | "paralysis"
    | "sleep"
    | "poison"
    | "bleed"
    | "wound";
  /** mod 效果的修正种类。 */
  kind?: ModifierKind;
  /** mod 幅度（百分比类为百分点，平值类为数值），正负号即强化/弱化。 */
  amount?: number;
  /** dot/hot 每跳快照值；shield 为剩余吸收量。 */
  value?: number;
  /** reflect 反伤比例（小数）。 */
  percent?: number;
  damageType?: DamageType;
  /** 中毒/伤口层数。 */
  stacks?: number;
  /** 流血最近一次受到物理伤害的回合。 */
  lastPhysicalRound?: number;
  remaining: number;
}

export type Position = SharedPosition;

export interface Combatant {
  id: string;
  side: "hero" | "enemy";
  name: string;
  level: number;
  position: Position;
  /** 游走单位突袭非前排后暴露；持续到它下一次行动。 */
  flankExposed: boolean;
  /** 命中值；百分比命中率的攻方输入。 */
  hit: number;
  /** 闪避值；百分比命中率的守方输入。 */
  evasion: number;
  /** 攻击力（基础攻击 + 武器伤害）；技能按 weaponScale 使用。 */
  attackPower: number;
  maxHp: number;
  hp: number;
  maxEnergy: number;
  energy: number;
  armor: number;
  critChance: number;
  resistances: Resistance;
  /** 每种异常的积累值，上限为目标最大生命；满值触发并清零。 */
  ailments: Record<Ailment, number>;
  /** 怪物额外的异常效率（英雄为 0）。 */
  ailmentEfficiencyBonus: number;
  weaponDamage: number;
  weaponDamageType: DamageType;
  weaponType: WeaponType | null;
  damageMultiplier: number;
  initiative: number;
  /** 常驻修正（被动 + 装备词条 + 站位）；战斗内修正效果叠加在其上。 */
  modifiers: Modifier[];
  /** 过往/被动钩子。 */
  hooks: TraitHooks;
  /** 需要战斗内触发的特质。 */
  trait?: HeroTraitRuntime;
  /** 装备特效（触发型词条）。 */
  itemEffects: SourcedItemEffect[];
  skillLevels: Record<string, number>;
  actionsPerRound: number;
  skills: Skill[];
  basic: Skill;
  cooldowns: Record<string, number>;
  effects: ActiveEffect[];
  downed: boolean;
  /** 当前层生效的战斗设置。 */
  settings?: HeroCombatSettings;
  /** 未按层覆盖的原始设置，用于每层重新解析。 */
  baseSettings?: HeroCombatSettings;
}

interface Action {
  skill: Skill;
  targets: Combatant[];
}

let effectUid = 0;
let actionUid = 0;

function emptyAilments(): Record<Ailment, number> {
  return Object.fromEntries(AILMENTS.map((ailment) => [ailment, 0])) as Record<
    Ailment,
    number
  >;
}

export function buildHeroCombatant(content: ContentPack, spec: HeroRunSpec): Combatant {
  const derived = computeHeroDerived(content, spec);
  const basicLevel = Math.max(1, spec.skillLevels?.["basic-attack"] ?? 1);
  return {
    id: spec.id,
    side: "hero",
    name: spec.name,
    level: spec.level,
    position: spec.position ?? "front",
    flankExposed: false,
    hit: derived.hit,
    evasion: derived.evasion,
    attackPower: derived.attackPower,
    maxHp: derived.maxHp,
    hp: derived.maxHp,
    maxEnergy: derived.maxEnergy,
    energy: derived.maxEnergy,
    armor: derived.armor,
    critChance: derived.critChance,
    resistances: derived.resistances,
    ailments: emptyAilments(),
    ailmentEfficiencyBonus: 0,
    weaponDamage: derived.weaponDamage,
    weaponDamageType: derived.weaponDamageType,
    weaponType: derived.weaponType,
    damageMultiplier: 1,
    initiative: derived.initiative,
    modifiers: derived.modifiers,
    hooks: derived.hooks,
    trait: derived.trait,
    itemEffects: derived.itemEffects,
    skillLevels: { ...spec.skillLevels, "basic-attack": basicLevel },
    actionsPerRound: COMBAT_CONSTANTS.primaryActionsPerRound,
    skills: derived.skills,
    basic: basicAttackFor(derived.path, derived.weaponDamageType),
    cooldowns: {},
    effects: [],
    downed: false,
    settings: spec.settings,
    baseSettings: spec.settings,
  };
}

export function buildMonsterCombatant(
  content: ContentPack,
  monster: Monster,
  displayName: string,
  position: Position = "front",
): Combatant {
  const steps = Math.max(0, monster.level - 1);
  const maxHp = Math.round(
    (monster.base.hp + MONSTER_LEVEL_GROWTH.hp * steps) * monster.hpMultiplier,
  );
  const maxEnergy = Math.round(monster.base.mana + MONSTER_LEVEL_GROWTH.mana * steps);
  const skills = monster.skillIds.map((id) => {
    const skill = content.skills.find((row) => row.id === id);
    if (!skill) throw new Error(`怪物 ${monster.id} 的技能 ${id} 不存在`);
    return skill;
  });
  return {
    id: `${monster.id}#${displayName}`,
    side: "enemy",
    name: displayName,
    level: monster.level,
    position,
    flankExposed: false,
    hit: monster.base.hit + MONSTER_LEVEL_GROWTH.hit * steps,
    evasion: monster.base.evasion + MONSTER_LEVEL_GROWTH.evasion * steps,
    attackPower: monster.base.attack + MONSTER_LEVEL_GROWTH.attack * steps,
    maxHp,
    hp: maxHp,
    maxEnergy,
    energy: maxEnergy,
    armor: monster.base.armor + MONSTER_LEVEL_GROWTH.armor * steps,
    critChance: Math.max(0.02, monster.base.crit / 100),
    resistances: {
      elemental: clamp(monster.resist?.elemental ?? 0, COMBAT_CONSTANTS.resistMin, COMBAT_CONSTANTS.resistMax),
      chaos: clamp(monster.resist?.chaos ?? 0, COMBAT_CONSTANTS.resistMin, COMBAT_CONSTANTS.resistMax),
    },
    ailments: emptyAilments(),
    ailmentEfficiencyBonus: monster.ailmentEfficiency ?? 0,
    weaponDamage: 0,
    weaponDamageType: "crushing",
    weaponType: null,
    damageMultiplier: monster.damageMultiplier,
    initiative: Math.round(monster.base.initiative + MONSTER_LEVEL_GROWTH.initiative * steps),
    modifiers: [],
    hooks: emptyHooks(),
    itemEffects: [],
    skillLevels: Object.fromEntries(
      skills.map((skill) => [skill.id, Math.max(1, Math.floor(monster.level / 2))]),
    ),
    actionsPerRound: monsterActionsPerRound(monster.level),
    skills,
    basic: monsterBasicAttack(),
    cooldowns: {},
    effects: [],
    downed: false,
  };
}

/** 把某层的覆盖设置合并到基础设置上。 */
export function resolveFloorSettings(
  settings: HeroCombatSettings | undefined,
  floor: number,
): HeroCombatSettings | undefined {
  const floorSettings = settings?.floors?.[String(floor)];
  if (!settings || !floorSettings) return settings;
  const phases: PhaseSettingsMap = { ...(settings.phases ?? {}) };
  for (const phase of SKILL_PHASES) {
    const override = floorSettings.phases?.[phase];
    if (!override) continue;
    const base = settings.phases?.[phase];
    phases[phase] = {
      ...(base ?? {}),
      ...override,
      skillIds: override.skillIds ?? base?.skillIds ?? [],
    };
  }
  return {
    ...settings,
    targetPriority: floorSettings.targetPriority ?? settings.targetPriority,
    phases,
    floors: undefined,
  };
}

// ---------------------------------------------------------------------------
// 修正聚合：常驻修正 + 战斗中的 mod 效果，统一从这两个入口读取。
// ---------------------------------------------------------------------------

/** 某项修正的总幅度（百分比类为百分点，平值类为数值）。 */
function modPoints(combatant: Combatant, kind: ModifierKind): number {
  let total = sumModifiers(combatant.modifiers, kind);
  for (const effect of combatant.effects) {
    if (effect.type === "mod" && effect.kind === kind) {
      total += effect.amount ?? 0;
    }
  }
  return total;
}

/** 某项百分比修正的总比例。 */
function modPct(combatant: Combatant, kind: ModifierKind): number {
  return modPoints(combatant, kind) / 100;
}

/**
 * 仅统计「局内效果」的修正。
 *
 * 命中/闪避/暴击/护甲/先攻/抗性已经在面板与战斗快照里计入了常驻修正，
 * 战斗结算时只再叠加 buff/debuff，避免同一件装备被算两次。
 */
function activeModPoints(combatant: Combatant, kind: ModifierKind): number {
  let total = 0;
  for (const effect of combatant.effects) {
    if (effect.type === "mod" && effect.kind === kind) total += effect.amount ?? 0;
  }
  return total;
}

function activeModPct(combatant: Combatant, kind: ModifierKind): number {
  return activeModPoints(combatant, kind) / 100;
}

function damageDealtMultiplier(actor: Combatant): number {
  let value =
    1 +
    clamp(modPct(actor, "damageDealt"), COMBAT_CONSTANTS.damageModMin, COMBAT_CONSTANTS.damageModMax);
  // 低血狂怒：生命低于 40% 时出伤提高。
  if (actor.hooks.lowHpFuryPct > 0 && actor.hp / Math.max(1, actor.maxHp) < 0.4) {
    value *= 1 + actor.hooks.lowHpFuryPct;
  }
  return value;
}

function damageTakenMultiplier(target: Combatant): number {
  return 1 + clamp(modPct(target, "damageTaken"), COMBAT_CONSTANTS.damageModMin, COMBAT_CONSTANTS.damageModMax);
}

function critChanceOf(actor: Combatant, skill: Skill, target: Combatant): number {
  const base = skillCritChance(actor.critChance, skillBaseCritRate(skill));
  const wound = target.effects.find((effect) => effect.type === "wound")?.stacks ?? 0;
  return Math.max(0, base + activeModPct(actor, "crit") + wound * 0.05);
}

/** 每层暴击的额外伤害：基础 +50% + 暴击伤害修正。 */
function critBonusPerTier(actor: Combatant): number {
  return COMBAT_CONSTANTS.critDamagePerTier + clamp(modPct(actor, "critDamage"), -0.5, 1.3);
}

function lifestealOf(actor: Combatant): number {
  return clamp(modPct(actor, "lifesteal"), 0, 1);
}

function energyRegenOf(actor: Combatant): number {
  let regen = COMBAT_CONSTANTS.energyRegenBase + modPoints(actor, "energyRegen");
  // 低蓝涌动：法力低于 30% 时额外回蓝。
  if (actor.hooks.energySurgeRegen > 0 && actor.energy / Math.max(1, actor.maxEnergy) < 0.3) {
    regen += actor.hooks.energySurgeRegen;
  }
  return regen;
}

/** 技能实际法力消耗（含耗蓝钩子），AI 可用性判断与实际扣蓝共用。 */
function skillEnergyCost(actor: Combatant, skill: Skill): number {
  const cost = Math.round(skill.energyCost * (1 + actor.hooks.energyCostPct));
  return Math.max(0, cost);
}

/** 通道抗性：物理只走护甲，元素/混沌走对应抗性。 */
function resistOf(target: Combatant, damageType: DamageType): number {
  const channel = damageChannel(damageType);
  if (channel === "physical") return 0;
  const base = channel === "elemental" ? (target.resistances.elemental ?? 0) : (target.resistances.chaos ?? 0);
  const fromMods =
    channel === "elemental"
      ? activeModPct(target, "elementalResist")
      : activeModPct(target, "chaosResist");
  return clamp(base + fromMods, COMBAT_CONSTANTS.resistMin, COMBAT_CONSTANTS.resistMax);
}

/** 命中评分对闪避评分的实际命中率；技能基础命中相对 90% 基准偏移。 */
function hitChanceFor(actor: Combatant, target: Combatant, skill: Skill): number {
  const hit = Math.max(0, actor.hit + activeModPoints(actor, "hit"));
  const evasion = Math.max(0, target.evasion + activeModPoints(target, "evasion"));
  return applySkillHitBase(hitChanceFromRatings(hit, evasion), skillBaseHitRate(skill));
}

function isAlive(combatant: Combatant): boolean {
  return !combatant.downed && combatant.hp > 0;
}

function hpRatio(combatant: Combatant): number {
  return combatant.hp / combatant.maxHp;
}

function hasEffect(combatant: Combatant, sourceId: string): boolean {
  return combatant.effects.some((effect) => effect.sourceSkillId === sourceId);
}

/** 麻痹：每次行为有 25% 概率被取消。 */
function actionCanceledByParalysis(
  actor: Combatant,
  rng: Rng,
  entries: CombatLogEntry[],
  round: number,
): boolean {
  if (!actor.effects.some((effect) => effect.type === "paralysis")) return false;
  if (!rng.chance(0.25)) return false;
  log(
    entries,
    round,
    "debuff",
    `${actor.name} 因【麻痹】行动被取消。`,
    undefined,
    { target: participantOf(actor) },
  );
  return true;
}

function log(
  entries: CombatLogEntry[],
  round: number,
  kind: CombatLogEntry["kind"],
  text: string,
  amount?: number,
  extra?: Partial<CombatLogEntry>,
): CombatLogEntry {
  const entry: CombatLogEntry = {
    round,
    kind,
    text,
    ...(amount === undefined ? {} : { amount }),
    ...extra,
  };
  entries.push(entry);
  return entry;
}

function participantOf(combatant: Combatant): CombatLogParticipant {
  return { id: combatant.id, name: combatant.name, side: combatant.side };
}

function rangeOf(skill: Skill): "melee" | "ranged" | "magic" {
  if (skill.range) return skill.range;
  return isPhysicalDamageType(skill.damageType ?? "crushing") ? "melee" : "magic";
}

function isCaster(combatant: Combatant): boolean {
  return combatant.skills.some((skill) => rangeOf(skill) === "magic" || skill.kind === "heal");
}

function pickByPriority(
  pool: Combatant[],
  priority: TargetPriority,
  rng: Rng,
): Combatant | null {
  if (pool.length === 0) return null;
  if (priority === "lowest-hp") {
    return (
      [...pool].sort(
        (a, b) => hpRatio(a) - hpRatio(b) || a.hp - b.hp || a.id.localeCompare(b.id),
      )[0] ?? null
    );
  }
  if (priority === "strongest") {
    return (
      [...pool].sort(
        (a, b) => b.maxHp - a.maxHp || b.level - a.level || a.id.localeCompare(b.id),
      )[0] ?? null
    );
  }
  if (priority === "caster") {
    const casters = pool.filter(isCaster);
    if (casters.length > 0) return rng.pick(casters);
    return pickByPriority(pool, "lowest-hp", rng);
  }
  return rng.pick(pool);
}

export function chooseTargets(
  actor: Combatant,
  skill: Skill | null,
  allies: Combatant[],
  enemies: Combatant[],
  rng: Rng,
  priority: TargetPriority = "nearest",
): Combatant[] {
  const livingAllies = allies.filter(isAlive);
  const livingEnemies = enemies.filter(isAlive);

  // 睡眠是控制：行动在回合开始被跳过（见 settleRoundStart），不再有随机攻击目标行为。

  const targetsEnemies =
    !skill || skill.kind === "attack" || skill.target === "enemy" || skill.target === "all-enemies";
  if (targetsEnemies) {
    const targetType = skill?.target ?? "enemy";
    if (targetType === "all-enemies") return livingEnemies;
    if (livingEnemies.length === 0) return [];

    // 技能形态改变：单体攻击技能扩散为全体。
    if (skill && skill.kind === "attack" && skill.target === "enemy" && actor.hooks.spreadSingleTarget) {
      return livingEnemies;
    }

    // 嘲讽：被嘲讽者的非魔法攻击强制指向嘲讽者（无视站位拉扯）。
    const taunted = !skill || (skill.kind === "attack" && rangeOf(skill) !== "magic");
    if (taunted) {
      const taunt = actor.effects.find((effect) => effect.type === "taunt");
      if (taunt) {
        const taunter = livingEnemies.find((enemy) => enemy.name === taunt.sourceName);
        if (taunter) return [taunter];
      }
    }

    const melee = !skill || (skill.kind === "attack" && rangeOf(skill) === "melee");
    const frontAlive = livingEnemies.some((enemy) => enemy.position === "front");
    const exposedFlanks = livingEnemies.filter(
      (enemy) => enemy.position === "flank" && enemy.flankExposed,
    );
    const exposedIds = new Set(exposedFlanks.map((enemy) => enemy.id));
    let pool = livingEnemies;

    if (melee) {
      if (actor.hooks.ignoresEnemyFormation || !frontAlive) {
        // 越过阵型钩子，或敌方前排已破：近战可攻击任意目标。
        pool = livingEnemies;
      } else if (actor.position === "flank") {
        // 游走近战可绕过存活的前排；默认优先攻击非前排。
        const nonFront = livingEnemies.filter((enemy) => enemy.position !== "front");
        pool =
          priority === "nearest" && nonFront.length > 0
            ? nonFront
            : livingEnemies;
      } else {
        // 普通近战只能打前排，以及已经暴露的游走单位。
        pool = livingEnemies.filter(
          (enemy) => enemy.position === "front" || exposedIds.has(enemy.id),
        );
      }
    } else if (priority === "nearest" && frontAlive) {
      // 远程/魔法的“最近目标”仍优先前排；暴露的游走可被任何攻击选中。
      pool = [
        ...livingEnemies.filter((enemy) => enemy.position === "front"),
        ...exposedFlanks,
      ];
    }
    if (pool.length === 0) return [];
    const target = pickByPriority(pool, priority, rng);
    return target ? [target] : [];
  }

  if (skill.target === "all-allies") return livingAllies;
  if (skill.target === "self") return [actor].filter(isAlive);
  const lowest = [...livingAllies].sort((a, b) => hpRatio(a) - hpRatio(b))[0];
  return lowest ? [lowest] : [];
}

/** 某阶段可用的技能：设置中的顺序优先，其余按技能面板顺序。 */
function orderedSkillsForPhase(actor: Combatant, phase: SkillPhase): Skill[] {
  const configured = actor.settings?.phases?.[phase]?.skillIds ?? [];
  const ordered: Skill[] = [];
  const add = (skill: Skill) => {
    if (!skillPhases(skill).includes(phase)) return;
    if (ordered.some((row) => row.id === skill.id)) return;
    ordered.push(skill);
  };
  for (const id of configured) {
    const skill = actor.skills.find((row) => row.id === id);
    if (skill) add(skill);
  }
  for (const skill of actor.skills) add(skill);
  return ordered;
}

function chooseAction(
  actor: Combatant,
  allies: Combatant[],
  enemies: Combatant[],
  rng: Rng,
  phase: SkillPhase,
): Action | null {
  const priority =
    actor.settings?.phases?.[phase]?.targetPriority ??
    actor.settings?.targetPriority ??
    "nearest";

  // 沉默：无法使用技能，主回合只能普攻。
  if (actor.effects.some((effect) => effect.type === "silence")) {
    if (phase !== "main") return null;
    const targets = chooseTargets(actor, null, allies, enemies, rng, priority);
    return targets.length > 0 ? { skill: actor.basic, targets } : null;
  }

  interface Candidate {
    action: Action;
    score: number;
    order: number;
  }
  const candidates: Candidate[] = [];
  const pushAttack = (skill: Skill, targets: Combatant[], order: number): void => {
    // 期望总伤害：多目标按各自期望伤害求和；单体扩散按惩罚系数下调（与执行管线一致）。
    const totalDamage = targets.reduce(
      (sum, target) => sum + expectedDamageOf(actor, target, skill),
      0,
    );
    const spreadPenalty =
      skill.target === "enemy" && targets.length > 1 && actor.hooks.spreadSingleTarget
        ? 1 + actor.hooks.spreadPenaltyPct
        : 1;
    const multiBonus =
      targets.length > 1 ? 1 + actor.hooks.multiTargetBonusPct * (targets.length - 1) : 1;
    const expected = totalDamage * spreadPenalty * multiBonus;
    const energyCost = skillEnergyCost(actor, skill);
    // 法力为零的普攻天然高效；付费技能按“期望伤害 + 法力效率”综合评分。
    const efficiency = expected / Math.max(1, energyCost * 0.6);
    const vulnerable = targets.filter(
      (target) => target.hp <= Math.max(1, target.maxHp * 0.25),
    ).length;
    candidates.push({
      action: { skill, targets },
      score: expected * 0.5 + efficiency * 12 + vulnerable * 30,
      order,
    });
  };

  // 普攻始终是候选（零法力兜底），和付费技能在同一评分体系下比较。
  const basicTargets = chooseTargets(actor, actor.basic, allies, enemies, rng, priority);
  if (basicTargets.length > 0) pushAttack(actor.basic, basicTargets, -1);

  for (const [order, skill] of orderedSkillsForPhase(actor, phase).entries()) {
    if ((actor.cooldowns[skill.id] ?? 0) > 0) continue;
    if (actor.energy < skillEnergyCost(actor, skill)) continue;
    if (!skillUsableWithWeapon(skill, actor.weaponType)) continue;

    const targets = chooseTargets(actor, skill, allies, enemies, rng, priority);
    if (targets.length === 0) continue;

    if (skill.kind === "heal") {
      const lowestRatio = Math.min(...allies.filter(isAlive).map(hpRatio));
      if (lowestRatio > 0.8) continue;
      const missingHp = targets.reduce(
        (sum, target) => sum + Math.max(0, target.maxHp - target.hp),
        0,
      );
      candidates.push({ action: { skill, targets }, score: missingHp * 0.5 + targets.length * 8, order });
    } else if (skill.kind === "buff") {
      if (targets.every((target) => hasEffect(target, skill.id))) continue;
      candidates.push({ action: { skill, targets }, score: 18 + targets.length * 4, order });
    } else {
      pushAttack(skill, targets, order);
    }
  }

  const best = candidates.sort((a, b) => b.score - a.score || a.order - b.order)[0];
  if (best) return best.action;
  if (phase !== "main") return null;
  const targets = chooseTargets(actor, null, allies, enemies, rng, priority);
  if (targets.length === 0) return null;
  return { skill: actor.basic, targets };
}

function skillLevelOf(actor: Combatant, skill: Skill): number {
  const bonus =
    skill.kind === "attack"
      ? actor.hooks.skillLevelBonus.attack
      : skill.kind === "heal"
        ? actor.hooks.skillLevelBonus.heal
        : actor.hooks.skillLevelBonus.buff;
  return Math.max(1, actor.skillLevels[skill.id] ?? 1) + bonus;
}

/**
 * 期望伤害估算：复刻 attackRoll 的管线（不含 RNG 判定），返回按命中概率加权的期望伤害。
 * AI 用它与普攻在同一把尺子下比较技能。
 */
function expectedDamageOf(actor: Combatant, target: Combatant, skill: Skill): number {
  const hitChance = hitChanceFor(actor, target, skill);
  const damageType = skill.damageType ?? "crushing";
  const physical = isPhysicalDamageType(damageType);

  // 量级与 attackRoll 一致：power + levelScale×等级 + weaponScale×攻击力，乘等级倍率与增伤。
  const magnitude =
    (skill.power + skill.levelScale * actor.level + skill.weaponScale * actor.attackPower) *
    skillMagnitudeMultiplier(skillLevelOf(actor, skill)) *
    (1 + actor.hooks.skillPowerPct);

  // 处决/异常协同按目标当前状态计入期望。
  const ratio = target.hp / Math.max(1, target.maxHp);
  const executed = skill.executeThreshold !== undefined && ratio <= skill.executeThreshold;
  const ailmentSynergy = Boolean(
    skill.ailmentBonusPct &&
      target.effects.some((effect) => effect.type === ailmentForDamageType(damageType)),
  );
  const synergyMultiplier =
    1 + (executed ? (skill.executeBonusPct ?? 0) : 0) + (ailmentSynergy ? (skill.ailmentBonusPct ?? 0) : 0);

  let raw =
    magnitude *
    synergyMultiplier *
    actor.damageMultiplier *
    damageDealtMultiplier(actor) *
    damageTakenMultiplier(target);

  // 暴击期望：每次判定成功乘 (1 + critBonus)；逐层近似为乘法因子。
  const backline = Boolean(actor.trait?.backlineHunter && target.position === "back");
  const critChance =
    (backline ? (actor.trait?.backlineHunter?.critBonus ?? 0) / 100 : 0) +
    critChanceOf(actor, skill, target);
  let remainingCrit = critChance;
  let critFactor = 1;
  while (remainingCrit > 0 && critFactor < 100) {
    const probability = Math.min(1, remainingCrit);
    critFactor *= 1 + probability * critBonusPerTier(actor);
    remainingCrit -= 1;
    if (probability >= 1) break;
  }
  raw *= critFactor;

  // 物理/抗性减伤与 attackRoll 一致。
  if (physical) {
    const armor = Math.max(0, target.armor + activeModPoints(target, "armor"));
    raw *= 1 - physicalDamageReduction(armor, raw);
  }
  raw *= 1 - resistOf(target, damageType);

  return Math.max(0, raw) * hitChance;
}

/** 护盾总量：不同来源的护盾叠加，同源刷新取最大。 */
function shieldValueOf(target: Combatant): number {
  return target.effects.reduce((sum, effect) => {
    return effect.type === "shield" ? sum + (effect.value ?? 0) : sum;
  }, 0);
}

interface DamageApplication {
  /** 实际进入生命的伤害（护盾吸收后）。 */
  hpDamage: number;
  /** 护盾吸收的部分。 */
  absorbed: number;
}

/** 扣血统一入口：护盾先吸收，再扣生命；调用方负责写日志与击倒判定。 */
function applyDamage(target: Combatant, amount: number): DamageApplication {
  const shieldBefore = shieldValueOf(target);
  const absorbed = Math.min(shieldBefore, amount);
  if (absorbed > 0) {
    let remaining = absorbed;
    // 先扣先施加的护盾，保持时序直观。
    for (const effect of target.effects) {
      if (effect.type !== "shield" || remaining <= 0) continue;
      const drain = Math.min(effect.value ?? 0, remaining);
      effect.value = (effect.value ?? 0) - drain;
      remaining -= drain;
    }
    target.effects = target.effects.filter((effect) => effect.type !== "shield" || (effect.value ?? 0) > 0);
  }
  const hpDamage = amount - absorbed;
  target.hp = Math.max(0, target.hp - hpDamage);
  return { hpDamage, absorbed };
}

/** 技能异常效率：技能基础值 + 角色常驻异常效率，最低 0。 */
function skillAilmentEfficiency(actor: Combatant, skill: Skill): number {
  return Math.max(
    0,
    (skill.ailmentEfficiency ?? 2) +
      actor.ailmentEfficiencyBonus +
      modPoints(actor, "ailmentEfficiency"),
  );
}

/** 伤害积累异常值；满值时触发对应异常并清零。 */
function accumulateAilment(
  entries: CombatLogEntry[],
  round: number,
  actor: Combatant,
  target: Combatant,
  skill: Skill,
  damage: number,
  actionId: string,
  ailmentMultiplier = 1,
): CombatLogAilmentProgress | undefined {
  if (damage <= 0 || !isAlive(target)) return undefined;
  const damageType = skill.damageType ?? "crushing";
  const ailment = ailmentForDamageType(damageType);
  const resistance = clamp(modPct(target, "ailmentResistance"), -0.5, 0.8);
  const gain = Math.max(
    0,
    Math.round(
      damage *
        skillAilmentEfficiency(actor, skill) *
        (1 - resistance) *
        ailmentMultiplier,
    ),
  );
  if (gain <= 0) return undefined;
  const before = target.ailments[ailment];
  const threshold = target.maxHp;
  const accumulated = before + gain;
  const triggered = accumulated >= threshold;
  target.ailments[ailment] = triggered ? 0 : accumulated;
  if (triggered) triggerAilment(entries, round, actor, target, ailment, skill, actionId);
  return {
    ailment,
    delta: gain,
    before,
    after: target.ailments[ailment],
    threshold,
    triggered,
  };
}

/** 触发异常状态。同类异常按各自规则叠加/刷新。 */
function triggerAilment(
  entries: CombatLogEntry[],
  round: number,
  actor: Combatant,
  target: Combatant,
  ailment: Ailment,
  skill: Skill,
  actionId: string,
): void {
  const sourceSkillId = `ailment:${ailment}`;
  const sourceSkillName = AILMENT_LABELS[ailment];
  const existing = target.effects.find((effect) => effect.type === ailment);
  const base = {
    uid: ++effectUid,
    sourceSkillId,
    sourceSkillName,
    sourceName: actor.name,
    type: ailment,
  } as const;

  switch (ailment) {
    case "burn": {
      const value = Math.max(1, Math.round(target.maxHp * 0.05));
      if (existing) {
        existing.remaining = Math.min(
          COMBAT_CONSTANTS.persistentAilmentMaxDuration,
          existing.remaining + 2,
        );
        existing.value = value;
      } else {
        target.effects.push({ ...base, value, remaining: 2 });
      }
      break;
    }
    case "freeze":
    case "stun": {
      if (existing) existing.remaining = Math.max(existing.remaining, 1);
      else target.effects.push({ ...base, remaining: 1 });
      break;
    }
    case "sleep": {
      // 内部给 2 回合，保证触发后的下一个完整回合仍处于睡眠；面板仍显示 1 回合。
      if (existing) existing.remaining = Math.max(existing.remaining, 2);
      else target.effects.push({ ...base, remaining: 2 });
      break;
    }
    case "paralysis": {
      // 内部多留 1 回合，抵消回合开始统一递减，保证 3 个完整回合的判定。
      if (existing) existing.remaining = Math.max(existing.remaining, 4);
      else target.effects.push({ ...base, remaining: 4 });
      break;
    }
    case "poison": {
      if (existing) {
        existing.stacks = Math.min(
          COMBAT_CONSTANTS.persistentAilmentMaxStacks,
          (existing.stacks ?? 1) + 1,
        );
        existing.remaining = COMBAT_CONSTANTS.persistentAilmentMaxDuration;
      } else {
        target.effects.push({ ...base, stacks: 1, remaining: COMBAT_CONSTANTS.persistentAilmentMaxDuration });
      }
      break;
    }
    case "wound": {
      if (existing) {
        existing.stacks = Math.min(
          COMBAT_CONSTANTS.persistentAilmentMaxStacks,
          (existing.stacks ?? 1) + 1,
        );
        existing.remaining = COMBAT_CONSTANTS.persistentAilmentMaxDuration;
      } else {
        target.effects.push({ ...base, stacks: 1, remaining: COMBAT_CONSTANTS.persistentAilmentMaxDuration });
      }
      break;
    }
    case "bleed": {
      if (existing) {
        existing.lastPhysicalRound = round;
        existing.remaining = COMBAT_CONSTANTS.persistentAilmentMaxDuration;
      } else {
        target.effects.push({
          ...base,
          lastPhysicalRound: round,
          remaining: COMBAT_CONSTANTS.persistentAilmentMaxDuration,
        });
      }
      break;
    }
  }

  log(
    entries,
    round,
    "debuff",
    `${target.name} 的异常值已满，触发【${AILMENT_LABELS[ailment]}】。`,
    undefined,
    {
      actionId,
      actor: participantOf(actor),
      target: participantOf(target),
      actionName: skill.name,
      effect: {
        type: ailment,
        duration: ailment === "burn" ? 2 : ailment === "paralysis" ? 3 : 1,
        stacks: target.effects.find((effect) => effect.type === ailment)?.stacks,
      },
    },
  );
}

interface AttackOutcome {
  damage: number;
  crit: boolean;
  /** 暴击判定成功次数；>1 表示多重暴击。 */
  critTiers: number;
  /** 本次攻击的异常积累倍率：每次暴击 +100%。 */
  ailmentMultiplier: number;
  /** 是否触发处决增伤。 */
  executed: boolean;
  /** 是否触发异常协同增伤。 */
  ailmentSynergy: boolean;
  missed: boolean;
  hitChance: number;
  critChance: number;
}

/**
 * 伤害管线：
 * 量级(power + levelScale×英雄等级 + weaponScale×攻击力) × 等级倍率
 * × (1 + 出伤修正) × (1 + 承伤修正)
 * → 暴击（每次判定 +50% 伤害，溢出的暴击率继续判定）
 * → 物理吃护甲减免，元素/混沌吃对应抗性。
 * 命中/暴击都是百分比判定，不再有攻防骰、独立闪避骰或伤害浮动。
 */
function attackRoll(
  actor: Combatant,
  target: Combatant,
  skill: Skill,
  rng: Rng,
): AttackOutcome {
  const hitChance = hitChanceFor(actor, target, skill);
  const backline = Boolean(actor.trait?.backlineHunter && target.position === "back");
  const critChance = backline
    ? Math.max(
        0,
        critChanceOf(actor, skill, target) +
          (actor.trait?.backlineHunter?.critBonus ?? 0) / 100,
      )
    : critChanceOf(actor, skill, target);
  if (!rng.chance(hitChance)) {
    return {
      damage: 0,
      crit: false,
      critTiers: 0,
      ailmentMultiplier: 1,
      executed: false,
      ailmentSynergy: false,
      missed: true,
      hitChance,
      critChance,
    };
  }

  const damageType = skill.damageType ?? "crushing";
  const physical = isPhysicalDamageType(damageType);
  const executed = Boolean(
    skill.executeThreshold !== undefined &&
      target.hp / Math.max(1, target.maxHp) <= skill.executeThreshold,
  );
  const targetAilment = ailmentForDamageType(damageType);
  const ailmentSynergy = Boolean(
    skill.ailmentBonusPct &&
      target.effects.some((effect) => effect.type === targetAilment),
  );
  const synergyMultiplier =
    1 +
    (executed ? (skill.executeBonusPct ?? 0) : 0) +
    (ailmentSynergy ? (skill.ailmentBonusPct ?? 0) : 0);
  const magnitude =
    (skill.power + skill.levelScale * actor.level + skill.weaponScale * actor.attackPower) *
    skillMagnitudeMultiplier(skillLevelOf(actor, skill)) *
    (1 + actor.hooks.skillPowerPct) *
    synergyMultiplier;
  let raw =
    magnitude *
    actor.damageMultiplier *
    damageDealtMultiplier(actor) *
    damageTakenMultiplier(target);

  // 暴击率超过 100% 时，先必定暴击，溢出部分继续判定；每次成功都叠一层暴击。
  let critTiers = 0;
  let remainingCrit = critChance;
  while (remainingCrit > 0 && critTiers < 100) {
    if (!rng.chance(Math.min(1, remainingCrit))) break;
    critTiers += 1;
    remainingCrit -= 1;
  }
  if (critTiers > 0) {
    raw *= 1 + critTiers * critBonusPerTier(actor);
  }

  let damage = raw;
  if (physical) {
    const armor = Math.max(0, target.armor + activeModPoints(target, "armor"));
    damage *= 1 - physicalDamageReduction(armor, damage);
  }
  damage *= 1 - resistOf(target, damageType);
  return {
    damage: Math.max(1, Math.round(damage)),
    crit: critTiers > 0,
    critTiers,
    ailmentMultiplier: 1 + critTiers,
    executed,
    ailmentSynergy,
    missed: false,
    hitChance,
    critChance,
  };
}

/**
 * 高处切入：命中后排后叠加一层闪避/暴击，持续到下一回合。
 * 效果按层数相加，达到 maxStacks 后不再叠加。
 */
function applyBacklineTrait(
  actor: Combatant,
  target: Combatant,
  entries: CombatLogEntry[],
  round: number,
  actionId: string,
): void {
  const trait = actor.trait;
  if (!trait || target.position !== "back") return;
  const stacks = actor.effects.filter(
    (effect) => effect.sourceSkillId === trait.id && effect.kind === "evasion",
  ).length;
  if (stacks >= trait.backlineHunter.maxStacks) return;
  const duration = trait.backlineHunter.duration;
  actor.effects.push(
    {
      uid: ++effectUid,
      sourceSkillId: trait.id,
      sourceSkillName: trait.name,
      sourceName: actor.name,
      type: "mod",
      kind: "evasion",
      amount: trait.backlineHunter.evasionBonus,
      remaining: duration,
    },
    {
      uid: ++effectUid,
      sourceSkillId: trait.id,
      sourceSkillName: trait.name,
      sourceName: actor.name,
      type: "mod",
      kind: "crit",
      amount: trait.backlineHunter.critBonus,
      remaining: duration,
    },
  );
  log(
    entries,
    round,
    "buff",
    `${actor.name} 的【${trait.name}】生效：闪避 +${trait.backlineHunter.evasionBonus}、暴击 +${trait.backlineHunter.critBonus}，持续 1 回合（${stacks + 1} 层）。`,
    undefined,
    {
      actionId,
      actor: participantOf(actor),
      target: participantOf(actor),
      actionName: trait.name,
    },
  );
}

function modLogEffect(effect: ActiveEffect) {
  return {
    type: "mod" as const,
    kind: effect.kind,
    amount: effect.amount,
    duration: effect.remaining,
  };
}

/** 写一条修正效果日志；kind 由对持有者是否有利决定。 */
function logModEffect(
  entries: CombatLogEntry[],
  round: number,
  source: Combatant,
  target: Combatant,
  effectName: string,
  active: ActiveEffect,
  extra: Partial<CombatLogEntry>,
): void {
  const kindLabel = active.kind ? MODIFIER_KIND_LABELS[active.kind] : "";
  const amountText = active.kind ? modifierAmountText(active.kind, active.amount ?? 0) : "";
  const beneficial = active.kind ? modifierBeneficial(active.kind, active.amount ?? 0) : true;
  const verb = beneficial ? "获得" : "陷入";
  log(
    entries,
    round,
    beneficial ? "buff" : "debuff",
    `${source.name} 的【${effectName}】使 ${target.name} ${verb}【${kindLabel} ${amountText}】，持续 ${active.remaining} 回合。`,
    undefined,
    {
      ...extra,
      effect: modLogEffect(active),
    },
  );
}

function activeLogEffect(active: ActiveEffect): CombatLogEffect {
  if (active.type === "mod") {
    return { type: "mod", kind: active.kind, amount: active.amount, duration: active.remaining };
  }
  if (active.type === "dot") {
    return { type: "dot", damage: active.value, damageType: active.damageType, duration: active.remaining };
  }
  if (active.type === "hot") {
    return { type: "hot", damage: active.value, duration: active.remaining };
  }
  if (active.type === "shield") {
    return { type: "shield", value: active.value, duration: active.remaining };
  }
  if (active.type === "reflect") {
    return { type: "reflect", percent: active.percent, duration: active.remaining };
  }
  return { type: active.type, duration: active.remaining };
}

/** 该效果对持有者是否有害（决定是否触发减益对抗）。 */
function isHarmfulEffect(active: ActiveEffect): boolean {
  if (active.type === "dot" || active.type === "stun" || active.type === "silence" || active.type === "taunt") {
    return true;
  }
  if (active.type === "mod" && active.kind) {
    return !modifierBeneficial(active.kind, active.amount ?? 0);
  }
  return false;
}

interface ResolvedIncomingEffect {
  recipient: Combatant;
  active: ActiveEffect;
  altered: "none" | "inverted" | "reflected";
}

/**
 * 减益对抗统一入口：负面效果落到目标身上前依次判定
 * 1) 负修正反转成增益（invertDebuffSign）
 * 2) 概率反弹给施加者（debuffReflectChance）
 * 3) 持续回合缩短（debuffDurationReduction，最短 1）
 */
function resolveIncomingEffect(
  entries: CombatLogEntry[],
  round: number,
  source: Combatant,
  target: Combatant,
  label: string,
  active: ActiveEffect,
  rng: Rng,
  extra: Partial<CombatLogEntry>,
): ResolvedIncomingEffect {
  if (!isHarmfulEffect(active)) return { recipient: target, active, altered: "none" };
  const hooks = target.hooks;

  if (hooks.invertDebuffSign && active.type === "mod") {
    const flipped: ActiveEffect = { ...active, amount: -(active.amount ?? 0) };
    log(
      entries,
      round,
      "buff",
      `${target.name} 将 ${source.name} 的【${label}】负修正【反转】成了增益。`,
      undefined,
      { ...extra, target: participantOf(target), effect: activeLogEffect(flipped) },
    );
    return { recipient: target, active: flipped, altered: "inverted" };
  }

  if (hooks.debuffReflectChance > 0 && source !== target && rng.chance(hooks.debuffReflectChance)) {
    log(
      entries,
      round,
      "buff",
      `${target.name} 的过往经历将 ${source.name} 的【${label}】原样【反弹】了回去。`,
      undefined,
      { ...extra, target: participantOf(source), effect: activeLogEffect(active) },
    );
    return { recipient: source, active, altered: "reflected" };
  }

  if (hooks.debuffDurationReduction > 0) {
    return {
      recipient: target,
      active: {
        ...active,
        remaining: Math.max(1, active.remaining - hooks.debuffDurationReduction),
      },
      altered: "none",
    };
  }
  return { recipient: target, active, altered: "none" };
}

/** 同源同类刷新：mod/dot/hot/reflect/taunt 刷新，shield 取最大。 */
function upsertEffect(target: Combatant, next: ActiveEffect): boolean {
  const existing = target.effects.find(
    (effect) => effect.sourceSkillId === next.sourceSkillId && effect.type === next.type &&
      (next.type !== "mod" || effect.kind === next.kind),
  );
  if (existing) {
    if (next.type === "shield") {
      existing.value = Math.max(existing.value ?? 0, next.value ?? 0);
      existing.remaining = Math.max(existing.remaining, next.remaining);
    } else {
      existing.amount = next.amount;
      existing.value = next.value;
      existing.percent = next.percent;
      existing.remaining = next.remaining;
    }
    return false;
  }
  target.effects.push(next);
  return true;
}

/**
 * 施加一个技能效果组件。
 * attack 技能上：正修正给自己，负修正/dot/stun/silence/taunt 给目标，shield/reflect 给自己。
 * heal/buff 技能上：全部给目标。
 */
function applySkillEffect(
  entries: CombatLogEntry[],
  round: number,
  source: Combatant,
  target: Combatant,
  skill: Skill,
  effect: Effect,
  rng: Rng,
  actionId: string,
): void {
  const extra = {
    actionId,
    actor: participantOf(source),
    target: participantOf(target),
    actionName: skill.name,
  };
  const level = skillLevelOf(source, skill);
  const scalingValue = source.level;
  const magnitude = skillMagnitudeMultiplier(level);

  const toSelf =
    skill.kind === "attack" &&
    ((effect.type === "mod" && (effect.base + effect.perLevel * scalingValue) >= 0) ||
      effect.type === "shield" ||
      effect.type === "hot" ||
      effect.type === "reflect");
  const recipient = toSelf ? source : target;
  const recipientExtra = toSelf
    ? { ...extra, target: participantOf(source) }
    : extra;

  switch (effect.type) {
    case "mod": {
      const base = effect.base + effect.perLevel * scalingValue;
      // 百分比类：每技能等级 +1 个百分点；平值类：吃技能量级倍率。
      const amount = isPctModifierKind(effect.kind)
        ? Math.round(base * 10) / 10 + skillModBonusPerLevel(level)
        : Math.round(base * magnitude);
      if (amount === 0) return;
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: skill.id,
        sourceSkillName: skill.name,
        sourceName: source.name,
        type: "mod",
        kind: effect.kind,
        amount,
        remaining: effect.duration,
      };
      const resolved = resolveIncomingEffect(
        entries,
        round,
        source,
        recipient,
        skill.name,
        active,
        rng,
        recipientExtra,
      );
      upsertEffect(resolved.recipient, resolved.active);
      if (resolved.altered === "none") {
        logModEffect(entries, round, source, resolved.recipient, skill.name, resolved.active, recipientExtra);
      }
      return;
    }
    case "dot": {
      const potency = 1 + clamp(modPct(source, "dotPotency"), COMBAT_CONSTANTS.damageModMin, COMBAT_CONSTANTS.damageModMax);
      const value = Math.max(
        1,
        Math.round(
          (effect.base + effect.perLevel * scalingValue) *
            magnitude *
            potency *
            (1 + source.hooks.skillPowerPct),
        ),
      );
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: skill.id,
        sourceSkillName: skill.name,
        sourceName: source.name,
        type: "dot",
        value,
        damageType: effect.damageType,
        remaining: effect.duration,
      };
      const resolved = resolveIncomingEffect(
        entries,
        round,
        source,
        recipient,
        skill.name,
        active,
        rng,
        recipientExtra,
      );
      upsertEffect(resolved.recipient, resolved.active);
      if (resolved.altered === "none") {
        log(
          entries,
          round,
          "debuff",
          `${resolved.recipient.name} 中了 ${source.name} 的【${skill.name}】，每回合受到 ${resolved.active.value} 点${DAMAGE_TYPE_LABELS[effect.damageType]}伤害。`,
          undefined,
          {
            ...recipientExtra,
            target: participantOf(resolved.recipient),
            effect: activeLogEffect(resolved.active),
          },
        );
      }
      return;
    }
    case "hot": {
      const healing = 1 + clamp(modPct(source, "healing"), COMBAT_CONSTANTS.damageModMin, COMBAT_CONSTANTS.damageModMax);
      const value = Math.max(
        1,
        Math.round(
          (effect.base + effect.perLevel * scalingValue) *
            magnitude *
            healing *
            (1 + source.hooks.skillPowerPct),
        ),
      );
      upsertEffect(recipient, {
        uid: ++effectUid,
        sourceSkillId: skill.id,
        sourceSkillName: skill.name,
        sourceName: source.name,
        type: "hot",
        value,
        remaining: effect.duration,
      });
      log(
        entries,
        round,
        "buff",
        `${recipient.name} 获得 ${source.name} 的【${skill.name}】持续治疗，每回合恢复 ${value} 点生命，持续 ${effect.duration} 回合。`,
        undefined,
        { ...recipientExtra, effect: { type: "hot", damage: value, duration: effect.duration } },
      );
      return;
    }
    case "shield": {
      const value = Math.max(
        1,
        Math.round(
          (effect.base + effect.perLevel * scalingValue) *
            magnitude *
            (1 + source.hooks.skillPowerPct),
        ),
      );
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: skill.id,
        sourceSkillName: skill.name,
        sourceName: source.name,
        type: "shield",
        value,
        remaining: effect.duration,
      };
      upsertEffect(recipient, active);
      log(
        entries,
        round,
        "buff",
        `${recipient.name} 获得 ${source.name} 的【${skill.name}】护盾，可吸收 ${value} 点伤害，持续 ${effect.duration} 回合。`,
        undefined,
        { ...recipientExtra, effect: { type: "shield", value, duration: effect.duration } },
      );
      return;
    }
    case "stun": {
      if (!rng.chance(effect.chance)) return;
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: skill.id,
        sourceSkillName: skill.name,
        sourceName: source.name,
        type: "stun",
        remaining: effect.duration,
      };
      const resolved = resolveIncomingEffect(entries, round, source, recipient, skill.name, active, rng, recipientExtra);
      upsertEffect(resolved.recipient, resolved.active);
      if (resolved.altered === "none") {
        log(
          entries,
          round,
          "debuff",
          `${resolved.recipient.name} 被 ${source.name} 的【${skill.name}】击晕，持续 ${resolved.active.remaining} 回合。`,
          undefined,
          { ...recipientExtra, target: participantOf(resolved.recipient), effect: activeLogEffect(resolved.active) },
        );
      }
      return;
    }
    case "silence": {
      if (!rng.chance(effect.chance)) return;
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: skill.id,
        sourceSkillName: skill.name,
        sourceName: source.name,
        type: "silence",
        remaining: effect.duration,
      };
      const resolved = resolveIncomingEffect(entries, round, source, recipient, skill.name, active, rng, recipientExtra);
      upsertEffect(resolved.recipient, resolved.active);
      if (resolved.altered === "none") {
        log(
          entries,
          round,
          "debuff",
          `${resolved.recipient.name} 被 ${source.name} 的【${skill.name}】沉默，${resolved.active.remaining} 回合内无法使用技能。`,
          undefined,
          { ...recipientExtra, target: participantOf(resolved.recipient), effect: activeLogEffect(resolved.active) },
        );
      }
      return;
    }
    case "taunt": {
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: skill.id,
        sourceSkillName: skill.name,
        sourceName: source.name,
        type: "taunt",
        remaining: effect.duration,
      };
      const resolved = resolveIncomingEffect(entries, round, source, recipient, skill.name, active, rng, recipientExtra);
      upsertEffect(resolved.recipient, resolved.active);
      if (resolved.altered === "none") {
        log(
          entries,
          round,
          "debuff",
          `${resolved.recipient.name} 被 ${source.name} 的【${skill.name}】嘲讽，${resolved.active.remaining} 回合内只能攻击 ${source.name}。`,
          undefined,
          { ...recipientExtra, target: participantOf(resolved.recipient), effect: activeLogEffect(resolved.active) },
        );
      }
      return;
    }
    case "reflect": {
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: skill.id,
        sourceSkillName: skill.name,
        sourceName: source.name,
        type: "reflect",
        percent: effect.percent,
        remaining: effect.duration,
      };
      upsertEffect(recipient, active);
      log(
        entries,
        round,
        "buff",
        `${recipient.name} 获得 ${source.name} 的【${skill.name}】反伤屏障，${effect.duration} 回合内反弹 ${Math.round(effect.percent * 100)}% 所受伤害。`,
        undefined,
        { ...recipientExtra, effect: { type: "reflect", percent: effect.percent, duration: effect.duration } },
      );
      return;
    }
  }
}

/** 触发装备特效词条（onHit/onCrit/onHurt/onKill）。 */
function triggerItemEffects(
  entries: CombatLogEntry[],
  round: number,
  owner: Combatant,
  other: Combatant,
  trigger: ItemEffect["trigger"],
  rng: Rng,
  actionId: string,
): void {
  for (const itemEffect of owner.itemEffects) {
    if (itemEffect.trigger !== trigger) continue;
    if (!rng.chance(itemEffect.chance)) continue;
    const recipient = itemEffect.target === "self" ? owner : other;
    if (!isAlive(recipient)) continue;
    const { payload } = itemEffect;
    const extra = {
      actionId,
      actor: participantOf(owner),
      target: participantOf(recipient),
      actionName: itemEffect.sourceName,
    };
    if (payload.type === "dot") {
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: itemEffect.sourceId,
        sourceSkillName: itemEffect.sourceName,
        sourceName: owner.name,
        type: "dot",
        value: Math.max(1, Math.round(payload.base)),
        damageType: payload.damageType,
        remaining: payload.duration,
      };
      const resolved = resolveIncomingEffect(
        entries,
        round,
        owner,
        recipient,
        itemEffect.sourceName,
        active,
        rng,
        extra,
      );
      upsertEffect(resolved.recipient, resolved.active);
      if (resolved.altered === "none") {
        log(
          entries,
          round,
          "debuff",
          `${owner.name} 的【${itemEffect.sourceName}】${ITEM_EFFECT_TRIGGER_LABELS[trigger]}触发：${resolved.recipient.name} 每回合受到 ${resolved.active.value} 点${DAMAGE_TYPE_LABELS[payload.damageType]}伤害，持续 ${resolved.active.remaining} 回合。`,
          undefined,
          { ...extra, target: participantOf(resolved.recipient), effect: activeLogEffect(resolved.active) },
        );
      }
    } else if (payload.type === "mod") {
      if (payload.amount === 0) continue;
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: itemEffect.sourceId,
        sourceSkillName: itemEffect.sourceName,
        sourceName: owner.name,
        type: "mod",
        kind: payload.kind,
        amount: payload.amount,
        remaining: payload.duration,
      };
      const resolved = resolveIncomingEffect(
        entries,
        round,
        owner,
        recipient,
        itemEffect.sourceName,
        active,
        rng,
        extra,
      );
      upsertEffect(resolved.recipient, resolved.active);
      if (resolved.altered === "none") {
        logModEffect(entries, round, owner, resolved.recipient, itemEffect.sourceName, resolved.active, extra);
      }
    } else if (payload.type === "shield") {
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: itemEffect.sourceId,
        sourceSkillName: itemEffect.sourceName,
        sourceName: owner.name,
        type: "shield",
        value: Math.max(1, Math.round(payload.base)),
        remaining: payload.duration,
      };
      upsertEffect(recipient, active);
      log(
        entries,
        round,
        "buff",
        `${owner.name} 的【${itemEffect.sourceName}】${ITEM_EFFECT_TRIGGER_LABELS[trigger]}触发：${recipient.name} 获得吸收 ${active.value} 点伤害的护盾，持续 ${payload.duration} 回合。`,
        undefined,
        { ...extra, effect: { type: "shield", value: active.value, duration: payload.duration } },
      );
    } else if (payload.type === "reflect") {
      const active: ActiveEffect = {
        uid: ++effectUid,
        sourceSkillId: itemEffect.sourceId,
        sourceSkillName: itemEffect.sourceName,
        sourceName: owner.name,
        type: "reflect",
        percent: payload.percent,
        remaining: payload.duration,
      };
      upsertEffect(recipient, active);
      log(
        entries,
        round,
        "buff",
        `${owner.name} 的【${itemEffect.sourceName}】${ITEM_EFFECT_TRIGGER_LABELS[trigger]}触发：${recipient.name} 获得反伤屏障，${payload.duration} 回合内反弹 ${Math.round(payload.percent * 100)}% 所受伤害。`,
        undefined,
        { ...extra, effect: { type: "reflect", percent: payload.percent, duration: payload.duration } },
      );
    } else if (payload.type === "energy") {
      const energyBefore = recipient.energy;
      recipient.energy = Math.min(recipient.maxEnergy, recipient.energy + payload.amount);
      if (recipient.energy === energyBefore) continue;
      log(
        entries,
        round,
        "buff",
        `${owner.name} 的【${itemEffect.sourceName}】${ITEM_EFFECT_TRIGGER_LABELS[trigger]}触发：${recipient.name} 恢复 ${recipient.energy - energyBefore} 点法力。`,
        undefined,
        {
          ...extra,
          energyBefore,
          energyAfter: recipient.energy,
          maxEnergy: recipient.maxEnergy,
        },
      );
    }
  }
}

function executeAction(
  actor: Combatant,
  action: Action,
  entries: CombatLogEntry[],
  round: number,
  rng: Rng,
  totals: { damageDealt: number; damageTaken: number },
  phase: SkillPhase,
): void {
  const start = entries.length;
  const energyBefore = actor.energy;
  executeActionInner(actor, action, entries, round, rng, totals);
  const energyAfter = actor.energy;
  for (let index = start; index < entries.length; index += 1) {
    entries[index]!.phase = phase;
    entries[index]!.energyBefore = energyBefore;
    entries[index]!.energyAfter = energyAfter;
    entries[index]!.maxEnergy = actor.maxEnergy;
  }
}

function executeActionInner(
  actor: Combatant,
  action: Action,
  entries: CombatLogEntry[],
  round: number,
  rng: Rng,
  totals: { damageDealt: number; damageTaken: number },
): void {
  const { skill, targets } = action;
  const actionId = `action-${++actionUid}`;
  const actorRef = participantOf(actor);
  // 游走暴露持续到自己的下一次行动。
  actor.flankExposed = false;
  actor.energy -= skillEnergyCost(actor, skill);
  // +1 让“冷却 1”正好跳过下一回合，定义更直观；冷却缩减钩子在此生效。
  if (skill.cooldown > 0) {
    actor.cooldowns[skill.id] = Math.max(
      0,
      skill.cooldown + 1 - actor.hooks.cooldownReduction,
    );
  }

  if (skill.kind === "attack" && actor.position === "flank") {
    const nonFront = targets.find(
      (target) => target.side !== actor.side && target.position !== "front",
    );
    if (nonFront) {
      actor.flankExposed = true;
      log(
        entries,
        round,
        "system",
        `【游走】${actor.name} 突袭 ${nonFront.name}，在下次行动前暴露。`,
        undefined,
        {
          actionId,
          actor: actorRef,
          target: participantOf(nonFront),
          actionName: skill.name,
        },
      );
    }
  }

  if (skill.kind === "attack") {
    for (const target of targets) {
      if (!isAlive(target)) continue;
      const result = attackRoll(actor, target, skill, rng);
      const targetRef = participantOf(target);
      if (result.missed) {
        log(
          entries,
          round,
          "miss",
          `${actor.name} 施放【${skill.name}】，但未能命中 ${target.name}（命中率 ${Math.round(result.hitChance * 100)}%）。`,
          undefined,
          {
            actionId,
            actor: actorRef,
            target: targetRef,
            actionName: skill.name,
            hitChance: result.hitChance,
            hit: false,
            critChance: result.critChance,
            missReason: "hit-chance",
          },
        );
        continue;
      }
      // 群攻额外目标加成；单体技能被扩散时按惩罚系数下调。
      if (targets.length > 1) {
        const extraBonus = actor.hooks.multiTargetBonusPct * (targets.length - 1);
        const spreadPenalty =
          skill.target === "enemy" && actor.hooks.spreadSingleTarget
            ? actor.hooks.spreadPenaltyPct
            : 0;
        result.damage = Math.max(
          1,
          Math.round(result.damage * (1 + extraBonus + spreadPenalty)),
        );
      }
      const hpBefore = target.hp;
      const shieldBefore = shieldValueOf(target);
      const applied = applyDamage(target, result.damage);
      // 流血：每次受到物理伤害，额外失去本次伤害 5% 的生命；本次物理命中会刷新流血存续。
      let bleedExtra = 0;
      if (isPhysicalDamageType(skill.damageType ?? "crushing") && isAlive(target)) {
        const bleed = target.effects.find((effect) => effect.type === "bleed");
        if (bleed) {
          bleed.lastPhysicalRound = round;
          bleedExtra = Math.max(1, Math.round(result.damage * 0.05));
          target.hp = Math.max(0, target.hp - bleedExtra);
          if (actor.side === "hero") totals.damageDealt += bleedExtra;
          else totals.damageTaken += bleedExtra;
        }
      }
      const hpAfter = target.hp;
      const shieldAfter = shieldValueOf(target);
      if (actor.side === "hero") totals.damageDealt += result.damage;
      else totals.damageTaken += result.damage;

      // 吸血：按本次伤害结算（护盾吸收也算输出）。
      const lifesteal = lifestealOf(actor);
      let lifestealHeal = 0;
      if (lifesteal > 0) {
        lifestealHeal = Math.min(actor.maxHp - actor.hp, Math.max(0, Math.round(result.damage * lifesteal)));
        actor.hp += lifestealHeal;
      }

      const label = DAMAGE_TYPE_LABELS[skill.damageType ?? "crushing"];
      const channelLabel = DAMAGE_CHANNEL_LABELS[damageChannel(skill.damageType ?? "crushing")];
      const primaryEntry = log(
        entries,
        round,
        result.crit ? "crit" : "damage",
        `${actor.name} 施放【${skill.name}】，对 ${target.name} 造成 ${result.damage} 点${label}（${channelLabel}）伤害${result.critTiers > 1 ? `（${result.critTiers}重暴击）` : result.crit ? "（暴击）" : ""}${result.executed ? "（处决）" : ""}${result.ailmentSynergy ? "（异常协同）" : ""}${bleedExtra > 0 ? `，流血额外 ${bleedExtra}` : ""}${applied.absorbed > 0 ? `，护盾吸收 ${applied.absorbed}` : ""}${lifestealHeal > 0 ? `，吸血恢复 ${lifestealHeal}` : ""}（生命 ${hpBefore} → ${hpAfter}）。`,
        result.damage,
        {
          actionId,
          actor: actorRef,
          target: targetRef,
          actionName: skill.name,
          hitChance: result.hitChance,
          hit: true,
          critChance: result.critChance,
          damageType: skill.damageType ?? "crushing",
          crit: result.crit,
          hpBefore,
          hpAfter,
          maxHp: target.maxHp,
          shieldBefore,
          shieldAfter,
          shieldAbsorbed: applied.absorbed,
        },
      );

      if (isAlive(target)) {
        primaryEntry.ailment = accumulateAilment(
          entries,
          round,
          actor,
          target,
          skill,
          result.damage,
          actionId,
          result.ailmentMultiplier,
        );
      }

      applyBacklineTrait(actor, target, entries, round, actionId);

      // 反伤：目标持有反伤屏障且受到了生命伤害。
      if (applied.hpDamage > 0 && isAlive(target)) {
        const reflectEffect = target.effects.find((effect) => effect.type === "reflect");
        if (reflectEffect && reflectEffect.percent) {
          const reflected = Math.max(1, Math.round(applied.hpDamage * reflectEffect.percent));
          const attackerHpBefore = actor.hp;
          const attackerShieldBefore = shieldValueOf(actor);
          const attackerApplied = applyDamage(actor, reflected);
          if (actor.side === "hero") totals.damageTaken += attackerApplied.hpDamage;
          else totals.damageDealt += attackerApplied.hpDamage;
          log(
            entries,
            round,
            "damage",
            `${actor.name} 被 ${target.name} 的反伤屏障反弹 ${reflected} 点伤害${attackerApplied.absorbed > 0 ? `（护盾吸收 ${attackerApplied.absorbed}）` : ""}（生命 ${attackerHpBefore} → ${actor.hp}）。`,
            reflected,
            {
              actionId,
              actor: participantOf(target),
              target: actorRef,
              actionName: reflectEffect.sourceSkillName,
              hpBefore: attackerHpBefore,
              hpAfter: actor.hp,
              maxHp: actor.maxHp,
              shieldBefore: attackerShieldBefore,
              shieldAfter: shieldValueOf(actor),
              shieldAbsorbed: attackerApplied.absorbed,
            },
          );
          if (!isAlive(actor)) {
            actor.downed = true;
            log(
              entries,
              round,
              "down",
              `${actor.name} 被 ${target.name} 的反伤屏障击倒。`,
              undefined,
              {
                target: actorRef,
                hpAfter: 0,
                maxHp: actor.maxHp,
                actionId,
                actor: participantOf(target),
                actionName: reflectEffect.sourceSkillName,
              },
            );
            return;
          }
        }
      }

      if (target.hp <= 0) {
        target.downed = true;
        log(
          entries,
          round,
          "down",
          `${target.name} 被 ${actor.name} 的【${skill.name}】击倒。`,
          undefined,
          {
            target: targetRef,
            hpAfter: 0,
            maxHp: target.maxHp,
            actionId,
            actor: actorRef,
            actionName: skill.name,
          },
        );
        triggerItemEffects(entries, round, actor, target, "onKill", rng, actionId);
        continue;
      }

      // 装备特效：命中/暴击给攻击者词条，受击给防御方词条。
      triggerItemEffects(entries, round, actor, target, "onHit", rng, actionId);
      if (result.crit) triggerItemEffects(entries, round, actor, target, "onCrit", rng, actionId);
      if (applied.hpDamage > 0) triggerItemEffects(entries, round, target, actor, "onHurt", rng, actionId);

      for (const effect of skill.effects) {
        applySkillEffect(entries, round, actor, target, skill, effect, rng, actionId);
      }
    }
    return;
  }

  if (skill.kind === "heal") {
    for (const target of targets) {
      if (!isAlive(target)) continue;
      const level = skillLevelOf(actor, skill);
      const healingMult =
        1 + clamp(modPct(actor, "healing"), COMBAT_CONSTANTS.damageModMin, COMBAT_CONSTANTS.damageModMax);
      const amount = Math.max(
        1,
        Math.round(
          (skill.power + skill.levelScale * actor.level) *
            skillMagnitudeMultiplier(level) *
            healingMult *
            (1 + actor.hooks.skillPowerPct),
        ),
      );
      const hpBefore = target.hp;
      const healed = Math.min(amount, target.maxHp - target.hp);
      target.hp += healed;
      const hpAfter = target.hp;
      if (healed > 0) {
        log(
          entries,
          round,
          "heal",
          `${actor.name} 施放【${skill.name}】，为 ${target.name} 恢复 ${healed} 点生命（生命 ${hpBefore} → ${hpAfter}）。`,
          healed,
          {
            actionId,
            actor: actorRef,
            target: participantOf(target),
            actionName: skill.name,
            hpBefore,
            hpAfter,
            maxHp: target.maxHp,
          },
        );
      }
      for (const effect of skill.effects) {
        applySkillEffect(entries, round, actor, target, skill, effect, rng, actionId);
      }
    }
    return;
  }

  // buff 技能：正修正/护盾/持续治疗给目标；也可指向敌人施加负修正/嘲讽。
  for (const target of targets) {
    if (!isAlive(target)) continue;
    for (const effect of skill.effects) {
      applySkillEffect(entries, round, actor, target, skill, effect, rng, actionId);
    }
  }
}

/**
 * 回合开始统一结算：
 * 1. 先结算所有 HoT，再结算所有 DoT；
 * 2. 记录本回合无法行动的眩晕/沉默单位；
 * 3. 所有效果持续时间统一推进一回合，并清理到期效果。
 * 回合结束时不再处理效果计时，只做胜负清算。
 */
function settleRoundStart(
  order: Combatant[],
  all: Combatant[],
  round: number,
  entries: CombatLogEntry[],
  totals: { damageDealt: number; damageTaken: number },
): { stunned: Set<string>; frozen: Set<string> } {
  const stunned = new Set<string>();
  const frozen = new Set<string>();
  const sideOf = (name: string): "hero" | "enemy" => all.find((row) => row.name === name)?.side ?? "enemy";

  for (const actor of order) {
    if (!isAlive(actor)) continue;

    // HoT 先结算，保证持续治疗在持续伤害前生效。
    for (const effect of [...actor.effects]) {
      if (effect.type !== "hot" || !effect.value) continue;
      const hpBefore = actor.hp;
      const healed = Math.min(effect.value, actor.maxHp - actor.hp);
      actor.hp += healed;
      const hpAfter = actor.hp;
      if (healed > 0) {
        log(
          entries,
          round,
          "heal",
          `${actor.name} 受到 ${effect.sourceName} 的【${effect.sourceSkillName}】持续治疗，恢复 ${healed} 点生命（生命 ${hpBefore} → ${hpAfter}）。`,
          healed,
          {
            target: participantOf(actor),
            actionName: effect.sourceSkillName,
            hpBefore,
            hpAfter,
            maxHp: actor.maxHp,
            tick: true,
            sourceName: effect.sourceName,
            sourceSide: sideOf(effect.sourceName),
          },
        );
      }
    }

    // 再结算 DoT。
    for (const effect of [...actor.effects]) {
      if (effect.type !== "dot" || !effect.value || !isAlive(actor)) continue;
      const dealt = Math.max(
        1,
        Math.round(effect.value * (1 - resistOf(actor, effect.damageType ?? "crushing"))),
      );
      const hpBefore = actor.hp;
      const applied = applyDamage(actor, dealt);
      const hpAfter = actor.hp;
      const shieldAfter = shieldValueOf(actor);
      if (actor.side === "hero") totals.damageTaken += applied.hpDamage;
      else totals.damageDealt += applied.hpDamage;
      log(
        entries,
        round,
        "damage",
        `${actor.name} 受到 ${effect.sourceName} 的【${effect.sourceSkillName}】${dealt} 点${DAMAGE_TYPE_LABELS[effect.damageType ?? "crushing"]}伤害${applied.absorbed > 0 ? `，护盾吸收 ${applied.absorbed}` : ""}（生命 ${hpBefore} → ${hpAfter}）。`,
        dealt,
        {
          target: participantOf(actor),
          actionName: effect.sourceSkillName,
          damageType: effect.damageType ?? "crushing",
          hpBefore,
          hpAfter,
          maxHp: actor.maxHp,
          shieldBefore: shieldAfter + applied.absorbed,
          shieldAfter,
          shieldAbsorbed: applied.absorbed,
          tick: true,
          sourceName: effect.sourceName,
          sourceSide: sideOf(effect.sourceName),
        },
      );
      if (actor.hp <= 0) {
        actor.downed = true;
        log(
          entries,
          round,
          "down",
          `${actor.name} 被 ${effect.sourceName} 的【${effect.sourceSkillName}】击倒。`,
          undefined,
          {
            target: participantOf(actor),
            hpAfter: 0,
            maxHp: actor.maxHp,
            tick: true,
            sourceName: effect.sourceName,
            sourceSide: sideOf(effect.sourceName),
          },
        );
      }
    }

    // 灼伤：每回合扣除最大生命 5%；多次触发只叠加持续回合，不叠加伤害。
    for (const effect of [...actor.effects]) {
      if (effect.type !== "burn" || !effect.value || !isAlive(actor)) continue;
      const dealt = Math.max(
        1,
        Math.round(effect.value * (1 - resistOf(actor, "fire"))),
      );
      const hpBefore = actor.hp;
      const applied = applyDamage(actor, dealt);
      const hpAfter = actor.hp;
      if (actor.side === "hero") totals.damageTaken += applied.hpDamage;
      else totals.damageDealt += applied.hpDamage;
      log(
        entries,
        round,
        "damage",
        `${actor.name} 受到【灼伤】${dealt} 点火焰伤害${applied.absorbed > 0 ? `，护盾吸收 ${applied.absorbed}` : ""}（生命 ${hpBefore} → ${hpAfter}）。`,
        dealt,
        {
          target: participantOf(actor),
          actionName: "灼伤",
          damageType: "fire",
          hpBefore,
          hpAfter,
          maxHp: actor.maxHp,
          shieldBefore: shieldValueOf(actor) + applied.absorbed,
          shieldAfter: shieldValueOf(actor),
          shieldAbsorbed: applied.absorbed,
          tick: true,
          sourceName: effect.sourceName,
          sourceSide: sideOf(effect.sourceName),
        },
      );
      if (actor.hp <= 0) {
        actor.downed = true;
        log(entries, round, "down", `${actor.name} 被灼伤击倒。`, undefined, {
          target: participantOf(actor),
          hpAfter: 0,
          maxHp: actor.maxHp,
          tick: true,
          sourceName: effect.sourceName,
          sourceSide: sideOf(effect.sourceName),
        });
      }
    }

    // 中毒：每层每回合造成最大生命 1%，持续到战斗结束；毒伤绕过护盾。
    for (const effect of [...actor.effects]) {
      if (effect.type !== "poison" || !isAlive(actor)) continue;
      const stacks = Math.min(
        COMBAT_CONSTANTS.persistentAilmentMaxStacks,
        Math.max(1, effect.stacks ?? 1),
      );
      const dealt = Math.max(
        1,
        Math.round(actor.maxHp * 0.01 * stacks * (1 - resistOf(actor, "poison"))),
      );
      const hpBefore = actor.hp;
      const hpDamage = Math.min(actor.hp, dealt);
      actor.hp = Math.max(0, actor.hp - dealt);
      const hpAfter = actor.hp;
      if (actor.side === "hero") totals.damageTaken += hpDamage;
      else totals.damageDealt += hpDamage;
      log(
        entries,
        round,
        "damage",
        `${actor.name} 受到【中毒】${stacks} 层 ${dealt} 点毒伤害（无视护盾）（生命 ${hpBefore} → ${hpAfter}）。`,
        dealt,
        {
          target: participantOf(actor),
          actionName: "中毒",
          damageType: "poison",
          hpBefore,
          hpAfter,
          maxHp: actor.maxHp,
          shieldBefore: shieldValueOf(actor),
          shieldAfter: shieldValueOf(actor),
          tick: true,
          sourceName: effect.sourceName,
          sourceSide: sideOf(effect.sourceName),
        },
      );
      if (actor.hp <= 0) {
        actor.downed = true;
        log(entries, round, "down", `${actor.name} 被中毒击倒。`, undefined, {
          target: participantOf(actor),
          hpAfter: 0,
          maxHp: actor.maxHp,
          tick: true,
          sourceName: effect.sourceName,
          sourceSide: sideOf(effect.sourceName),
        });
      }
    }

    if (!isAlive(actor)) {
      actor.effects = [];
      continue;
    }

    const frozenNow = actor.effects.some((effect) => effect.type === "freeze");
    if (frozenNow) {
      stunned.add(actor.id);
      frozen.add(actor.id);
      log(
        entries,
        round,
        "debuff",
        `${actor.name} 处于冰冻中，本回合无法行动且无法回复魔力。`,
        undefined,
        { target: participantOf(actor) },
      );
    } else if (
      actor.effects.some(
        (effect) => effect.type === "stun" || effect.type === "sleep",
      )
    ) {
      stunned.add(actor.id);
      const asleep = actor.effects.some((effect) => effect.type === "sleep");
      log(
        entries,
        round,
        "debuff",
        asleep
          ? `${actor.name} 正在沉睡，本回合无法行动。`
          : `${actor.name} 处于眩晕中，本回合无法行动。`,
        undefined,
        { target: participantOf(actor) },
      );
    }

    // 伤口每回合愈合一层；流血在没有受到物理伤害的回合结束后消失。
    for (const effect of actor.effects) {
      if (effect.type === "wound") {
        effect.stacks = Math.max(0, (effect.stacks ?? 1) - 1);
      }
    }
    actor.effects = actor.effects.filter(
      (effect) =>
        (effect.type !== "wound" || (effect.stacks ?? 0) > 0) &&
        (effect.type !== "bleed" ||
          effect.lastPhysicalRound === undefined ||
          effect.lastPhysicalRound >= round - 1),
    );

    for (const effect of actor.effects) effect.remaining -= 1;
    actor.effects = actor.effects.filter((effect) => effect.remaining > 0);
  }

  return { stunned, frozen };
}

export interface EncounterOptions {
  name: string;
  description?: string;
  prelude?: string[];
  levelNumber?: number;
  maxRounds?: number;
}

export function simulateEncounter(
  heroes: Combatant[],
  monsters: Combatant[],
  rng: Rng,
  options: EncounterOptions,
): EncounterResult {
  const entries: CombatLogEntry[] = [];
  // 每场遭遇重新开始，避免上一房间的游走暴露带入下一场。
  for (const combatant of [...heroes, ...monsters]) combatant.flankExposed = false;
  const combatants: CombatantSnapshot[] = [...heroes, ...monsters].map((combatant) => ({
    id: combatant.id,
    name: combatant.name,
    side: combatant.side,
    level: combatant.level,
    position: combatant.position,
    maxHp: combatant.maxHp,
    maxEnergy: combatant.maxEnergy,
    startHp: combatant.hp,
    startEnergy: combatant.energy,
  }));
  const totals = { damageDealt: 0, damageTaken: 0 };
  // 记录每回合基础回蓝量，供战报回放使用（含回蓝钩子；低蓝涌动为动态加成不计入）。
  const baseEnergyRegen: Record<string, number> = Object.fromEntries(
    [...heroes, ...monsters].map((combatant) => [
      combatant.id,
      COMBAT_CONSTANTS.energyRegenBase + modPoints(combatant, "energyRegen"),
    ]),
  );
  const maxRounds = options.maxRounds ?? 25;
  let rounds = 0;
  let victory = false;
  let timeout = false;

  const monsterNames = monsters.map((monster) => monster.name).join("、");
  log(
    entries,
    0,
    "system",
    options.levelNumber
      ? `第 ${options.levelNumber} 站【${options.name}】：${monsterNames}。`
      : `遭遇【${options.name}】：${monsterNames}。`,
  );
  if (options.description) log(entries, 0, "system", options.description);
  for (const line of options.prelude ?? []) log(entries, 0, "system", line);

  if (monsters.every((monster) => !isAlive(monster))) {
    return {
      name: options.name,
      description: options.description,
      rounds: 0,
      victory: true,
      timeout: false,
      log: entries,
      damageDealt: 0,
      damageTaken: 0,
      combatants,
      energyRegen: baseEnergyRegen,
    };
  }

  outer: for (let round = 1; round <= maxRounds; round += 1) {
    rounds = round;
    const positionOrder: Record<Position, number> = { front: 0, flank: 1, back: 2 };
    const order = [...heroes, ...monsters]
      .filter(isAlive)
      .map((combatant) => ({
        combatant,
        initiative: combatant.initiative + activeModPoints(combatant, "initiative"),
      }))
      .sort(
        (a, b) =>
          b.initiative - a.initiative ||
          (a.combatant.side === b.combatant.side
            ? positionOrder[a.combatant.position] - positionOrder[b.combatant.position] ||
              a.combatant.id.localeCompare(b.combatant.id)
            : a.combatant.side === "hero"
              ? -1
              : 1),
      )
      .map((row) => row.combatant);

    // 回合开始统一结算 HoT/DoT、异常、眩晕/冰冻检查与所有效果持续时间。
    const { stunned, frozen } = settleRoundStart(
      order,
      [...heroes, ...monsters],
      round,
      entries,
      totals,
    );
    if (monsters.every((monster) => !isAlive(monster))) {
      victory = true;
      break outer;
    }
    if (heroes.every((hero) => !isAlive(hero))) {
      victory = false;
      break outer;
    }

    // 每回合统一恢复能量（法力回复修正生效）并推进冷却，再依次执行回合前、先攻、主回合。
    for (const actor of order) {
      if (!frozen.has(actor.id)) {
        actor.energy = Math.min(actor.maxEnergy, actor.energy + energyRegenOf(actor));
      }
      for (const key of Object.keys(actor.cooldowns)) {
        actor.cooldowns[key] = Math.max(0, (actor.cooldowns[key] ?? 0) - 1);
      }
    }

    // 回合前是辅助反应阶段；主要行动只在 main 执行一次。先攻仅用于排序，不再单独制造攻击回合。
    for (const phase of ["pre"] as const) {
      let headerLogged = false;
      for (const actor of order) {
        if (!isAlive(actor)) continue;
        if (stunned.has(actor.id)) continue;
        if (actionCanceledByParalysis(actor, rng, entries, round)) continue;
        const allies = (actor.side === "hero" ? heroes : monsters).filter(isAlive);
        const enemies = (actor.side === "hero" ? monsters : heroes).filter(isAlive);
        const action = chooseAction(actor, allies, enemies, rng, phase);
        if (!action) continue;
        if (!headerLogged) {
          log(
            entries,
            round,
            "system",
            phase === "pre" ? "【回合前】" : "【先攻】",
          );
          headerLogged = true;
        }
        executeAction(actor, action, entries, round, rng, totals, phase);
      }
      if (monsters.every((monster) => !isAlive(monster))) break outer;
      if (heroes.every((hero) => !isAlive(hero))) break outer;
    }

    for (const actor of order) {
      if (actor.downed || stunned.has(actor.id)) continue;
      if (monsters.every((monster) => !isAlive(monster))) break outer;
      if (heroes.every((hero) => !isAlive(hero))) break outer;

      for (let actionIndex = 0; actionIndex < actor.actionsPerRound; actionIndex += 1) {
        if (monsters.every((monster) => !isAlive(monster))) break;
        if (heroes.every((hero) => !isAlive(hero))) break;
        if (actionCanceledByParalysis(actor, rng, entries, round)) {
          actor.flankExposed = false;
          continue;
        }
        const allies = (actor.side === "hero" ? heroes : monsters).filter(isAlive);
        const enemies = (actor.side === "hero" ? monsters : heroes).filter(isAlive);
        const action = chooseAction(actor, allies, enemies, rng, "main");
        if (!action) break;
        executeAction(actor, action, entries, round, rng, totals, "main");
      }
    }

    if (monsters.every((monster) => !isAlive(monster))) {
      victory = true;
      break;
    }
    if (heroes.every((hero) => !isAlive(hero))) {
      victory = false;
      break;
    }
  }

  if (!victory && heroes.some(isAlive) && monsters.some(isAlive)) {
    timeout = true;
    log(entries, rounds, "system", `队伍在 ${maxRounds} 回合内未能结束战斗，被迫撤退。`);
  }

  // 中途 break outer 时不会经过回合末判定，这里以最终状态为准。
  if (monsters.every((monster) => !isAlive(monster))) {
    victory = true;
    timeout = false;
  } else if (heroes.every((hero) => !isAlive(hero))) {
    victory = false;
  } else if (rounds >= maxRounds) {
    victory = false;
    timeout = true;
  }
  log(
    entries,
    rounds,
    victory ? "system" : "system",
    victory ? `【${options.name}】战斗胜利。` : `【${options.name}】战斗失败。`,
  );

  return {
    name: options.name,
    description: options.description,
    rounds,
    victory,
    timeout,
    log: entries,
    damageDealt: totals.damageDealt,
    damageTaken: totals.damageTaken,
    combatants,
    energyRegen: baseEnergyRegen,
  };
}
