export const MAX_LEVEL = 40;
export const MAX_SKILL_LEVEL = 20;

export type TrainingCategory = "basic" | "secondary" | "foreign" | "class";

/** 达到某等级所需的累计 EP。原站等级表为 1000 × (等级−1)²。 */
export function epForLevel(level: number): number {
  if (level <= 1) return 0;
  return 1000 * (level - 1) * (level - 1);
}

export function levelFromEp(epEarned: number): number {
  let level = 1;
  while (level < MAX_LEVEL && epEarned >= epForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

export function epToNext(level: number, epEarned: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.max(0, epForLevel(level + 1) - epEarned);
}

const SKILL_COST_BASE: Record<TrainingCategory, number> = {
  basic: 20,
  secondary: 40,
  foreign: 50,
  class: 450,
};

/** 技能树层级对应的训练基础系数：根/稳固、稳固、机制、连接。 */
export const SKILL_TIER_COST_BASE = [40, 60, 120, 300] as const;

/** 提升 1 级技能消耗的 EP；金币按 EP 的 90%。 */
export function skillTrainCost(
  heroLevel: number,
  category: TrainingCategory,
): { ep: number; gold: number } {
  const base = SKILL_COST_BASE[category] ?? SKILL_COST_BASE.basic;
  const ep = Math.round(base * heroLevel * (heroLevel + 1));
  return { ep, gold: Math.round(ep * 0.9) };
}

/** 技能树主动节点按层级收费（被动不训练）。 */
export function skillTrainCostForTier(
  heroLevel: number,
  tier: number,
): { ep: number; gold: number } {
  const base = SKILL_TIER_COST_BASE[Math.max(0, Math.min(3, tier))] ?? SKILL_TIER_COST_BASE[0];
  const ep = Math.round(base * heroLevel * (heroLevel + 1));
  return { ep, gold: Math.round(ep * 0.9) };
}
