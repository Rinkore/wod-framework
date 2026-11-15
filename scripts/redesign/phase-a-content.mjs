import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contentDir = path.join(root, "content");

const read = (name) => JSON.parse(readFileSync(path.join(contentDir, name), "utf8"));
const write = (name, data) =>
  writeFileSync(path.join(contentDir, name), `${JSON.stringify(data, null, 2)}\n`, "utf8");

const PHYSICAL = new Set(["crushing", "cutting", "piercing"]);

// ---------- 过往：删除 6 点推荐，写入初始基础数值 ----------
const RACE_BASE = {
  borderlander: { hp: 58, mana: 22, attack: 1, armor: 1, hit: 11, evasion: 11, initiative: 8, crit: 4 },
  dinturan: { hp: 72, mana: 16, attack: 1, armor: 3, hit: 9, evasion: 8, initiative: 5, crit: 2 },
  gnome: { hp: 54, mana: 30, attack: 0, armor: 1, hit: 10, evasion: 10, initiative: 7, crit: 3 },
  halfling: { hp: 58, mana: 22, attack: 1, armor: 1, hit: 11, evasion: 12, initiative: 9, crit: 4 },
  kargashian: { hp: 62, mana: 24, attack: 2, armor: 1, hit: 10, evasion: 9, initiative: 6, crit: 3 },
  kerasi: { hp: 68, mana: 20, attack: 1, armor: 2, hit: 9, evasion: 9, initiative: 6, crit: 3 },
  "mag-mor": { hp: 60, mana: 28, attack: 1, armor: 1, hit: 10, evasion: 9, initiative: 6, crit: 4 },
  partan: { hp: 56, mana: 28, attack: 0, armor: 1, hit: 10, evasion: 9, initiative: 6, crit: 3 },
  targeshian: { hp: 70, mana: 18, attack: 2, armor: 3, hit: 9, evasion: 8, initiative: 5, crit: 2 },
  "tirem-ag": { hp: 55, mana: 26, attack: 2, armor: 1, hit: 11, evasion: 10, initiative: 8, crit: 5 },
  woodlander: { hp: 64, mana: 26, attack: 1, armor: 2, hit: 9, evasion: 8, initiative: 6, crit: 3 },
};

const races = read("races.json").map((race) => {
  const { recommended, ...rest } = race;
  return { ...rest, base: RACE_BASE[race.id] ?? { hp: 60, mana: 22, attack: 1, armor: 1, hit: 10, evasion: 9, initiative: 6, crit: 3 } };
});
write("races.json", races);

// ---------- 怪物：8 维 → 1 级基础数值 ----------
const monsters = read("monsters.json").map((monster) => {
  const { stats, armor, ...rest } = monster;
  if (!stats) return monster;
  const base = {
    hp: Math.round(3 + stats.con * 2),
    mana: 8 + stats.int * 2 + stats.wil * 2,
    attack: 0,
    armor: Math.round((armor ?? 0) + stats.con * 0.5),
    hit: Math.round(stats.dex * 1.2 + stats.agi * 0.8 + stats.per * 0.6),
    evasion: Math.round(stats.agi * 1.2 + stats.per * 0.8),
    initiative: Math.round(stats.agi * 2 + stats.per),
    crit: Math.round((4 + stats.dex * 0.2) * 10) / 10,
  };
  return { ...rest, base };
});
write("monsters.json", monsters);

// ---------- 技能：删除 scaling/ratio，改为 levelScale/weaponScale/perLevel ----------
const skills = read("skills.json").map((skill) => {
  if (skill.levelScale !== undefined) return skill; // 已转换
  const { scaling, ratio, ...rest } = skill;
  const weaponBound = Array.isArray(rest.weaponTypes) && rest.weaponTypes.length > 0;
  const active = rest.kind === "attack" || rest.kind === "heal";
  const levelScale = active ? Math.round((ratio ?? 1) * 0.9 * 100) / 100 : 0;
  const weaponScale = weaponBound ? 1 : active && PHYSICAL.has(rest.damageType) ? 0.25 : 0;
  const effects = (rest.effects ?? []).map((effect) => {
    if (effect.perLevel !== undefined) return effect;
    const { perPoint, ...tail } = effect;
    return { ...tail, perLevel: Math.round((perPoint ?? 0) * 0.8 * 100) / 100 };
  });
  let range = rest.range;
  if (!range) {
    if (weaponBound) range = rest.weaponTypes.includes("bow") ? "ranged" : "melee";
    else if (rest.kind === "attack" && rest.damageType && !PHYSICAL.has(rest.damageType)) range = "magic";
  }
  const description = String(rest.description ?? "")
    .replace(/伤害 = 基础 \+ [^。]+。/g, "伤害随等级与武器伤害提升。")
    .replace(/恢复 = 基础 \+ [^。]+点生命。/g, "恢复量随等级提升。")
    .replace(/恢复 = 基础 \+ [^。]+/g, "恢复量随等级提升");
  return { ...rest, description, ...(range ? { range } : {}), levelScale, weaponScale, effects };
});

write("skills.json", skills);

// ---------- 武器路径 ----------
const weapons = [
  { id: "sword", name: "剑", description: "直刃、平衡、可靠。荒原上最常见的近战武器。", color: "#c87941", icon: "sword", startingItemIds: ["iron-sword", "leather-armor"], rootSkillId: "heavy-strike" },
  { id: "axe", name: "斧", description: "重心靠前，靠一次抡圆了的劈砍解决问题。", color: "#a65434", icon: "axe", startingItemIds: ["iron-axe", "leather-armor"], rootSkillId: "cleave" },
  { id: "hammer", name: "锤", description: "不需要锋利，只需要足够重。专治护甲和骨头。", color: "#8c96a8", icon: "hammer", startingItemIds: ["iron-hammer", "leather-armor"], rootSkillId: "armor-breaker" },
  { id: "bow", name: "弓", description: "在雨线里算提前量，把危险留在自己够不着的地方。", color: "#7d9b4e", icon: "bow", startingItemIds: ["hunting-bow", "leather-armor"], rootSkillId: "quick-shot" },
  { id: "dagger", name: "匕首", description: "短、快、贴身。斗笼和暗巷里活下来的人都懂它的好。", color: "#b8723a", icon: "dagger", startingItemIds: ["twin-daggers", "leather-armor"], rootSkillId: "twin-strike" },
  { id: "staff", name: "法杖", description: "旧电池、线圈和一根趁手的棍子，足够放一场小型雷暴。", color: "#5d8fd6", icon: "staff", startingItemIds: ["oak-staff", "apprentice-robe"], rootSkillId: "arcane-missile" },
  { id: "book", name: "经卷", description: "把祷词、药方和旧文明的只言片语夹在书页里。", color: "#d6bd6a", icon: "book", startingItemIds: ["prayer-book", "cloth-vest"], rootSkillId: "lesser-heal" },
  { id: "instrument", name: "乐器", description: "锈铁皮和旧琴弦也能敲出节奏。鼓点一响，队伍就知道该冲了。", color: "#c46b8f", icon: "instrument", startingItemIds: ["lute", "traveler-cloak"], rootSkillId: "discordant-note" },
];
write("weapons.json", weapons);

// ---------- Phase A 最小音叉树：根 + 两段稳固 ----------
const STEM = {
  sword: ["block-stance", "war-cry"],
  axe: ["berserk", "war-cry"],
  hammer: ["block-stance", "thorn-aura"],
  bow: ["eagle-eye", "keen-insight"],
  dagger: ["shadow-step", "keen-insight"],
  staff: ["mana-surge", "ice-barrier"],
  book: ["sacred-shield", "purifying-light"],
  instrument: ["inspiring-note", "battle-horn"],
};
const weaponTrees = {};
for (const path of weapons) {
  const [stem1, stem2] = STEM[path.id];
  weaponTrees[path.id] = [
    { id: path.rootSkillId, tier: 0, cost: 0, minLevel: 1, row: 0, requires: [], role: "root" },
    { id: stem1, tier: 1, cost: 1, minLevel: 2, row: 0, requires: [path.rootSkillId], role: "stem" },
    { id: stem2, tier: 1, cost: 1, minLevel: 4, row: 0, requires: [stem1], role: "stem" },
  ];
}
write("skill-trees.json", { weapons: weaponTrees });

// ---------- NPC ----------
write("npcs.json", [
  {
    id: "npc-warrior",
    name: "滤水游侠",
    raceId: "borderlander",
    weaponType: "sword",
    level: 1,
    passiveSkillIds: [],
    skillLevels: { "block-stance": 2, "shield-bash": 1, "war-cry": 1 },
    equipment: ["iron-sword", "leather-armor"],
    position: "front",
  },
  {
    id: "npc-priest",
    name: "雨幕医师",
    raceId: "dinturan",
    weaponType: "book",
    level: 1,
    passiveSkillIds: [],
    skillLevels: { "lesser-heal": 2, "holy-smite": 1, renew: 1 },
    equipment: ["prayer-book", "cloth-vest"],
    position: "back",
  },
]);

// ---------- 补斧/锤武器 ----------
const items = read("items.json");
const newItems = [
  { id: "iron-axe", name: "铁斧", description: "斧柄缠着防滑的旧布条，刃口有几处崩缺。", slot: "weapon", rarity: "common", level: 1, value: 18, weaponDamage: 7, damageType: "cutting", weaponType: "axe", modifiers: [{ kind: "hit", amount: 3 }], effects: [] },
  { id: "battle-axe", name: "战斧", description: "专门为劈开旧世界防暴盾而打造的宽刃斧。", slot: "weapon", rarity: "uncommon", level: 8, value: 90, weaponDamage: 14, damageType: "cutting", weaponType: "axe", modifiers: [{ kind: "hit", amount: 3 }, { kind: "crit", amount: 2 }], effects: [] },
  { id: "ruin-axe", name: "废墟巨斧", description: "从坍塌的消防通道里拔出来的巨斧，刃口仍能映出雨光。", slot: "weapon", rarity: "rare", level: 14, value: 220, weaponDamage: 20, damageType: "cutting", weaponType: "axe", modifiers: [{ kind: "hit", amount: 4 }, { kind: "crit", amount: 3 }], effects: [] },
  { id: "executioner-axe", name: "处刑斧", description: "旧王庭行刑者的遗物，斧背刻着一行无人能读的判词。", slot: "weapon", rarity: "epic", level: 20, value: 520, weaponDamage: 28, damageType: "cutting", weaponType: "axe", modifiers: [{ kind: "hit", amount: 5 }, { kind: "crit", amount: 5 }], effects: [] },
  { id: "iron-hammer", name: "铁锤", description: "工地和拆解场里最常见的长柄锤，锤头被磨得发亮。", slot: "weapon", rarity: "common", level: 1, value: 18, weaponDamage: 8, damageType: "crushing", weaponType: "hammer", modifiers: [{ kind: "hit", amount: 2 }], effects: [] },
  { id: "maul", name: "重槌", description: "需要双手才能抡圆的重槌，专门用来敲碎机械外壳。", slot: "weapon", rarity: "uncommon", level: 11, value: 150, weaponDamage: 17, damageType: "crushing", weaponType: "hammer", modifiers: [{ kind: "hit", amount: 3 }, { kind: "crit", amount: 2 }], effects: [] },
  { id: "siege-hammer", name: "攻城锤", description: "从旧军团攻城器械上拆下来的锤头，柄是后来接的。", slot: "weapon", rarity: "rare", level: 17, value: 320, weaponDamage: 24, damageType: "crushing", weaponType: "hammer", modifiers: [{ kind: "hit", amount: 4 }, { kind: "crit", amount: 3 }], effects: [] },
  { id: "earthbreaker", name: "碎地者", description: "传说中一锤能震塌半条街的巨锤，如今只剩锤头还在。", slot: "weapon", rarity: "epic", level: 20, value: 540, weaponDamage: 30, damageType: "crushing", weaponType: "hammer", modifiers: [{ kind: "hit", amount: 5 }, { kind: "crit", amount: 4 }], effects: [] },
];
for (const item of newItems) {
  if (!items.some((row) => row.id === item.id)) items.push(item);
}
write("items.json", items);

// ---------- 删除职业内容 ----------
if (existsSync(path.join(contentDir, "classes.json"))) unlinkSync(path.join(contentDir, "classes.json"));

// ---------- 版本 ----------
const pack = read("pack.json");
write("pack.json", { ...pack, version: "0.8.0" });

console.log("phase A content written");
