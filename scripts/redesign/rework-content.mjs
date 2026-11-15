// 内容重做脚本:items/affixes/monsters/classes/npcs 迁移到修正体系(一次性,可删)
import fs from "node:fs";

const read = (name) => JSON.parse(fs.readFileSync(`content/${name}`, "utf8"));
const write = (name, data) =>
  fs.writeFileSync(`content/${name}`, JSON.stringify(data, null, 2) + "\n", "utf8");

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---------------------------------------------------------------------------
// items.json:删除 stats,按槽位/等级生成修正词条;史诗 boss 装备手工覆盖。
// ---------------------------------------------------------------------------
const mod = (kind, amount) => ({ kind, amount });

const OVERRIDES = {
  slagbreaker: {
    modifiers: [mod("damageDealt", 8), mod("hit", 4)],
    effects: [{ trigger: "onHit", chance: 0.2, target: "victim", payload: { type: "dot", base: 6, duration: 2, damageType: "fire" } }],
  },
  "overseer-cinder-crown": {
    modifiers: [mod("damageTaken", -6), mod("energyRegen", 2)],
    effects: [{ trigger: "onHurt", chance: 0.25, target: "self", payload: { type: "shield", base: 15, duration: 2 } }],
  },
  "forbidden-grimoire": {
    modifiers: [mod("dotPotency", 12), mod("damageDealt", 6)],
    effects: [{ trigger: "onHit", chance: 0.25, target: "victim", payload: { type: "mod", kind: "chaosResist", amount: -10, duration: 2 } }],
  },
  "scribe-crown": {
    modifiers: [mod("initiative", 4), mod("energyRegen", 3)],
    effects: [{ trigger: "onHit", chance: 0.25, target: "victim", payload: { type: "mod", kind: "hit", amount: -8, duration: 2 } }],
  },
  "ice-warden-plate": {
    modifiers: [mod("damageTaken", -10), mod("elementalResist", 10)],
    effects: [{ trigger: "onHurt", chance: 0.25, target: "self", payload: { type: "shield", base: 30, duration: 2 } }],
  },
  "absolute-zero-staff": {
    modifiers: [mod("damageDealt", 8), mod("crit", 5)],
    effects: [{ trigger: "onCrit", chance: 0.3, target: "victim", payload: { type: "mod", kind: "initiative", amount: -8, duration: 2 } }],
  },
  "tyrant-blade": {
    modifiers: [mod("damageDealt", 12), mod("critDamage", 20)],
    effects: [{ trigger: "onCrit", chance: 0.3, target: "victim", payload: { type: "dot", base: 12, duration: 3, damageType: "cutting" } }],
  },
  "tyrant-crown": {
    modifiers: [mod("damageTaken", -8), mod("lifesteal", 8), mod("energyRegen", 2)],
    effects: [{ trigger: "onKill", chance: 0.4, target: "self", payload: { type: "energy", amount: 12 } }],
  },
  "obsidian-throne-plate": {
    modifiers: [mod("damageTaken", -12), mod("armor", 15)],
    effects: [{ trigger: "onHurt", chance: 0.3, target: "self", payload: { type: "reflect", percent: 0.2, duration: 2 } }],
  },
  "everfrost-heart": {
    modifiers: [mod("elementalResist", 12), mod("energyRegen", 2)],
    effects: [{ trigger: "onHurt", chance: 0.2, target: "self", payload: { type: "shield", base: 25, duration: 2 } }],
  },
};

const TRINKET_KINDS = ["crit", "hit", "evasion", "initiative", "energyRegen", "lifesteal", "healing"];

function modifiersFor(item) {
  const budget = Math.round(3 + item.level * 0.9);
  if (item.slot === "weapon") {
    const elemental = item.damageType && !["crushing", "cutting", "piercing"].includes(item.damageType);
    if (elemental) {
      const main = Math.ceil(budget * 0.6);
      const rest = budget - main;
      return rest >= 2
        ? [mod("damageDealt", main), mod("crit", rest)]
        : [mod("damageDealt", budget)];
    }
    if (budget < 5) return [mod("hit", budget)];
    const hit = Math.ceil(budget * 0.5);
    return [mod("hit", hit), mod("crit", budget - hit)];
  }
  if (item.slot === "armor") {
    const resistKind = hash(item.id) % 2 === 0 ? "elementalResist" : "chaosResist";
    const tenacity = Math.ceil(budget * 0.55);
    const resist = Math.max(1, budget - tenacity);
    return [mod("damageTaken", -tenacity), mod(resistKind, resist)];
  }
  // trinket:双词条工具修正确保多样性
  const first = TRINKET_KINDS[hash(item.id) % TRINKET_KINDS.length];
  const second = TRINKET_KINDS[(hash(item.id + "b") + 3) % TRINKET_KINDS.length];
  const a = Math.max(2, Math.ceil(budget * 0.6));
  const b = Math.max(1, budget - a);
  const amountOf = (kind, value) =>
    kind === "energyRegen" || kind === "initiative" || kind === "lifesteal" || kind === "crit" || kind === "hit" || kind === "evasion" || kind === "healing"
      ? value
      : value;
  return [mod(first, amountOf(first, a)), mod(second, amountOf(second, b))];
}

function effectFor(item) {
  const seed = hash(item.id);
  const options =
    item.slot === "weapon"
      ? [
          { trigger: "onHit", chance: 0.2, target: "victim", payload: { type: "dot", base: 3 + Math.round(item.level * 0.8), duration: 2, damageType: item.damageType ?? "cutting" } },
          { trigger: "onCrit", chance: 0.25, target: "self", payload: { type: "energy", amount: 6 } },
          { trigger: "onHit", chance: 0.25, target: "victim", payload: { type: "mod", kind: "armor", amount: -5, duration: 2 } },
        ]
      : [
          { trigger: "onHurt", chance: 0.2, target: "self", payload: { type: "shield", base: 8 + Math.round(item.level * 1.5), duration: 2 } },
          { trigger: "onHurt", chance: 0.15, target: "self", payload: { type: "reflect", percent: 0.15, duration: 2 } },
          { trigger: "onHit", chance: 0.2, target: "victim", payload: { type: "mod", kind: "evasion", amount: -6, duration: 2 } },
        ];
  return options[seed % options.length];
}

const items = read("items.json");
for (const item of items) {
  delete item.stats;
  if (item.kind === "equipment" || (!item.kind && ["weapon", "armor", "trinket"].includes(item.slot))) {
    const override = OVERRIDES[item.id];
    if (override) {
      item.modifiers = override.modifiers;
      item.effects = override.effects;
    } else {
      item.modifiers = modifiersFor(item);
      item.effects = item.rarity === "rare" || item.rarity === "epic" ? [effectFor(item)] : [];
    }
  } else {
    item.modifiers = [];
    item.effects = [];
  }
}
write("items.json", items);

// ---------------------------------------------------------------------------
// affixes.json:全新词缀池(修正词缀 + 特效词缀)。
// ---------------------------------------------------------------------------
const affixes = [
  { kind: "modifier", id: "fierce", name: "凶猛", modifiers: [{ kind: "damageDealt", min: 2, max: 5 }], slots: ["weapon", "trinket"] },
  { kind: "modifier", id: "heavy", name: "沉重", modifiers: [{ kind: "damageDealt", min: 3, max: 6 }, { kind: "hit", min: 1, max: 3 }], slots: ["weapon"] },
  { kind: "modifier", id: "precise", name: "精准", modifiers: [{ kind: "hit", min: 2, max: 5 }], slots: ["weapon", "trinket"] },
  { kind: "modifier", id: "deadly", name: "致命", modifiers: [{ kind: "crit", min: 2, max: 5 }], slots: ["weapon", "trinket"] },
  { kind: "modifier", id: "brutal", name: "野蛮", modifiers: [{ kind: "critDamage", min: 5, max: 12 }], slots: ["weapon"] },
  { kind: "modifier", id: "vampiric", name: "吸血", modifiers: [{ kind: "lifesteal", min: 2, max: 5 }], slots: ["weapon", "trinket"] },
  { kind: "modifier", id: "festering", name: "腐化", modifiers: [{ kind: "dotPotency", min: 4, max: 10 }], slots: ["weapon", "trinket"] },
  { kind: "modifier", id: "stalwart", name: "坚毅", modifiers: [{ kind: "damageTaken", min: -5, max: -2 }], slots: ["armor", "trinket"] },
  { kind: "modifier", id: "guarded", name: "防护", modifiers: [{ kind: "armor", min: 3, max: 8 }], slots: ["armor"] },
  { kind: "modifier", id: "warded", name: "庇护", modifiers: [{ kind: "elementalResist", min: 3, max: 8 }], slots: ["armor", "trinket"] },
  { kind: "modifier", id: "hexwarded", name: "御咒", modifiers: [{ kind: "chaosResist", min: 3, max: 8 }], slots: ["armor", "trinket"] },
  { kind: "modifier", id: "nimble", name: "轻捷", modifiers: [{ kind: "evasion", min: 2, max: 5 }], slots: ["armor", "trinket"] },
  { kind: "modifier", id: "swift", name: "迅捷", modifiers: [{ kind: "initiative", min: 2, max: 4 }], slots: ["armor", "trinket"] },
  { kind: "modifier", id: "mending", name: "回春", modifiers: [{ kind: "healing", min: 3, max: 8 }], slots: ["trinket"] },
  { kind: "modifier", id: "clearheaded", name: "清明", modifiers: [{ kind: "energyRegen", min: 1, max: 3 }], slots: ["trinket", "armor"] },
  { kind: "effect", id: "smoldering", name: "阴燃", effect: { trigger: "onHit", chance: 0.2, target: "victim", payload: { type: "dot", base: 4, duration: 2, damageType: "fire" } }, slots: ["weapon"] },
  { kind: "effect", id: "venomous", name: "淬毒", effect: { trigger: "onHit", chance: 0.2, target: "victim", payload: { type: "dot", base: 4, duration: 3, damageType: "nature" } }, slots: ["weapon"] },
  { kind: "effect", id: "chilling", name: "凛冽", effect: { trigger: "onHit", chance: 0.2, target: "victim", payload: { type: "mod", kind: "initiative", amount: -5, duration: 2 } }, slots: ["weapon"] },
  { kind: "effect", id: "shattering", name: "碎甲", effect: { trigger: "onHit", chance: 0.25, target: "victim", payload: { type: "mod", kind: "armor", amount: -6, duration: 2 } }, slots: ["weapon"] },
  { kind: "effect", id: "bulwark", name: "壁垒", effect: { trigger: "onHurt", chance: 0.2, target: "self", payload: { type: "shield", base: 15, duration: 2 } }, slots: ["armor", "trinket"] },
  { kind: "effect", id: "thorned", name: "荆棘", effect: { trigger: "onHurt", chance: 0.2, target: "self", payload: { type: "reflect", percent: 0.15, duration: 2 } }, slots: ["armor"] },
  { kind: "effect", id: "focused", name: "凝神", effect: { trigger: "onCrit", chance: 0.25, target: "self", payload: { type: "energy", amount: 8 } }, slots: ["weapon", "trinket"] },
  { kind: "effect", id: "bloodthirsty", name: "嗜血", effect: { trigger: "onKill", chance: 0.35, target: "self", payload: { type: "energy", amount: 10 } }, slots: ["weapon", "trinket"] },
];
write("affixes.json", affixes);

// ---------------------------------------------------------------------------
// monsters.json:技能引用映射 + 双通道抗性换算(物理抗性折算进护甲)。
// ---------------------------------------------------------------------------
const MONSTER_SKILL_MAP = {
  "arcane-bolt": "arcane-missile",
  "shield-wall": "bone-shield",
};

const monsters = read("monsters.json");
for (const monster of monsters) {
  monster.skillIds = monster.skillIds.map((id) => MONSTER_SKILL_MAP[id] ?? id);
  const old = monster.resist ?? {};
  let elemental = 0;
  let chaos = 0;
  let physical = 0;
  for (const [type, value] of Object.entries(old)) {
    if (["fire", "ice", "lightning", "acid", "nature"].includes(type)) elemental += value;
    else if (["holy", "shadow"].includes(type)) chaos += value;
    else physical = Math.max(physical, value);
  }
  const resist = {};
  const round5 = (v) => Math.round(v * 20) / 20;
  if (elemental !== 0) resist.elemental = clamp(round5(elemental), -0.5, 0.8);
  if (chaos !== 0) resist.chaos = clamp(round5(chaos), -0.5, 0.8);
  monster.resist = resist;
  if (physical > 0) {
    monster.armor = (monster.armor ?? 0) + Math.round((70 * physical) / (1 - physical));
  }
}
write("monsters.json", monsters);

// ---------------------------------------------------------------------------
// classes.json:新技能表 + 职业常驻修正。
// ---------------------------------------------------------------------------
const CLASS_SKILLS = {
  fighter: ["heavy-strike", "shield-bash", "block-stance", "war-cry"],
  gladiator: ["twin-strike", "heavy-strike", "armor-breaker", "war-cry"],
  barbarian: ["cleave", "heavy-strike", "berserk", "war-cry"],
  scholar: ["arcane-missile", "corrosive-touch", "mana-surge", "ice-barrier"],
  hunter: ["precise-shot", "venom-blade", "weak-spot", "quick-shot"],
  bard: ["discordant-note", "war-song", "intimidate", "requiem", "hypnotize"],
  shaman: ["venom-cloud", "healing-wave", "renew", "purifying-light"],
  drifter: ["quick-shot", "precise-shot", "keen-insight", "block-stance"],
  musician: ["discordant-note", "battle-horn", "inspiring-note", "requiem"],
  archer: ["precise-shot", "arrow-rain", "eagle-eye", "weak-spot"],
  warlock: ["firebolt", "corrosive-touch", "venom-cloud", "mana-surge"],
  engineer: ["quick-shot", "ice-barrier", "block-stance", "thorn-aura"],
  cloudraider: ["quick-shot", "twin-strike", "shadow-step", "precise-shot"],
  apprentice: ["firebolt", "arcane-missile", "ice-barrier", "mana-surge"],
  draclin: ["firebolt", "flamestorm", "war-cry", "mana-surge"],
  "star-kinder": ["heavy-strike", "twin-strike", "war-cry", "block-stance"],
  alchemist: ["venom-cloud", "venom-blade", "corrosive-touch", "renew"],
  warlord: ["heavy-strike", "war-cry", "provoke", "battle-horn"],
  lightbringer: ["holy-smite", "sacred-shield", "lesser-heal", "purifying-light"],
  zealot: ["heavy-strike", "holy-smite", "berserk", "thorn-aura"],
  adventurer: ["heavy-strike", "twin-strike", "lesser-heal", "block-stance"],
  mage: ["firebolt", "flamestorm", "frost-lance", "ice-barrier"],
  paladin: ["heavy-strike", "holy-smite", "sacred-shield", "lesser-heal"],
  knight: ["shield-bash", "block-stance", "provoke", "armor-breaker"],
  priest: ["lesser-heal", "healing-wave", "renew", "holy-smite"],
  juggler: ["twin-strike", "backstab", "shadow-step", "weak-spot"],
};

const CLASS_MODIFIERS = {
  fighter: [mod("damageTaken", -8), mod("armor", 5)],
  gladiator: [mod("critDamage", 15)],
  barbarian: [mod("damageDealt", 8), mod("damageTaken", 5)],
  scholar: [mod("energyRegen", 2), mod("elementalResist", 5)],
  hunter: [mod("crit", 4)],
  bard: [mod("energyRegen", 2), mod("initiative", 2)],
  shaman: [mod("healing", 10)],
  drifter: [mod("evasion", 4)],
  musician: [mod("initiative", 3), mod("energyRegen", 2)],
  archer: [mod("hit", 4)],
  warlock: [mod("dotPotency", 15)],
  engineer: [mod("damageTaken", -5), mod("energyRegen", 2)],
  cloudraider: [mod("initiative", 3), mod("crit", 3)],
  apprentice: [mod("energyRegen", 3)],
  draclin: [mod("damageDealt", 6)],
  "star-kinder": [mod("critDamage", 12), mod("crit", 3)],
  alchemist: [mod("dotPotency", 20)],
  warlord: [mod("damageTaken", -10)],
  lightbringer: [mod("healing", 10), mod("chaosResist", 10)],
  zealot: [mod("lifesteal", 6)],
  adventurer: [mod("damageDealt", 5), mod("evasion", 3)],
  mage: [mod("damageDealt", 10), mod("elementalResist", 10)],
  paladin: [mod("damageTaken", -8), mod("healing", 8)],
  knight: [mod("armor", 8), mod("damageTaken", -5)],
  priest: [mod("healing", 12)],
  juggler: [mod("evasion", 6), mod("crit", 4)],
};

const classes = read("classes.json");
for (const cls of classes) {
  const skills = CLASS_SKILLS[cls.id];
  if (!skills) throw new Error(`缺少职业 ${cls.id} 的技能表`);
  cls.skillIds = skills;
  cls.modifiers = CLASS_MODIFIERS[cls.id] ?? [];
}
write("classes.json", classes);

// ---------------------------------------------------------------------------
// npcs.json:技能等级映射到新池。
// ---------------------------------------------------------------------------
const npcs = read("npcs.json");
for (const npc of npcs) {
  if (npc.id === "npc-warrior") {
    npc.skillLevels = { "heavy-strike": 2, "shield-bash": 1, "war-cry": 1 };
  }
  if (npc.id === "npc-priest") {
    npc.skillLevels = { "lesser-heal": 2, "holy-smite": 1, renew: 1 };
  }
}
write("npcs.json", npcs);

console.log("内容重做完成:items/affixes/monsters/classes/npcs");
