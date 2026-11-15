/**
 * Phase B：生成 8 棵音叉武器树 + 16 个被动（每把武器 2 个）。
 *
 * 结构（每把武器 11 节点）：
 *   root → stem1 → stem2 → passiveA(8) → mechanicA(16) → terminalA(18) → connectionA(20)
 *                         ↘ passiveB(12) → mechanicB(16) → terminalB(18) → connectionB(20)
 *
 * connectionA（左臂）连接左邻武器的右末端；connectionB（右臂）连接右邻武器的左末端。
 * 连接是无向边：从邻树末端进入后，可以沿 mechanic → passive → stem → root 向内走。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const contentDir = path.join(root, "content");

const readJson = (name) => JSON.parse(readFileSync(path.join(contentDir, name), "utf8"));
const writeJson = (name, value) =>
  writeFileSync(path.join(contentDir, name), `${JSON.stringify(value, null, 2)}\n`);

const WEAPONS = ["sword", "axe", "hammer", "bow", "dagger", "staff", "book", "instrument"];

const attack = (id, name, description, weaponTypes, damageType, opts = {}) => ({
  id,
  name,
  description,
  kind: "attack",
  category: "class",
  maxLevel: 20,
  weaponTypes,
  damageType,
  range: opts.range ?? "melee",
  levelScale: opts.levelScale ?? 0.8,
  weaponScale: opts.weaponScale ?? 0.8,
  power: opts.power ?? 6,
  cooldown: opts.cooldown ?? 2,
  energyCost: opts.energyCost ?? 10,
  target: opts.target ?? "enemy",
  effects: opts.effects ?? [],
});

const buff = (id, name, description, weaponTypes, opts = {}) => ({
  id,
  name,
  description,
  kind: "buff",
  category: "class",
  maxLevel: 20,
  ...(weaponTypes?.length ? { weaponTypes } : {}),
  levelScale: 0,
  weaponScale: 0,
  power: 0,
  cooldown: opts.cooldown ?? 3,
  energyCost: opts.energyCost ?? 8,
  target: opts.target ?? "self",
  effects: opts.effects ?? [],
});

const heal = (id, name, description, opts = {}) => ({
  id,
  name,
  description,
  kind: "heal",
  category: "class",
  maxLevel: 20,
  ...(opts.weaponTypes?.length ? { weaponTypes: opts.weaponTypes } : {}),
  range: opts.range,
  levelScale: opts.levelScale ?? 1,
  weaponScale: opts.weaponScale ?? 0,
  power: opts.power ?? 8,
  cooldown: opts.cooldown ?? 3,
  energyCost: opts.energyCost ?? 8,
  target: opts.target ?? "self",
  effects: opts.effects ?? [],
});

const passive = (id, name, description, payload) => ({
  id,
  name,
  description,
  kind: "passive",
  category: "class",
  maxLevel: 1,
  passive: {
    hpPct: 0,
    manaPct: 0,
    base: {},
    modifiers: [],
    hooks: {},
    weaponProficiencies: [],
    ...payload,
  },
});

const mod = (kind, base, perLevel, duration) => ({ type: "mod", kind, base, perLevel, duration });
const dot = (base, perLevel, duration, damageType) => ({
  type: "dot",
  base,
  perLevel,
  duration,
  damageType,
});
const shield = (base, perLevel, duration) => ({ type: "shield", base, perLevel, duration });

const NEW_SKILLS = [
  // ---------- 剑 ----------
  buff("sword-stem-1", "战技架势", "压低重心，稳住刀线：命中与造成伤害提升，持续 3 回合。", ["sword"], {
    effects: [mod("hit", 3, 0.25, 3), mod("damageDealt", 8, 0.5, 3)],
  }),
  passive("sword-passive-a", "前哨训练", "旧前哨的操典：生命、护甲与承伤能力提升，并熟练使用剑、斧、锤。", {
    hpPct: 0.08,
    base: { armor: 3 },
    modifiers: [{ kind: "damageTaken", amount: -4 }],
    weaponProficiencies: ["sword", "axe", "hammer"],
  }),
  passive("sword-passive-b", "斗笼本能", "在斗笼里活下来的人更懂要害：命中与暴击提升，并熟练使用剑、斧、匕首。", {
    base: { hit: 2 },
    modifiers: [
      { kind: "crit", amount: 4 },
      { kind: "critDamage", amount: 15 },
    ],
    weaponProficiencies: ["sword", "axe", "dagger"],
  }),
  attack("sword-mechanic-b", "裂锋连斩", "连续两次短促斩击，留下持续流血伤口。", ["sword"], "cutting", {
    power: 5,
    levelScale: 0.7,
    weaponScale: 0.8,
    cooldown: 2,
    energyCost: 10,
    effects: [dot(4, 0.5, 2, "cutting")],
  }),
  attack("sword-terminal-b", "处决", "把全部力量压在刀锋上的一击，专门终结摇摇欲坠的目标。", ["sword"], "cutting", {
    power: 12,
    levelScale: 1.4,
    weaponScale: 1.3,
    cooldown: 3,
    energyCost: 16,
  }),
  buff("sword-link-left", "战吼·剑式", "用剑脊敲盾，给全队打出进攻节拍：造成伤害提升，持续 3 回合。", ["sword", "instrument"], {
    target: "all-allies",
    cooldown: 4,
    energyCost: 14,
    effects: [mod("damageDealt", 8, 0.6, 3)],
  }),
  attack("sword-link-right", "血暴·剑式", "横扫出一道血线，让所有敌人持续流血。", ["sword", "axe"], "cutting", {
    target: "all-enemies",
    power: 5,
    levelScale: 0.6,
    weaponScale: 0.7,
    cooldown: 3,
    energyCost: 16,
    effects: [dot(4, 0.4, 2, "cutting")],
  }),

  // ---------- 斧 ----------
  buff("axe-stem-2", "抗冲击", "把肩膀顶上去：护甲提升、受到伤害降低，持续 3 回合。", ["axe"], {
    effects: [mod("damageTaken", -10, -0.5, 3), mod("armor", 6, 0.5, 3)],
  }),
  passive("axe-passive-a", "撕裂本能", "伤口越深越兴奋：造成伤害与生命提升，但受到的伤害也略微增加。", {
    hpPct: 0.05,
    modifiers: [
      { kind: "damageDealt", amount: 6 },
      { kind: "damageTaken", amount: 3 },
    ],
    weaponProficiencies: ["axe", "sword", "hammer"],
  }),
  passive("axe-passive-b", "盾墙操典", "把斧面当盾用：护甲与承伤能力提升，并熟练使用斧、剑、锤。", {
    hpPct: 0.04,
    base: { armor: 5 },
    modifiers: [{ kind: "damageTaken", amount: -5 }],
    weaponProficiencies: ["axe", "sword", "hammer"],
  }),
  attack("axe-mechanic-a", "裂创", "一斧劈开防线，留下难以愈合的裂口。", ["axe"], "cutting", {
    power: 6,
    levelScale: 0.8,
    weaponScale: 0.8,
    cooldown: 2,
    energyCost: 10,
    effects: [dot(6, 0.6, 3, "cutting")],
  }),
  attack("axe-terminal-a", "血暴", "抡圆斧头横扫一圈，让血从每个敌人身上同时流下来。", ["axe"], "cutting", {
    target: "all-enemies",
    power: 6,
    levelScale: 0.7,
    weaponScale: 0.8,
    cooldown: 3,
    energyCost: 18,
    effects: [dot(5, 0.5, 2, "cutting")],
  }),
  buff("axe-terminal-b", "盾墙反击", "架住攻势并借力反弹：护甲、减伤与反伤提升，持续 2 回合。", ["axe"], {
    cooldown: 4,
    energyCost: 12,
    effects: [
      { type: "reflect", percent: 0.35, duration: 2 },
      mod("armor", 10, 0.6, 2),
      mod("damageTaken", -6, -0.4, 2),
    ],
  }),
  attack("axe-link-right", "余震·斧式", "把斧头砸进地面，冲击波震裂周围敌人的护甲。", ["axe", "hammer"], "crushing", {
    target: "all-enemies",
    power: 5,
    levelScale: 0.6,
    weaponScale: 0.8,
    cooldown: 3,
    energyCost: 16,
    effects: [mod("armor", -6, -0.4, 2)],
  }),

  // ---------- 锤 ----------
  buff("hammer-stem-1", "支点", "把重心沉到脚下：护甲提升、受到伤害降低，持续 3 回合。", ["hammer"], {
    effects: [mod("armor", 10, 0.7, 3), mod("damageTaken", -6, -0.4, 3)],
  }),
  buff("hammer-stem-2", "沉肩", "把肩膀送进挥击里：造成伤害与命中提升，持续 3 回合。", ["hammer"], {
    effects: [mod("damageDealt", 8, 0.5, 3), mod("hit", 3, 0.3, 3)],
  }),
  passive("hammer-passive-a", "逆咒镜面", "把落在身上的诅咒折射回去：减伤、治疗提升，受到的负修正反转为增益。", {
    modifiers: [
      { kind: "damageTaken", amount: -4 },
      { kind: "healing", amount: 8 },
    ],
    hooks: { invertDebuffSign: true },
    weaponProficiencies: ["hammer"],
  }),
  passive("hammer-passive-b", "拆解思维", "把一切看成可拆的零件：回蓝与减伤提升，单体攻击扩散为全体。", {
    modifiers: [
      { kind: "energyRegen", amount: 2 },
      { kind: "damageTaken", amount: -3 },
    ],
    hooks: { spreadSingleTarget: true, spreadPenaltyPct: -0.35 },
    weaponProficiencies: ["hammer"],
  }),
  attack("hammer-mechanic-a", "颅骨震荡", "锤头敲在头盔上，震得目标短暂失去行动。", ["hammer"], "crushing", {
    power: 7,
    levelScale: 0.9,
    weaponScale: 0.9,
    cooldown: 3,
    energyCost: 14,
    effects: [{ type: "stun", chance: 0.35, duration: 1 }],
  }),
  attack("hammer-mechanic-b", "拆甲", "专挑甲片接缝下手，大幅削弱目标护甲。", ["hammer"], "crushing", {
    power: 6,
    levelScale: 0.8,
    weaponScale: 0.9,
    cooldown: 2,
    energyCost: 12,
    effects: [mod("armor", -12, -0.8, 3)],
  }),
  attack("hammer-terminal-b", "熔芯重锤", "把旧熔芯塞进锤头，砸下去时连护甲带骨头一起震碎。", ["hammer"], "crushing", {
    power: 12,
    levelScale: 1.3,
    weaponScale: 1.2,
    cooldown: 3,
    energyCost: 18,
    effects: [mod("armor", -10, -0.5, 2)],
  }),
  attack("hammer-link-left", "余震·锤式", "一锤落地，余震沿地面扩散，震得周围敌人脚步发虚。", ["hammer", "axe"], "crushing", {
    target: "all-enemies",
    power: 5,
    levelScale: 0.6,
    weaponScale: 0.8,
    cooldown: 3,
    energyCost: 16,
    effects: [{ type: "stun", chance: 0.2, duration: 1 }],
  }),
  attack("hammer-link-right", "废料弹幕·锤式", "把锤边的废铁片撒出去，砸出一片持续伤口。", ["hammer", "bow"], "crushing", {
    target: "all-enemies",
    range: "ranged",
    power: 5,
    levelScale: 0.6,
    weaponScale: 0.7,
    cooldown: 3,
    energyCost: 15,
    effects: [dot(3, 0.3, 2, "crushing")],
  }),

  // ---------- 弓 ----------
  passive("bow-passive-a", "雨幕瞄准", "在雨线里算提前量：命中大幅提升，并熟练使用弓。", {
    base: { hit: 4 },
    modifiers: [{ kind: "hit", amount: 3 }],
    weaponProficiencies: ["bow"],
  }),
  passive("bow-passive-b", "毒性专精", "懂得让毒素在伤口里多停留一会儿：持续伤害提升，并熟练使用弓、匕首。", {
    modifiers: [{ kind: "dotPotency", amount: 15 }],
    weaponProficiencies: ["bow", "dagger"],
  }),
  attack("bow-link-left", "废料弹幕·弓式", "把箭袋里的废铁片一股脑射出去，覆盖一整片区域。", ["bow", "hammer"], "piercing", {
    target: "all-enemies",
    range: "ranged",
    power: 5,
    levelScale: 0.6,
    weaponScale: 0.7,
    cooldown: 3,
    energyCost: 15,
    effects: [dot(3, 0.3, 2, "piercing")],
  }),

  // ---------- 匕首 ----------
  buff("dagger-stem-2", "磨刃", "把刃口重新磨亮：造成伤害与暴击率提升，持续 3 回合。", ["dagger"], {
    effects: [mod("damageDealt", 8, 0.5, 3), mod("crit", 5, 0.3, 3)],
  }),
  passive("dagger-passive-a", "配药手法", "懂得把药草和毒物分开用：治疗提升，并熟练使用匕首、法杖。", {
    modifiers: [{ kind: "healing", amount: 10 }],
    weaponProficiencies: ["dagger", "staff"],
  }),
  passive("dagger-passive-b", "腐蚀研究", "长期接触腐蚀物，反而学会了与它共处：持续伤害与混沌抗性提升。", {
    modifiers: [
      { kind: "dotPotency", amount: 12 },
      { kind: "chaosResist", amount: 8 },
    ],
    weaponProficiencies: ["dagger", "book"],
  }),
  attack("dagger-link-left", "弱点洞察·刃式", "贴着防线找到缝隙，下一击更容易命中要害。", ["dagger", "bow"], "piercing", {
    power: 6,
    levelScale: 0.9,
    weaponScale: 1,
    cooldown: 2,
    energyCost: 12,
    effects: [mod("crit", 8, 0.4, 2)],
  }),
  attack("dagger-link-right", "孢毒雾·刃式", "割开孢囊，让毒雾顺着刃风铺开。", ["dagger", "staff"], "acid", {
    target: "all-enemies",
    power: 4,
    levelScale: 0.5,
    weaponScale: 0.5,
    cooldown: 3,
    energyCost: 16,
    effects: [dot(5, 0.5, 3, "acid")],
  }),

  // ---------- 法杖 ----------
  passive("staff-passive-a", "雷声回路", "把旧电池的余电接进回路：伤害、元素抗性与技能量级提升。", {
    modifiers: [
      { kind: "damageDealt", amount: 6 },
      { kind: "elementalResist", amount: 8 },
    ],
    hooks: { skillPowerPct: 0.05 },
    weaponProficiencies: ["staff"],
  }),
  passive("staff-passive-b", "接线直觉", "闭着眼也能接对线：法力上限与回蓝提升，并熟练使用法杖。", {
    manaPct: 0.06,
    modifiers: [{ kind: "energyRegen", amount: 3 }],
    weaponProficiencies: ["staff"],
  }),
  attack("staff-terminal-a", "雷暴核心", "把回路推到过载，整片区域同时落下电弧。", ["staff"], "lightning", {
    target: "all-enemies",
    range: "magic",
    power: 8,
    levelScale: 1,
    weaponScale: 0.3,
    cooldown: 4,
    energyCost: 22,
    effects: [{ type: "stun", chance: 0.2, duration: 1 }],
  }),
  attack("staff-terminal-b", "绝对零度", "抽走目标周围最后一点热量，连动作都一起冻住。", ["staff"], "ice", {
    range: "magic",
    power: 11,
    levelScale: 1.3,
    weaponScale: 0.4,
    cooldown: 3,
    energyCost: 20,
    effects: [mod("evasion", -8, -0.5, 2), { type: "stun", chance: 0.25, duration: 1 }],
  }),
  attack("staff-link-left", "孢毒雾·杖式", "用杖头点燃孢囊，让毒雾在敌阵里慢慢散开。", ["staff", "dagger"], "acid", {
    target: "all-enemies",
    range: "magic",
    power: 4,
    levelScale: 0.5,
    weaponScale: 0.3,
    cooldown: 3,
    energyCost: 16,
    effects: [dot(5, 0.5, 3, "acid")],
  }),
  buff("staff-link-right", "电容涌动·杖式", "把电容接到自己身上：回蓝与造成伤害提升，持续 3 回合。", ["staff", "book"], {
    cooldown: 4,
    energyCost: 10,
    effects: [mod("energyRegen", 6, 0.4, 3), mod("damageDealt", 8, 0.5, 3)],
  }),

  // ---------- 书 ----------
  buff("book-stem-1", "祷念", "低声念完一段旧祷词：治疗与回蓝提升，持续 3 回合。", ["book"], {
    effects: [mod("healing", 10, 0.5, 3), mod("energyRegen", 2, 0.2, 3)],
  }),
  buff("book-stem-2", "定心", "把呼吸压稳：混沌抗性与减伤提升，持续 3 回合。", ["book"], {
    effects: [mod("chaosResist", 12, 0.5, 3), mod("damageTaken", -6, -0.4, 3)],
  }),
  passive("book-passive-a", "疗雾之手", "把治疗雾化到每一次触碰里：治疗与技能量级提升，并熟练使用书、法杖。", {
    modifiers: [{ kind: "healing", amount: 10 }],
    hooks: { skillPowerPct: 0.04 },
    weaponProficiencies: ["book", "staff"],
  }),
  passive("book-passive-b", "滤塔祝祷", "在滤塔里学会的祝祷：治疗与混沌抗性提升，并熟练使用书、法杖。", {
    modifiers: [
      { kind: "healing", amount: 6 },
      { kind: "chaosResist", amount: 10 },
    ],
    weaponProficiencies: ["book", "staff"],
  }),
  buff("book-terminal-b", "滤塔圣所", "展开一圈滤光屏障，为全队吸收伤害并稳住心神。", ["book"], {
    target: "all-allies",
    cooldown: 4,
    energyCost: 20,
    effects: [shield(18, 1.2, 3), mod("chaosResist", 12, 0.4, 3)],
  }),

  // ---------- 乐器 ----------
  buff("instrument-stem-1", "起拍", "敲出第一个拍点：先攻与回蓝提升，持续 3 回合。", ["instrument"], {
    effects: [mod("initiative", 5, 0.3, 3), mod("energyRegen", 2, 0.2, 3)],
  }),
  passive("instrument-passive-a", "雨鼓节奏", "雨点一样的鼓声让队伍始终快半拍：回蓝与先攻提升，并熟练使用乐器、匕首。", {
    modifiers: [
      { kind: "energyRegen", amount: 2 },
      { kind: "initiative", amount: 3 },
    ],
    weaponProficiencies: ["instrument", "dagger"],
  }),
  passive("instrument-passive-b", "拾音共鸣", "能从噪声里听出节奏：先攻、回蓝提升，技能冷却缩短。", {
    modifiers: [
      { kind: "initiative", amount: 2 },
      { kind: "energyRegen", amount: 2 },
    ],
    hooks: { cooldownReduction: 1 },
    weaponProficiencies: ["instrument"],
  }),
  buff("instrument-link-left", "战歌·乐器式", "把战歌推到最高音：全队造成伤害提升，持续 3 回合。", ["instrument", "book"], {
    target: "all-allies",
    cooldown: 4,
    energyCost: 14,
    effects: [mod("damageDealt", 8, 0.6, 3)],
  }),

];

/** 每把武器的 11 个节点；skill 为 null 表示复用现有 skills.json 中的 skill。 */
const TREES = {
  sword: [
    ["heavy-strike", 0, 1, 1, 0, [], [], "root"],
    ["sword-stem-1", 1, 1, 2, 0, ["heavy-strike"], [], "stem"],
    ["block-stance", 1, 1, 4, 0, ["sword-stem-1"], [], "stem"],
    ["sword-passive-a", 2, 2, 8, -1, ["block-stance"], [], "passive"],
    ["provoke", 3, 3, 16, -1, ["sword-passive-a"], [], "mechanic"],
    ["shield-bash", 4, 3, 18, -1, ["provoke"], [], "terminal"],
    ["sword-link-left", 5, 2, 20, -1, ["shield-bash"], ["requiem"], "connection"],
    ["sword-passive-b", 2, 2, 12, 1, ["block-stance"], [], "passive"],
    ["sword-mechanic-b", 3, 3, 16, 1, ["sword-passive-b"], [], "mechanic"],
    ["sword-terminal-b", 4, 3, 18, 1, ["sword-mechanic-b"], [], "terminal"],
    ["sword-link-right", 5, 2, 20, 1, ["sword-terminal-b"], ["axe-terminal-a"], "connection"],
  ],
  axe: [
    ["cleave", 0, 1, 1, 0, [], [], "root"],
    ["berserk", 1, 1, 2, 0, ["cleave"], [], "stem"],
    ["axe-stem-2", 1, 1, 4, 0, ["berserk"], [], "stem"],
    ["axe-passive-a", 2, 2, 8, -1, ["axe-stem-2"], [], "passive"],
    ["axe-mechanic-a", 3, 3, 16, -1, ["axe-passive-a"], [], "mechanic"],
    ["axe-terminal-a", 4, 3, 18, -1, ["axe-mechanic-a"], [], "terminal"],
    ["intimidate", 5, 2, 20, -1, ["axe-terminal-a"], ["sword-terminal-b"], "connection"],
    ["axe-passive-b", 2, 2, 12, 1, ["axe-stem-2"], [], "passive"],
    ["ground-slam", 3, 3, 16, 1, ["axe-passive-b"], [], "mechanic"],
    ["axe-terminal-b", 4, 3, 18, 1, ["ground-slam"], [], "terminal"],
    ["axe-link-right", 5, 2, 20, 1, ["axe-terminal-b"], ["thorn-aura"], "connection"],
  ],
  hammer: [
    ["armor-breaker", 0, 1, 1, 0, [], [], "root"],
    ["hammer-stem-1", 1, 1, 2, 0, ["armor-breaker"], [], "stem"],
    ["hammer-stem-2", 1, 1, 4, 0, ["hammer-stem-1"], [], "stem"],
    ["hammer-passive-a", 2, 2, 8, -1, ["hammer-stem-2"], [], "passive"],
    ["hammer-mechanic-a", 3, 3, 16, -1, ["hammer-passive-a"], [], "mechanic"],
    ["thorn-aura", 4, 3, 18, -1, ["hammer-mechanic-a"], [], "terminal"],
    ["hammer-link-left", 5, 2, 20, -1, ["thorn-aura"], ["axe-terminal-b"], "connection"],
    ["hammer-passive-b", 2, 2, 12, 1, ["hammer-stem-2"], [], "passive"],
    ["hammer-mechanic-b", 3, 3, 16, 1, ["hammer-passive-b"], [], "mechanic"],
    ["hammer-terminal-b", 4, 3, 18, 1, ["hammer-mechanic-b"], [], "terminal"],
    ["hammer-link-right", 5, 2, 20, 1, ["hammer-terminal-b"], ["piercing-shot"], "connection"],
  ],
  bow: [
    ["quick-shot", 0, 1, 1, 0, [], [], "root"],
    ["eagle-eye", 1, 1, 2, 0, ["quick-shot"], [], "stem"],
    ["keen-insight", 1, 1, 4, 0, ["eagle-eye"], [], "stem"],
    ["bow-passive-a", 2, 2, 8, -1, ["keen-insight"], [], "passive"],
    ["hunter-mark", 3, 3, 16, -1, ["bow-passive-a"], [], "mechanic"],
    ["piercing-shot", 4, 3, 18, -1, ["hunter-mark"], [], "terminal"],
    ["bow-link-left", 5, 2, 20, -1, ["piercing-shot"], ["hammer-terminal-b"], "connection"],
    ["bow-passive-b", 2, 2, 12, 1, ["keen-insight"], [], "passive"],
    ["scatter-shot", 3, 3, 16, 1, ["bow-passive-b"], [], "mechanic"],
    ["arrow-rain", 4, 3, 18, 1, ["scatter-shot"], [], "terminal"],
    ["weak-spot", 5, 2, 20, 1, ["arrow-rain"], ["backstab"], "connection"],
  ],
  dagger: [
    ["twin-strike", 0, 1, 1, 0, [], [], "root"],
    ["shadow-step", 1, 1, 2, 0, ["twin-strike"], [], "stem"],
    ["dagger-stem-2", 1, 1, 4, 0, ["shadow-step"], [], "stem"],
    ["dagger-passive-a", 2, 2, 8, -1, ["dagger-stem-2"], [], "passive"],
    ["venom-blade", 3, 3, 16, -1, ["dagger-passive-a"], [], "mechanic"],
    ["backstab", 4, 3, 18, -1, ["venom-blade"], [], "terminal"],
    ["dagger-link-left", 5, 2, 20, -1, ["backstab"], ["arrow-rain"], "connection"],
    ["dagger-passive-b", 2, 2, 12, 1, ["dagger-stem-2"], [], "passive"],
    ["corrosive-touch", 3, 3, 16, 1, ["dagger-passive-b"], [], "mechanic"],
    ["shadow-drain", 4, 3, 18, 1, ["corrosive-touch"], [], "terminal"],
    ["dagger-link-right", 5, 2, 20, 1, ["shadow-drain"], ["staff-terminal-a"], "connection"],
  ],
  staff: [
    ["arcane-missile", 0, 1, 1, 0, [], [], "root"],
    ["mana-surge", 1, 1, 2, 0, ["arcane-missile"], [], "stem"],
    ["ice-barrier", 1, 1, 4, 0, ["mana-surge"], [], "stem"],
    ["staff-passive-a", 2, 2, 8, -1, ["ice-barrier"], [], "passive"],
    ["chain-lightning", 3, 3, 16, -1, ["staff-passive-a"], [], "mechanic"],
    ["staff-terminal-a", 4, 3, 18, -1, ["chain-lightning"], [], "terminal"],
    ["staff-link-left", 5, 2, 20, -1, ["staff-terminal-a"], ["shadow-drain"], "connection"],
    ["staff-passive-b", 2, 2, 12, 1, ["ice-barrier"], [], "passive"],
    ["frost-lance", 3, 3, 16, 1, ["staff-passive-b"], [], "mechanic"],
    ["staff-terminal-b", 4, 3, 18, 1, ["frost-lance"], [], "terminal"],
    ["staff-link-right", 5, 2, 20, 1, ["staff-terminal-b"], ["sacred-shield"], "connection"],
  ],
  book: [
    ["lesser-heal", 0, 1, 1, 0, [], [], "root"],
    ["book-stem-1", 1, 1, 2, 0, ["lesser-heal"], [], "stem"],
    ["book-stem-2", 1, 1, 4, 0, ["book-stem-1"], [], "stem"],
    ["book-passive-a", 2, 2, 8, -1, ["book-stem-2"], [], "passive"],
    ["healing-wave", 3, 3, 16, -1, ["book-passive-a"], [], "mechanic"],
    ["sacred-shield", 4, 3, 18, -1, ["healing-wave"], [], "terminal"],
    ["renew", 5, 2, 20, -1, ["sacred-shield"], ["staff-terminal-b"], "connection"],
    ["book-passive-b", 2, 2, 12, 1, ["book-stem-2"], [], "passive"],
    ["purifying-light", 3, 3, 16, 1, ["book-passive-b"], [], "mechanic"],
    ["book-terminal-b", 4, 3, 18, 1, ["purifying-light"], [], "terminal"],
    ["holy-smite", 5, 2, 20, 1, ["book-terminal-b"], ["battle-horn"], "connection"],
  ],
  instrument: [
    ["discordant-note", 0, 1, 1, 0, [], [], "root"],
    ["instrument-stem-1", 1, 1, 2, 0, ["discordant-note"], [], "stem"],
    ["inspiring-note", 1, 1, 4, 0, ["instrument-stem-1"], [], "stem"],
    ["instrument-passive-a", 2, 2, 8, -1, ["inspiring-note"], [], "passive"],
    ["war-song", 3, 3, 16, -1, ["instrument-passive-a"], [], "mechanic"],
    ["battle-horn", 4, 3, 18, -1, ["war-song"], [], "terminal"],
    ["instrument-link-left", 5, 2, 20, -1, ["battle-horn"], ["book-terminal-b"], "connection"],
    ["instrument-passive-b", 2, 2, 12, 1, ["inspiring-note"], [], "passive"],
    ["hypnotize", 3, 3, 16, 1, ["instrument-passive-b"], [], "mechanic"],
    ["requiem", 4, 3, 18, 1, ["hypnotize"], [], "terminal"],
    ["war-cry", 5, 2, 20, 1, ["requiem"], ["shield-bash"], "connection"],
  ],
};

;

function nodeFromRow(row, index) {
  const [id, tier, cost, minLevel, rowNumber, requires, links, role, requiresAny = []] = row;
  return {
    id,
    tier,
    cost,
    minLevel,
    row: rowNumber,
    requires,
    requiresAny,
    links,
    role,
    // 保留稳定顺序，便于前端按音叉顺序绘制。
    _order: index,
  };
}

const skills = readJson("skills.json");
const byId = new Map(skills.map((skill) => [skill.id, skill]));

// 复用技能的角色调整：不改变数值，只补武器适用范围/分类。
const patches = {
  "ground-slam": { weaponTypes: ["axe", "hammer"] },
};
for (const [id, patch] of Object.entries(patches)) {
  const skill = byId.get(id);
  if (!skill) throw new Error(`缺少待复用技能 ${id}`);
  Object.assign(skill, patch);
}

for (const skill of NEW_SKILLS) {
  byId.set(skill.id, skill);
}

// 通用树已移除：把这些技能从内容包中删掉，避免图鉴残留。
for (const id of [
  "survival-instinct",
  "universal-bandage",
  "universal-reflex",
  "universal-passive-a",
  "universal-passive-b",
  "universal-last-breath",
  "universal-rain-walker",
  "universal-final-breath",
]) {
  byId.delete(id);
}

const tree = { weapons: {} };
for (const weapon of WEAPONS) {
  tree.weapons[weapon] = TREES[weapon].map(nodeFromRow).map(({ _order, ...node }) => node);
}

// 校验所有节点都有技能定义；连接目标存在且为末端。
const allNodes = Object.values(tree.weapons).flat();
const allIds = new Set();
for (const node of allNodes) {
  if (allIds.has(node.id)) throw new Error(`节点 id 重复：${node.id}`);
  allIds.add(node.id);
  if (!byId.has(node.id)) throw new Error(`节点 ${node.id} 缺少技能定义`);
}
const nodeById = new Map(allNodes.map((node) => [node.id, node]));
for (const node of allNodes) {
  for (const target of node.links) {
    const targetNode = nodeById.get(target);
    if (!targetNode) throw new Error(`连接点 ${node.id} 指向不存在的节点 ${target}`);
    if (targetNode.role !== "terminal") {
      throw new Error(`连接点 ${node.id} 必须指向末端节点，实际 ${targetNode.role}`);
    }
  }
}
for (const weapon of WEAPONS) {
  const nodes = tree.weapons[weapon];
  if (nodes.length !== 11) throw new Error(`${weapon} 应有 11 个节点，实际 ${nodes.length}`);
}

// 只保留被技能树、怪物或 NPC 引用的旧技能；避免图鉴里出现大量废弃技能。
const referenced = new Set(allIds);
for (const monster of readJson("monsters.json")) {
  for (const id of monster.skillIds ?? []) referenced.add(id);
}
for (const npc of readJson("npcs.json")) {
  for (const id of Object.keys(npc.skillLevels ?? {})) referenced.add(id);
}
referenced.add("basic-attack");
referenced.add("power-attack");
// 保留所有被动，便于未来扩展；主动技能只保留被引用的。
const pruned = skillsInOrder(skills, byId, referenced);
function skillsInOrder(original, map, keep) {
  const order = [];
  const seen = new Set();
  for (const skill of original) {
    if (!map.has(skill.id)) continue;
    if (!keep.has(skill.id) && skill.kind !== "passive" && skill.kind !== "trait") continue;
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    order.push(map.get(skill.id));
  }
  for (const skill of NEW_SKILLS) {
    if (seen.has(skill.id)) continue;
    seen.add(skill.id);
    order.push(map.get(skill.id));
  }
  return order;
}

writeJson("skills.json", pruned);
writeJson("skill-trees.json", tree);

const pack = readJson("pack.json");
writeJson("pack.json", { ...pack, version: "0.9.0" });

console.log(
  `Phase B 内容生成完成：${Object.values(tree.weapons).reduce((n, rows) => n + rows.length, 0)} 个武器节点；技能 ${pruned.length} 条。`,
);
