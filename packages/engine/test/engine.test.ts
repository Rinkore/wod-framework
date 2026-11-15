import { describe, expect, it } from "vitest";
import {
  WEAPON_TYPES,
  checkSkillNodeUnlock,
  findSkillTreeNode,
  heroCanUseItem,
  skillPointsSpent,
  skillPointsTotal,
  skillTreeNodesForWeapon,
  extraRoutesForDungeon,
  skillUsableWithWeapon,
  unlockedWeaponRoots,
  withExtraRoutes,
  weaponPath,
} from "@wod/shared";
import { epForLevel, epToNext, levelFromEp, skillTrainCostForTier } from "../src/progression.js";
import {
  HERO_LEVEL_GROWTH,
  basicAttackFor,
  computeHeroDerived,
  skillMagnitudeMultiplier,
} from "../src/stats.js";
import { rollItem } from "../src/loot.js";
import { defaultRoomPath, resolveRoomPath, simulateExpedition } from "../src/expedition.js";
import { buildHeroCombatant, buildMonsterCombatant, chooseTargets, simulateEncounter } from "../src/combat.js";
import { Rng } from "../src/rng.js";
import { generatePersonalMazeRegion } from "../src/personal-maze.js";
import { canChallengeMonsterLevel, dungeonMonsterLevel } from "../src/threat.js";
import { makeParty, loadTestContent } from "./helpers.js";

describe("个人迷宫生成", () => {
  it("同 seed 可复现拓扑，并保留模板威胁与奖励预算", () => {
    const content = loadTestContent();
    const template = content.dungeons.find((dungeon) => dungeon.seriesId === "foundry-depths");
    if (!template) throw new Error("缺少个人迷宫模板");

    const first = generatePersonalMazeRegion(template, "user-a", 0, 123456);
    const again = generatePersonalMazeRegion(template, "user-a", 0, 123456);
    expect(first.dungeon).toEqual(again.dungeon);
    expect(first.generatorVersion).toBe(1);
    expect(first.dungeon.rooms.map((room) => room.monsters)).toEqual(
      template.rooms.map((room) => room.monsters),
    );
    expect(first.dungeon.rooms.map((room) => room.gold)).toEqual(
      template.rooms.map((room) => room.gold),
    );
    expect(first.dungeon.completionReward).toEqual(template.completionReward);
    expect(first.dungeon.rooms.map((room) => room.id)).not.toContain("start");
  });

  it("不同玩家的地图连接不同，全部房间仍然连通且深度不封顶", () => {
    const content = loadTestContent();
    const template = content.dungeons.find((dungeon) => dungeon.seriesId === "foundry-depths");
    if (!template) throw new Error("缺少个人迷宫模板");

    const first = generatePersonalMazeRegion(template, "user-a", 0, 10);
    const second = generatePersonalMazeRegion(template, "user-b", 0, 11);
    const deep = generatePersonalMazeRegion(template, "user-a", 250, 12);
    expect(first.dungeon.edges).not.toEqual(second.dungeon.edges);
    expect(deep.dungeon.depth).toBe(250);

    const adjacency = new Map(first.dungeon.rooms.map((room) => [room.id, [] as string[]]));
    for (const [a, b] of first.dungeon.edges) {
      adjacency.get(a)?.push(b);
      adjacency.get(b)?.push(a);
    }
    const visited = new Set<string>();
    const queue = [first.dungeon.rooms[0]!.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(adjacency.get(current) ?? []));
    }
    expect(visited.size).toBe(first.dungeon.rooms.length);
    expect(first.dungeon.edges.length).toBeLessThanOrEqual(first.dungeon.rooms.length);
  });
});

describe("内容包", () => {
  it("通过跨引用校验，八种武器路径完整", () => {
    const content = loadTestContent();
    expect(content.weapons.length).toBe(8);
    expect(content.skills.length).toBeGreaterThanOrEqual(70);
    expect(content.races.length).toBeGreaterThanOrEqual(11);
    for (const path of content.weapons) {
      expect(content.skillTrees.weapons[path.id]?.length).toBeGreaterThanOrEqual(1);
      expect(content.skills.some((skill) => skill.id === path.rootSkillId)).toBe(true);
    }
  });

  it("迷宫准入只看怪物等级，最多高出队伍平均 5 级", () => {
    const content = loadTestContent();
    const first = content.dungeons[0];
    if (!first) throw new Error("缺少迷宫");
    expect(dungeonMonsterLevel(content, first)).toBeGreaterThan(0);
    expect(canChallengeMonsterLevel(10, 15)).toBe(true);
    expect(canChallengeMonsterLevel(10, 16)).toBe(false);
  });
});

describe("武器与技能适配", () => {
  it("武器熟练由武器根与被动共同提供", () => {
    const content = loadTestContent();
    const sword = content.items.find((item) => item.id === "iron-sword");
    const bow = content.items.find((item) => item.id === "hunting-bow");
    const armor = content.items.find((item) => item.id === "leather-armor");
    if (!sword || !bow || !armor) throw new Error("缺少测试物品");
    expect(heroCanUseItem(["sword"], sword)).toBe(true);
    expect(heroCanUseItem(["sword"], bow)).toBe(false);
    expect(heroCanUseItem([], armor)).toBe(true);
  });

  it("武器技能需要匹配当前武器", () => {
    const content = loadTestContent();
    const quickShot = content.skills.find((row) => row.id === "quick-shot");
    const heavyStrike = content.skills.find((row) => row.id === "heavy-strike");
    if (!quickShot || !heavyStrike) throw new Error("缺少武器技能");
    expect(skillUsableWithWeapon(quickShot, "bow")).toBe(true);
    expect(skillUsableWithWeapon(quickShot, "sword")).toBe(false);
    expect(skillUsableWithWeapon(heavyStrike, "sword")).toBe(true);
    expect(skillUsableWithWeapon(heavyStrike, "bow")).toBe(false);
  });
});

describe("英雄基础数值", () => {
  it("生命/法力 = 过往初始 + 等级成长", () => {
    const content = loadTestContent();
    const sword = makeParty(content, 1).find((row) => row.weaponType === "sword");
    if (!sword) throw new Error("缺少剑角色");
    const minimal = {
      ...sword,
      skillLevels: {
        "basic-attack": 1,
        "power-attack": 1,
        "heavy-strike": 1,
      },
    };
    const level1 = computeHeroDerived(content, minimal);
    expect(level1.maxHp).toBe(
      Math.round(level1.baseStats.hp * (1 + (level1.race.passive?.hpPct ?? 0))),
    );
    const level10 = computeHeroDerived(content, {
      ...minimal,
      level: 10,
      epEarned: epForLevel(10),
    });
    expect(level10.baseStats.hp).toBeCloseTo(
      level1.race.base.hp + HERO_LEVEL_GROWTH.hp * 9,
      5,
    );
    expect(level10.baseStats.hit).toBeCloseTo(
      level1.race.base.hit + HERO_LEVEL_GROWTH.hit * 9,
      5,
    );
  });

  it("攻击力 = 基础攻击 + 武器伤害，技能只含已解锁节点", () => {
    const content = loadTestContent();
    const sword = makeParty(content, 1).find((row) => row.weaponType === "sword");
    if (!sword) throw new Error("缺少剑角色");
    const derived = computeHeroDerived(content, sword);
    expect(derived.attackPower).toBeGreaterThan(derived.baseStats.attack);
    expect(derived.skills.some((skill) => skill.id === "heavy-strike")).toBe(true);
    expect(derived.skills.some((skill) => skill.id === "power-attack")).toBe(true);
    expect(derived.skills.some((skill) => skill.id === "armor-breaker")).toBe(false);
  });

  it("技能点：1 级 0 点，之后每级 +1；锁定节点不能越级", () => {
    const content = loadTestContent();
    expect(skillPointsTotal(1)).toBe(0);
    expect(skillPointsTotal(8)).toBe(7);
    const sword = makeParty(content, 1).find((row) => row.weaponType === "sword");
    if (!sword) throw new Error("缺少剑角色");
    const unlocked = new Set(["heavy-strike"]);
    expect(skillPointsSpent(content, unlocked, "sword")).toBe(0);
    const check = checkSkillNodeUnlock(content, unlocked, "sword-stem-1", 1, 0);
    expect(check.canUnlock).toBe(false);
    const atTwo = checkSkillNodeUnlock(content, unlocked, "sword-stem-1", 2, 1);
    expect(atTwo.canUnlock).toBe(true);
  });
});

describe("百分比战斗", () => {
  it("战斗日志记录命中率与暴击率，不再有攻防骰", () => {
    const content = loadTestContent();
    const party = makeParty(content, 4).slice(0, 2);
    const heroes = party.map((spec) => buildHeroCombatant(content, spec));
    const monsterBase = content.monsters[0];
    if (!monsterBase) throw new Error("缺少怪物");
    const monster = buildMonsterCombatant(content, monsterBase, "测试怪物");
    const result = simulateEncounter(heroes, [monster], new Rng(123), {
      name: "测试战斗",
      maxRounds: 12,
    });
    const attacks = result.log.filter((entry) => entry.hitChance !== undefined);
    expect(attacks.length).toBeGreaterThan(0);
    expect(attacks.every((entry) => typeof entry.hitChance === "number")).toBe(true);
    expect(
      attacks.every((entry) => (entry.hitChance ?? 0) >= 0.5 && (entry.hitChance ?? 0) <= 0.98),
    ).toBe(true);
    expect(
      attacks
        .filter((entry) => entry.kind === "miss")
        .every((entry) => entry.missReason === "hit-chance"),
    ).toBe(true);
  });

  it("固定伤害：相同种子结果完全一致", () => {
    const content = loadTestContent();
    const run = () => {
      const heroes = makeParty(content, 5).map((spec) => buildHeroCombatant(content, spec));
      const monsterBase = content.monsters[0];
      if (!monsterBase) throw new Error("缺少怪物");
      const monsters = [
        buildMonsterCombatant(content, monsterBase, "甲"),
        buildMonsterCombatant(content, monsterBase, "乙"),
      ];
      return simulateEncounter(heroes, monsters, new Rng(999), {
        name: "复现",
        maxRounds: 10,
      });
    };
    const first = run();
    const second = run();
    expect(first.log.map((entry) => entry.text)).toEqual(second.log.map((entry) => entry.text));
  });

  it("技能量级随等级倍率成长", () => {
    expect(skillMagnitudeMultiplier(1)).toBe(1);
    expect(skillMagnitudeMultiplier(11)).toBeCloseTo(1.6, 5);
  });

  it("技能训练费用按层级递增", () => {
    const tier1 = skillTrainCostForTier(10, 1);
    const tier3 = skillTrainCostForTier(10, 3);
    expect(tier3.ep).toBeGreaterThan(tier1.ep);
  });
});

describe("NPC 支援", () => {
  it("迷宫可携带 NPC，NPC 不进入英雄结算", () => {
    const content = loadTestContent();
    const dungeon = content.dungeons.find((row) => row.npcAssistIds.length > 0);
    if (!dungeon) throw new Error("缺少 NPC 支援迷宫");
    const result = simulateExpedition(content, {
      dungeonId: dungeon.id,
      heroes: makeParty(content, 6),
      npcIds: [dungeon.npcAssistIds[0]!],
      seed: 42,
    });
    expect(result.npcs?.length).toBe(1);
    expect(result.perHero.some((row) => row.heroId === result.npcs?.[0]?.id)).toBe(false);
  });
});

describe("EP 成长曲线", () => {
  it("等级阈值保持 1000×(等级-1)²", () => {
    expect(epForLevel(1)).toBe(0);
    expect(epForLevel(2)).toBe(1000);
    expect(epForLevel(10)).toBe(81000);
    expect(levelFromEp(0)).toBe(1);
    expect(levelFromEp(999)).toBe(1);
    expect(levelFromEp(1000)).toBe(2);
    expect(epToNext(1, 0)).toBe(1000);
  });
});

describe("掉落", () => {
  it("稀有装备会带词缀", () => {
    const content = loadTestContent();
    const template = content.items.find((row) => row.rarity === "rare");
    if (!template) throw new Error("缺少稀有物品");
    const roll = rollItem(content, template, new Rng(7));
    expect(roll.affixes.length).toBeGreaterThan(0);
  });
});

describe("战斗行动经济", () => {
  it("高先攻和高等级怪物都不再获得额外主要行动", () => {
    const content = loadTestContent();
    const party = makeParty(content, 20);
    const hero = party[0];
    const monsterBase = content.monsters[0];
    if (!hero || !monsterBase) throw new Error("缺少战斗单位");
    const heroCombatant = buildHeroCombatant(content, hero);
    const monster = buildMonsterCombatant(content, { ...monsterBase, level: 40 }, "高等级怪物");
    expect(heroCombatant.actionsPerRound).toBe(1);
    expect(monster.actionsPerRound).toBe(1);
  });

  it("超时会明确标记并保留双方存活状态", () => {
    const content = loadTestContent();
    const hero = buildHeroCombatant(content, makeParty(content, 1)[0]!);
    const monsterBase = content.monsters[0];
    if (!monsterBase) throw new Error("缺少怪物");
    const monster = buildMonsterCombatant(content, { ...monsterBase, level: 40 }, "耐久怪物");
    hero.attackPower = 1;
    monster.damageMultiplier = 0;
    monster.maxHp = monster.hp = 1_000_000;
    const result = simulateEncounter([hero], [monster], new Rng(17), { name: "超时", maxRounds: 1 });
    expect(result.victory).toBe(false);
    expect(result.timeout).toBe(true);
    expect(hero.downed).toBe(false);
  });
});

describe("迷宫模拟", () => {
  it("相同种子得到完全相同的结果", () => {
    const content = loadTestContent();
    const dungeon = content.dungeons[0];
    if (!dungeon) throw new Error("缺少迷宫");
    const run = () =>
      simulateExpedition(content, {
        dungeonId: dungeon.id,
        heroes: makeParty(content, 6),
        seed: 12345,
      });
    expect(run().encounters.map((row) => row.log.length)).toEqual(
      run().encounters.map((row) => row.log.length),
    );
  });

  it("空路线（只含入口）被拒绝", () => {
    const content = loadTestContent();
    const dungeon = content.dungeons[0];
    if (!dungeon) throw new Error("缺少迷宫");
    const start = dungeon.rooms.find((room) => room.kind === "start");
    if (!start) throw new Error("缺少入口");
    expect(() => resolveRoomPath(dungeon, [start.id])).toThrow("至少要选择一个可探索的房间");
  });

  it("六人小队可以通关第一座迷宫", () => {
    const content = loadTestContent();
    const dungeon = content.dungeons[0];
    if (!dungeon) throw new Error("缺少迷宫");
    const result = simulateExpedition(content, {
      dungeonId: dungeon.id,
      heroes: makeParty(content, 8),
      seed: 2026,
    });
    expect(result.outcome).toBe("victory");
  });
});

describe("战斗设置", () => {
  it("站覆盖从第 1 场战斗开始：入口和宝箱不计站", () => {
    const content = loadTestContent();
    const dungeon = content.dungeons.find((row) => row.id === "abandoned-mine");
    if (!dungeon) throw new Error("缺少沉井迷宫");
    const sword = makeParty(content, 4).find((row) => row.weaponType === "sword");
    if (!sword) throw new Error("缺少剑角色");

    // 路径：入口 → 滴水暗渠(战斗) → 藏匿处(宝箱) → 首领(战斗)。
    // 宝箱不计站：首战是"第 1 站"，boss 战是"第 2 站"（旧实现为第 3 站）。
    sword.settings = { floors: { "1": { targetPriority: "strongest" } } };
    const result = simulateExpedition(content, {
      dungeonId: dungeon.id,
      roomPath: ["start", "combat-3", "treasure", "boss"],
      heroes: [sword],
      seed: 47,
    });
    expect(result.encounters.length).toBe(2);
    const bossBattle = result.encounters[1];
    if (!bossBattle) throw new Error("缺少 boss 战斗");
    expect(
      bossBattle.log.some((entry) => entry.text.startsWith("第 2 站【")),
    ).toBe(true);
    const firstBattle = result.encounters[0]!;
    expect(
      firstBattle.log.some((entry) => entry.text.startsWith("第 1 站【")),
    ).toBe(true);
  });

  it("回合前和主回合按阶段执行", () => {
    const content = loadTestContent();
    const sword = makeParty(content, 4).find((row) => row.weaponType === "sword");
    if (!sword) throw new Error("缺少剑角色");
    sword.settings = {
      phases: {
        pre: { skillIds: ["war-cry"] },
        main: { skillIds: ["heavy-strike"] },
      },
    };
    const hero = buildHeroCombatant(content, sword);
    const monsterBase = content.monsters[0];
    if (!monsterBase) throw new Error("缺少怪物");
    const monster = buildMonsterCombatant(content, monsterBase, "测试怪物");
    const result = simulateEncounter([hero], [monster], new Rng(5), {
      name: "阶段",
      maxRounds: 8,
    });
    expect(result.log.some((entry) => entry.phase === "pre")).toBe(true);
    expect(result.log.some((entry) => entry.phase === "main")).toBe(true);
  });
});

describe("怪物基础数值", () => {
  it("怪物用 base + 等级成长", () => {
    const content = loadTestContent();
    const monster = content.monsters[0];
    if (!monster) throw new Error("缺少怪物");
    const combatant = buildMonsterCombatant(content, monster, "测试怪物");
    expect(combatant.maxHp).toBeGreaterThan(0);
    expect(combatant.hit).toBeGreaterThan(0);
    const higher = buildMonsterCombatant(
      content,
      { ...monster, level: monster.level + 10 },
      "高级怪物",
    );
    expect(higher.maxHp).toBeGreaterThan(combatant.maxHp);
    expect(higher.hit).toBeGreaterThan(combatant.hit);
  });
});

describe("基础攻击", () => {
  it("普攻/强力攻击使用武器伤害", () => {
    const content = loadTestContent();
    const path = weaponPath(content, "sword");
    if (!path) throw new Error("缺少剑路径");
    const basic = basicAttackFor(path, "cutting");
    expect(basic.levelScale).toBeGreaterThan(0);
    expect(basic.weaponScale).toBe(1);
    expect(skillTreeNodesForWeapon(content, "sword").length).toBeGreaterThan(0);
  });
});

describe("音叉树", () => {
  it("每把武器 11 节点：根/2 柄/2 被动/2 机制/2 末端/2 连接", () => {
    const content = loadTestContent();
    for (const weapon of WEAPON_TYPES) {
      const nodes = skillTreeNodesForWeapon(content, weapon);
      expect(nodes).toHaveLength(11);
      const count = (role: string) => nodes.filter((node) => node.role === role).length;
      expect(count("root")).toBe(1);
      expect(count("stem")).toBe(2);
      expect(count("passive")).toBe(2);
      expect(count("mechanic")).toBe(2);
      expect(count("terminal")).toBe(2);
      expect(count("connection")).toBe(2);
      const links = nodes.flatMap((node) => node.links);
      expect(links).toHaveLength(2);
      for (const target of links) {
        expect(findSkillTreeNode(content, target)?.node.role).toBe("terminal");
      }
    }
  });

  it("第一被动 8 级、第二被动 12 级，且必须相邻", () => {
    const content = loadTestContent();
    const unlocked = new Set(["heavy-strike"]);
    expect(checkSkillNodeUnlock(content, unlocked, "sword-passive-a", 8, 10).canUnlock).toBe(false);
    unlocked.add("sword-stem-1");
    unlocked.add("block-stance");
    expect(checkSkillNodeUnlock(content, unlocked, "sword-passive-a", 7, 10).reason).toContain("等级 8");
    expect(checkSkillNodeUnlock(content, unlocked, "sword-passive-a", 8, 1).reason).toContain("技能点不足");
    expect(checkSkillNodeUnlock(content, unlocked, "sword-passive-a", 8, 2).canUnlock).toBe(true);
    expect(checkSkillNodeUnlock(content, unlocked, "sword-passive-b", 11, 2).canUnlock).toBe(false);
    expect(checkSkillNodeUnlock(content, unlocked, "sword-passive-b", 12, 2).canUnlock).toBe(true);
  });

  it("连接点进入邻树末端后，可以沿该树向内解锁", () => {
    const content = loadTestContent();
    const unlocked = new Set([
      "heavy-strike",
      "sword-stem-1",
      "block-stance",
      "sword-passive-a",
      "provoke",
      "shield-bash",
      "sword-link-left",
    ]);
    expect(checkSkillNodeUnlock(content, unlocked, "requiem", 20, 3).canUnlock).toBe(true);
    expect(checkSkillNodeUnlock(content, unlocked, "hypnotize", 20, 3).canUnlock).toBe(false);
    unlocked.add("requiem");
    expect(checkSkillNodeUnlock(content, unlocked, "hypnotize", 20, 3).canUnlock).toBe(true);
    expect(unlockedWeaponRoots(content, unlocked).has("instrument")).toBe(false);
    unlocked.add("discordant-note");
    expect(unlockedWeaponRoots(content, unlocked).has("instrument")).toBe(true);
  });

  it("跨树已解锁技能进入引擎主动技能列表，被动叠加基础数值", () => {
    const content = loadTestContent();
    const base = makeParty(content, 20).find((row) => row.weaponType === "sword");
    if (!base) throw new Error("缺少剑角色");
    const minimal = {
      ...base,
      skillLevels: {
        "basic-attack": 1,
        "power-attack": 1,
        "heavy-strike": 1,
        "sword-stem-1": 1,
        "block-stance": 1,
        "sword-link-left": 1,
        requiem: 1,
      },
    };
    const withoutPassive = computeHeroDerived(content, minimal);
    const withPassive = computeHeroDerived(content, {
      ...minimal,
      skillLevels: { ...minimal.skillLevels, "sword-passive-a": 1 },
    });
    expect(withoutPassive.skills.some((skill) => skill.id === "requiem")).toBe(true);
    expect(withPassive.maxHp).toBeGreaterThan(withoutPassive.maxHp);
    expect(withPassive.armor).toBeGreaterThan(withoutPassive.armor);
    expect(withPassive.weaponProficiencies).toEqual(
      expect.arrayContaining(["sword", "axe", "hammer"]),
    );
  });
});

describe("过往特质", () => {
  it("高处切入：攻击后排触发暴击加成并叠加闪避/暴击", () => {
    const content = loadTestContent();
    const spec = makeParty(content, 20).find((row) => row.raceId === "borderlander");
    if (!spec) throw new Error("缺少檐上跑者");
    const hero = buildHeroCombatant(content, spec);
    expect(hero.trait?.id).toBe("trait-high-ground");
    const monster = content.monsters[0];
    if (!monster) throw new Error("缺少怪物");
    const enemies = [0, 1, 2].map((index) =>
      buildMonsterCombatant(content, monster, `后排${index + 1}`, "back"),
    );
    const result = simulateEncounter([hero], enemies, new Rng(123), {
      name: "特质",
      maxRounds: 6,
    });
    expect(result.log.some((entry) => entry.text.includes("高处切入"))).toBe(true);
    expect(
      hero.effects.some(
        (effect) => effect.sourceSkillId === "trait-high-ground" && effect.kind === "crit",
      ),
    ).toBe(true);
  });

  it("静态特质按类型生效", () => {
    const content = loadTestContent();
    const base = makeParty(content, 1)[0];
    if (!base) throw new Error("缺少基础角色");
    const derived = computeHeroDerived(content, { ...base, raceId: "dinturan" });
    expect(derived.modifiers).toEqual(
      expect.arrayContaining([
        { kind: "damageTaken", amount: -8 },
        { kind: "armor", amount: 6 },
      ]),
    );
  });
});

describe("站位与游走", () => {
  it("普通近战在敌方前排存活时只能打前排", () => {
    const content = loadTestContent();
    const base = makeParty(content, 20).find((row) => row.weaponType === "sword");
    if (!base) throw new Error("缺少剑角色");
    const hero = buildHeroCombatant(content, { ...base, position: "front" });
    hero.hp = hero.maxHp = 1000;
    const monster = content.monsters[0];
    if (!monster) throw new Error("缺少怪物");
    const front = buildMonsterCombatant(content, monster, "前排", "front");
    front.hp = front.maxHp = 500;
    const back = buildMonsterCombatant(content, monster, "后排", "back");
    back.hp = 1;
    back.maxHp = 500;
    const targets = chooseTargets(
      hero,
      hero.basic,
      [hero],
      [front, back],
      new Rng(7),
      "lowest-hp",
    );
    expect(targets.map((target) => target.name)).toEqual(["前排"]);
  });

  it("游走近战可绕过存活的前排攻击后排", () => {
    const content = loadTestContent();
    const base = makeParty(content, 20).find((row) => row.weaponType === "sword");
    if (!base) throw new Error("缺少剑角色");
    const hero = buildHeroCombatant(content, { ...base, position: "flank" });
    const monster = content.monsters[0];
    if (!monster) throw new Error("缺少怪物");
    const front = buildMonsterCombatant(content, monster, "前排", "front");
    front.hp = front.maxHp = 500;
    const back = buildMonsterCombatant(content, monster, "后排", "back");
    back.hp = 1;
    back.maxHp = 500;
    const targets = chooseTargets(
      hero,
      hero.basic,
      [hero],
      [front, back],
      new Rng(7),
      "lowest-hp",
    );
    expect(targets.map((target) => target.name)).toEqual(["后排"]);
  });

  it("暴露的游走单位可被普通近战越过前排选中", () => {
    const content = loadTestContent();
    const base = makeParty(content, 20).find((row) => row.weaponType === "sword");
    if (!base) throw new Error("缺少剑角色");
    const hero = buildHeroCombatant(content, { ...base, position: "front" });
    const monster = content.monsters[0];
    if (!monster) throw new Error("缺少怪物");
    const front = buildMonsterCombatant(content, monster, "前排", "front");
    front.hp = front.maxHp = 500;
    const flank = buildMonsterCombatant(content, monster, "暴露游走", "flank");
    flank.hp = 1;
    flank.maxHp = 500;
    flank.flankExposed = true;

    const exposedTargets = chooseTargets(
      hero,
      hero.basic,
      [hero],
      [front, flank],
      new Rng(7),
      "lowest-hp",
    );
    expect(exposedTargets.map((target) => target.name)).toEqual(["暴露游走"]);

    flank.flankExposed = false;
    const hiddenTargets = chooseTargets(
      hero,
      hero.basic,
      [hero],
      [front, flank],
      new Rng(7),
      "lowest-hp",
    );
    expect(hiddenTargets.map((target) => target.name)).toEqual(["前排"]);
  });

  it("游走突袭非前排后暴露，并在下一次行动时解除", () => {
    const content = loadTestContent();
    const base = makeParty(content, 20).find((row) => row.weaponType === "sword");
    if (!base) throw new Error("缺少剑角色");
    const hero = buildHeroCombatant(content, { ...base, position: "flank" });
    hero.skills = [];
    hero.settings = { targetPriority: "lowest-hp" };
    hero.hp = hero.maxHp = 10000;
    hero.attackPower = 100;
    hero.actionsPerRound = 1;
    hero.initiative = 0;
    const monster = content.monsters[0];
    if (!monster) throw new Error("缺少怪物");
    const front = buildMonsterCombatant(content, monster, "前排", "front");
    front.hp = front.maxHp = 100000;
    const back = buildMonsterCombatant(content, monster, "后排", "back");
    back.hp = 1;
    back.maxHp = 500;
    const result = simulateEncounter([hero], [front, back], new Rng(11), {
      name: "游走暴露",
      maxRounds: 2,
    });
    expect(
      result.log.some((entry) => entry.text.includes("在下次行动前暴露")),
    ).toBe(true);
    expect(hero.flankExposed).toBe(false);
  });
});

describe("熟路往返", () => {
  it("只额外连接网格上相邻且原本不相连的房间", () => {
    const content = loadTestContent();
    const dungeon = content.dungeons.find((row) => extraRoutesForDungeon(row).length > 0);
    if (!dungeon) throw new Error("缺少可增加通路的迷宫");
    const existing = new Set(
      dungeon.edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)),
    );
    const extra = extraRoutesForDungeon(dungeon);
    expect(extra.length).toBeGreaterThan(0);
    const roomById = new Map(dungeon.rooms.map((room) => [room.id, room]));
    for (const [a, b] of extra) {
      const left = roomById.get(a);
      const right = roomById.get(b);
      expect(left && right).toBeTruthy();
      const distance = Math.abs(left!.x - right!.x) + Math.abs(left!.y - right!.y);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThanOrEqual(2);
      expect(existing.has(a < b ? `${a}|${b}` : `${b}|${a}`)).toBe(false);
    }
    expect(withExtraRoutes(dungeon).edges.length).toBe(dungeon.edges.length + extra.length);
  });
});
