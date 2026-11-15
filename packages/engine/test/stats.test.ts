import { describe, expect, it } from "vitest";
import { emptyHooks, isPctModifierKind, modifierAmountText } from "@wod/shared";
import { loadTestContent } from "./helpers.js";
import {
  applySkillHitBase,
  computeHeroDerived,
  hitChanceFromRatings,
  physicalDamageReduction,
  skillBaseCritRate,
  skillBaseHitRate,
  skillCritChance,
  skillDamageBreakdown,
  type HeroRunSpec,
} from "../src/stats.js";
import { MAX_LEVEL, epForLevel, levelFromEp } from "../src/progression.js";

const content = loadTestContent();
const swordPath = content.weapons.find((row) => row.id === "sword")!;

function swordSpec(level: number): HeroRunSpec {
  return {
    id: "test-sword",
    name: "测试剑",
    level,
    epEarned: epForLevel(level),
    raceId: "borderlander",
    weaponType: "sword",
    skillLevels: { "basic-attack": 1, "power-attack": 1, "heavy-strike": 1 },
    equipment: swordPath.startingItemIds.map((templateId) => ({ templateId, affixes: [] })),
  };
}

describe("面板最终数值", () => {
  it("命中/闪避/暴击/护甲/攻击都计入装备与被动", () => {
    const derived = computeHeroDerived(content, swordSpec(2));
    // 檐上跑者 L2 裸命中 11.6，铁剑 +4；裸护甲 1.5，皮甲 +6；裸攻击 2，铁剑 +6。
    expect(derived.finalStats.hit).toBeCloseTo(15.6);
    expect(derived.finalStats.armor).toBeCloseTo(7.5);
    expect(derived.finalStats.attack).toBeCloseTo(8);
    expect(derived.hit).toBeCloseTo(15.6);
    expect(derived.armor).toBeCloseTo(7.5);
    expect(derived.attackPower).toBeCloseTo(8);
    expect(derived.hitRate).toBeGreaterThan(0);
    expect(derived.hitRate).toBeLessThanOrEqual(1);
    expect(derived.evasionRate).toBeGreaterThanOrEqual(0);
    expect(derived.evasionRate).toBeLessThan(1);
  });

  it("先攻修正只影响排序，不再跨阈值增加整回合行动", () => {
    const spec: HeroRunSpec = {
      id: "test-gnome",
      name: "测试管道孩童",
      level: 20,
      epEarned: epForLevel(20),
      raceId: "gnome",
      weaponType: "sword",
      skillLevels: { "basic-attack": 1, "power-attack": 1, "heavy-strike": 1 },
      equipment: [],
    };
    const derived = computeHeroDerived(content, spec);
    expect(derived.baseStats.initiative).toBe(16.5);
    expect(derived.initiative).toBe(21);
    expect(derived.actionsPerRound).toBe(1);
  });

  it("闪避修正是平值，不再按小基数百分比缩放", () => {
    const spec: HeroRunSpec = {
      id: "test-gnome",
      name: "测试管道孩童",
      level: 1,
      epEarned: 0,
      raceId: "gnome",
      weaponType: "sword",
      skillLevels: { "basic-attack": 1, "power-attack": 1, "heavy-strike": 1 },
      equipment: [],
    };
    const derived = computeHeroDerived(content, spec);
    // 裸闪避 10，特质 +6 → 16；旧百分比语义只会得到 10.6。
    expect(derived.finalStats.evasion).toBeCloseTo(16);
    expect(isPctModifierKind("evasion")).toBe(false);
    expect(modifierAmountText("evasion", 6)).toBe("+6");
  });
});

describe("PoE 式曲线", () => {
  it("护甲对低伤害更有效，对高伤害递减", () => {
    const small = physicalDamageReduction(100, 10);
    const big = physicalDamageReduction(100, 100);
    expect(small).toBeGreaterThan(big);
    expect(big).toBeGreaterThan(0);
    expect(small).toBeLessThanOrEqual(0.9);
  });

  it("护甲本身也递减：同样 +100 护甲，第二段的收益更低", () => {
    const first = physicalDamageReduction(100, 50);
    const second = physicalDamageReduction(200, 50) - first;
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
  });

  it("命中率曲线先快后慢且有上下限", () => {
    const base = hitChanceFromRatings(20, 20);
    const higher = hitChanceFromRatings(40, 20);
    const muchHigher = hitChanceFromRatings(80, 20);
    expect(higher).toBeGreaterThan(base);
    expect(muchHigher).toBeGreaterThan(higher);
    expect(higher - base).toBeGreaterThan(muchHigher - higher);
    expect(hitChanceFromRatings(1000, 0)).toBeLessThanOrEqual(0.98);
    expect(hitChanceFromRatings(0, 1000)).toBeGreaterThanOrEqual(0.05);
  });
});

describe("技能基础概率与伤害构成", () => {
  it("攻击技能默认 5% 基础暴击 / 90% 基础命中，非攻击为 0 / 100", () => {
    expect(skillBaseCritRate({ kind: "attack" })).toBe(5);
    expect(skillBaseHitRate({ kind: "attack" })).toBe(90);
    expect(skillBaseCritRate({ kind: "heal" })).toBe(0);
    expect(skillBaseHitRate({ kind: "heal" })).toBe(100);
    expect(skillBaseCritRate({ kind: "attack", baseCritRate: 12 })).toBe(12);
    expect(skillBaseHitRate({ kind: "attack", baseHitRate: 80 })).toBe(80);
  });

  it("技能基础概率按基准叠加，默认攻击不改变现有手感", () => {
    expect(skillCritChance(0.04, 5)).toBeCloseTo(0.09);
    expect(skillCritChance(1.2, 0)).toBeCloseTo(1.2);
    expect(applySkillHitBase(0.82, 90)).toBeCloseTo(0.82);
    expect(applySkillHitBase(0.82, 95)).toBeCloseTo(0.87);
  });

  it("伤害构成按基础/等级/攻击/技能倍率拆开", () => {
    const hooks = emptyHooks();
    hooks.skillPowerPct = 0.1;
    const breakdown = skillDamageBreakdown(
      10,
      20,
      { power: 4, levelScale: 0.5, weaponScale: 1 },
      11,
      hooks,
    );
    expect(breakdown.power).toBe(4);
    expect(breakdown.levelScaling).toBe(5);
    expect(breakdown.attackScaling).toBe(20);
    expect(breakdown.baseMagnitude).toBe(29);
    expect(breakdown.levelMultiplier).toBeCloseTo(1.6);
    expect(breakdown.total).toBeCloseTo(29 * 1.6 * 1.1);
  });
});

describe("等级上限", () => {
  it("等级覆盖基础与进阶副本", () => {
    expect(MAX_LEVEL).toBe(40);
    expect(levelFromEp(epForLevel(40) + 999999)).toBe(40);
  });
});
