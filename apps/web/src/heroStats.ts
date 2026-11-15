import type { BaseStats, HeroView } from "@wod/shared";

/**
 * 旧服务端兼容层：v0.9.1 的 8000 实例还没有 finalStats / hitRate / reference。
 * 新服务端返回完整字段时这里原样透传；旧服务端返回 baseStats 时回退到旧口径，
 * 避免滚动部署期间前端因字段缺失而崩溃。
 */
type LegacyHeroView = HeroView & { baseStats?: BaseStats };

export function heroFinalStats(hero: HeroView): BaseStats {
  if (hero.finalStats) return hero.finalStats;
  const legacy = hero as LegacyHeroView;
  if (legacy.baseStats) return legacy.baseStats;
  return {
    hp: hero.maxHp,
    mana: hero.maxEnergy,
    attack: hero.attackPower ?? 0,
    armor: hero.armor,
    hit: hero.hit,
    evasion: hero.evasion,
    initiative: hero.initiative,
    crit: hero.critChance * 100,
  };
}

export function heroActions(hero: HeroView): number {
  return hero.actionsPerRound ?? Math.max(1, 1 + Math.floor(hero.initiative / 20));
}

/** 旧服务端没有新护甲曲线，回退到旧的平值公式仅用于展示。 */
export function heroPhysicalReduction(hero: HeroView): number | undefined {
  if (hero.physicalReduction !== undefined) return hero.physicalReduction;
  return hero.armor / (hero.armor + 70);
}
