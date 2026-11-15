import { describe, expect, it } from "vitest";
import type { Skill } from "@wod/shared";
import { loadTestContent, makeParty } from "./helpers.js";
import {
  buildHeroCombatant,
  buildMonsterCombatant,
  simulateEncounter,
} from "../src/combat.js";
import { Rng } from "../src/rng.js";

const content = loadTestContent();

function attackSkill(damageType: Skill["damageType"]): Skill {
  return {
    id: "test-ailment",
    name: "异常测试",
    description: "测试用攻击",
    kind: "attack",
    category: "basic",
    maxLevel: 20,
    damageType,
    levelScale: 0,
    weaponScale: 0,
    power: 5000,
    cooldown: 0,
    energyCost: 0,
    target: "enemy",
    effects: [],
    ailmentEfficiency: 2,
  };
}

function runAilment(damageType: Skill["damageType"]) {
  const skill = attackSkill(damageType);
  const hero = buildHeroCombatant(content, makeParty(content, 1)[0]!);
  hero.maxHp = 100000;
  hero.hp = 100000;
  hero.hit = 10000;
  hero.attackPower = 0;
  hero.maxEnergy = 1000;
  hero.energy = 1000;
  hero.skills = [skill];
  hero.basic = skill;

  const monster = buildMonsterCombatant(content, content.monsters[0]!, "木桩");
  monster.maxHp = 10000;
  monster.hp = 10000;
  monster.armor = 0;
  monster.evasion = 0;
  monster.resistances = { elemental: 0, chaos: 0 };
  monster.damageMultiplier = 0;

  const result = simulateEncounter([hero], [monster], new Rng(7), {
    name: "异常测试",
    maxRounds: 2,
  });
  return { result, monster };
}

describe("异常积累与触发", () => {
  it("火焰伤害积累并触发灼伤，下一回合扣最大生命 5%", () => {
    const { result, monster } = runAilment("fire");
    expect(monster.effects.some((effect) => effect.type === "burn")).toBe(true);
    const text = result.log.map((entry) => entry.text).join("\n");
    expect(text).toContain("灼伤");
    expect(text).toContain("异常值已满");
    const progress = result.log.find((entry) => entry.kind === "damage" || entry.kind === "crit")?.ailment;
    expect(progress).toBeDefined();
    expect(progress?.delta).toBeGreaterThan(0);
    expect(progress?.threshold).toBe(10000);
    expect(progress?.after).toBeGreaterThanOrEqual(0);
  });

  it("毒素伤害触发中毒，层数有上限且会自然过期", () => {
    const { result, monster } = runAilment("poison");
    const poison = monster.effects.find((effect) => effect.type === "poison");
    expect(poison).toBeDefined();
    expect(poison!.stacks).toBeLessThanOrEqual(3);
    expect(poison!.remaining).toBeLessThanOrEqual(6);
    expect(result.log.map((entry) => entry.text).join("\n")).toContain("中毒");
  });

  it("斩击触发流血，后续物理命中会追加伤害", () => {
    const { result, monster } = runAilment("cutting");
    expect(monster.effects.some((effect) => effect.type === "bleed")).toBe(true);
    expect(result.log.map((entry) => entry.text).join("\n")).toContain("流血");
  });

  it("冰/电/眠/打击/穿刺分别触发对应异常", () => {
    for (const [type, label] of [
      ["ice", "冰冻"],
      ["lightning", "麻痹"],
      ["sleep", "睡眠"],
      ["crushing", "晕眩"],
      ["piercing", "伤口"],
    ] as const) {
      const { result } = runAilment(type);
      const text = result.log.map((entry) => entry.text).join("\n");
      expect(text, type).toContain(label);
    }
  });

  it("暴击率超过 100% 会连续判定，并放大异常积累", () => {
    const skill = attackSkill("fire");
    const hero = buildHeroCombatant(content, makeParty(content, 1)[0]!);
    hero.maxHp = 100000;
    hero.hp = 100000;
    hero.hit = 10000;
    hero.attackPower = 0;
    hero.maxEnergy = 1000;
    hero.energy = 1000;
    hero.critChance = 3;
    hero.skills = [skill];
    hero.basic = skill;

    const monster = buildMonsterCombatant(content, content.monsters[0]!, "木桩");
    monster.maxHp = 100000;
    monster.hp = 100000;
    monster.armor = 0;
    monster.evasion = 0;
    monster.resistances = { elemental: 0, chaos: 0 };
    monster.damageMultiplier = 0;

    const result = simulateEncounter([hero], [monster], new Rng(11), {
      name: "多重暴击测试",
      maxRounds: 1,
    });
    const text = result.log.map((entry) => entry.text).join("\n");
    expect(text).toContain("重暴击");
    expect(monster.effects.some((effect) => effect.type === "burn")).toBe(true);
  });

  it("毒伤绕过护盾", () => {
    const skill = attackSkill("poison");
    const hero = buildHeroCombatant(content, makeParty(content, 1)[0]!);
    hero.maxHp = 100000;
    hero.hp = 100000;
    hero.hit = 10000;
    hero.attackPower = 0;
    hero.maxEnergy = 1000;
    hero.energy = 1000;
    hero.skills = [skill];
    hero.basic = skill;

    const monster = buildMonsterCombatant(content, content.monsters[0]!, "木桩");
    monster.maxHp = 10000;
    monster.hp = 10000;
    monster.armor = 0;
    monster.evasion = 0;
    monster.resistances = { elemental: 0, chaos: 0 };
    monster.damageMultiplier = 0;
    monster.effects.push({
      uid: 999,
      sourceSkillId: "test-shield",
      sourceSkillName: "测试护盾",
      sourceName: "测试",
      type: "shield",
      value: 100000,
      remaining: 5,
    });

    const result = simulateEncounter([hero], [monster], new Rng(13), {
      name: "毒穿盾测试",
      maxRounds: 2,
    });
    const text = result.log.map((entry) => entry.text).join("\n");
    expect(text).toContain("无视护盾");
    const shield = monster.effects.find((effect) => effect.type === "shield");
    expect(shield?.value).toBeGreaterThan(0);
  });

  it("处决与异常协同会标记并增伤", () => {
    const executeSkill = attackSkill("fire");
    executeSkill.executeThreshold = 0.5;
    executeSkill.executeBonusPct = 0.5;
    const hero = buildHeroCombatant(content, makeParty(content, 1)[0]!);
    hero.maxHp = 100000;
    hero.hp = 100000;
    hero.hit = 10000;
    hero.attackPower = 0;
    hero.maxEnergy = 1000;
    hero.energy = 1000;
    hero.critChance = 0;
    hero.skills = [executeSkill];
    hero.basic = executeSkill;
    const monster = buildMonsterCombatant(content, content.monsters[0]!, "残血木桩");
    monster.maxHp = 10000;
    monster.hp = 1000;
    monster.armor = 0;
    monster.evasion = 0;
    monster.resistances = { elemental: 0, chaos: 0 };
    monster.damageMultiplier = 0;
    let result = simulateEncounter([hero], [monster], new Rng(17), {
      name: "处决测试",
      maxRounds: 1,
    });
    expect(result.log.map((entry) => entry.text).join("\n")).toContain("处决");

    const synergySkill = attackSkill("cutting");
    synergySkill.ailmentBonusPct = 0.5;
    hero.skills = [synergySkill];
    hero.basic = synergySkill;
    const wounded = buildMonsterCombatant(content, content.monsters[0]!, "流血木桩");
    wounded.maxHp = 10000;
    wounded.hp = 10000;
    wounded.armor = 0;
    wounded.evasion = 0;
    wounded.resistances = { elemental: 0, chaos: 0 };
    wounded.damageMultiplier = 0;
    wounded.effects.push({
      uid: 998,
      sourceSkillId: "ailment:bleed",
      sourceSkillName: "流血",
      sourceName: "测试",
      type: "bleed",
      lastPhysicalRound: 1,
      remaining: 999,
    });
    result = simulateEncounter([hero], [wounded], new Rng(19), {
      name: "协同测试",
      maxRounds: 1,
    });
    expect(result.log.map((entry) => entry.text).join("\n")).toContain("异常协同");
  });
});
