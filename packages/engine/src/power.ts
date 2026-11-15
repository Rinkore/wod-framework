import { RARITY_ORDER, skillUsableWithWeapon, type ContentPack } from "@wod/shared";
import { computeHeroDerived, type HeroRunSpec } from "./stats.js";

/**
 * 英雄战力：等级、最终面板数值、技能解锁、装备质量与特质钩子的综合评分。
 *
 * 只用于 UI 展示与数值参考；迷宫准入按怪物等级判定，不再校验英雄战力。
 * 系数集中在这里，调整平衡时只需要改这一处。
 */
export function computeHeroPower(content: ContentPack, spec: HeroRunSpec): number {
  const derived = computeHeroDerived(content, spec);
  const stats = derived.finalStats;
  const statScore =
    stats.hp * 0.5 +
    stats.mana * 0.8 +
    stats.attack * 6 +
    stats.armor * 4 +
    stats.hit * 3 +
    stats.evasion * 3 +
    stats.initiative * 2 +
    stats.crit * 8;

  // 行动经济：先攻阈值与额外行动都折算进 actionScore，不再单独给 extraActions 加分。
  const actionScore = Math.max(0, derived.actionsPerRound - 1) * 150;
  const resistScore =
    ((derived.resistances.elemental ?? 0) + (derived.resistances.chaos ?? 0)) * 200;

  let skillScore = 0;
  for (const [id, level] of Object.entries(spec.skillLevels ?? {})) {
    if (level <= 0) continue;
    const skill = content.skills.find((row) => row.id === id);
    if (!skill || skill.kind === "trait") continue;
    // 只统计当前武器能实际使用的主动/治疗/增益技能，跨树解锁但不可用的技能不计战力。
    if (skill.kind !== "passive" && !skillUsableWithWeapon(skill, derived.weaponType)) continue;
    // 解锁即有价值；等级部分继续线性累加。
    skillScore += 6 + Math.max(0, level - 1) * 6;
  }

  let gearScore = 0;
  for (const equipped of spec.equipment) {
    const template = content.items.find((row) => row.id === equipped.templateId);
    if (!template) {
      continue;
    }
    // 装备的命中/暴击/护甲等数值已经进入 finalStats，这里只评装备品质与特效。
    gearScore +=
      template.level * 4 +
      RARITY_ORDER[template.rarity] * 8 +
      template.effects.length * 20;
    for (const affix of equipped.affixes) {
      if (affix.effect) gearScore += 20;
    }
  }

  const hooks = derived.hooks;
  let hookScore = 0;
  if (hooks.ignoresEnemyFormation) hookScore += 40;
  hookScore += hooks.multiTargetBonusPct * 200;
  if (hooks.spreadSingleTarget) hookScore += 30;
  hookScore += hooks.debuffDurationReduction * 20;
  hookScore += hooks.debuffReflectChance * 120;
  if (hooks.invertDebuffSign) hookScore += 60;
  hookScore +=
    (hooks.skillLevelBonus.attack + hooks.skillLevelBonus.heal + hooks.skillLevelBonus.buff) * 25;
  if (hooks.energyCostPct < 0) hookScore += -hooks.energyCostPct * 100;
  else hookScore -= hooks.energyCostPct * 100;
  hookScore += hooks.cooldownReduction * 25;
  hookScore += hooks.skillPowerPct * 200;
  hookScore += hooks.lowHpFuryPct * 80;
  hookScore += hooks.energySurgeRegen * 10;
  if (derived.trait?.backlineHunter) hookScore += 60;

  return Math.max(
    0,
    Math.round(
      spec.level * 25 + statScore + actionScore + resistScore + skillScore + gearScore + hookScore,
    ),
  );
}

/** 队伍平均等级/战力（真实英雄，不含 NPC）。 */
export function partyAverage(
  rows: Array<{ level: number; power: number }>,
): { level: number; power: number } {
  if (rows.length === 0) return { level: 0, power: 0 };
  const level = rows.reduce((sum, row) => sum + row.level, 0) / rows.length;
  const power = rows.reduce((sum, row) => sum + row.power, 0) / rows.length;
  return { level: Math.floor(level), power: Math.floor(power) };
}
