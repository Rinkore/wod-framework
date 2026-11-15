// 迷宫副本 + 材料简化 + 过往/职业解耦 + 世界观校正。一次性脚本。
import fs from "node:fs";

const read = (name) => JSON.parse(fs.readFileSync(`content/${name}`, "utf8"));
const write = (name, data) =>
  fs.writeFileSync(`content/${name}`, JSON.stringify(data, null, 2) + "\n", "utf8");

const DUNGEON_NAMES = {
  "abandoned-mine": "沉井",
  "frost-crypt": "眠舱",
  "ember-altar": "燃祭场",
  "foundry-depths": "断炉",
  "whispering-archive": "空档厅",
  "glacier-vault": "冻库",
  "obsidian-throne": "空庭",
};
const DUNGEON_OLD_NAMES = {
  "沉水矿道": "沉井",
  "冻眠墓窖": "眠舱",
  "献焰祭坛": "燃祭场",
  "锈炉深层": "断炉",
  "低语档案库": "空档厅",
  "冰穹军械库": "冻库",
  "黑曜王庭": "空庭",
};
const DUNGEON_TAGS = {
  "abandoned-mine": ["地下", "积水", "狭窄"],
  "frost-crypt": ["地下", "低温", "旧文明"],
  "ember-altar": ["露天", "高温", "旧文明"],
  "foundry-depths": ["地下", "高温", "机械"],
  "whispering-archive": ["室内", "干燥", "旧文明"],
  "glacier-vault": ["室内", "低温", "旧文明"],
  "obsidian-throne": ["室内", "旧文明", "宽敞"],
};
const DUNGEON_STORIES = {
  "abandoned-mine":
    "文明停摆三百年后，这里再没有矿工。闸门守卫认得井口的旧闸编号，管道孩童在管壁上留过记号——井底还压着没来得及运走的滤水设备。",
  "frost-crypt":
    "数百年前的休眠舱集体失效，没人再醒过来。冷雾里仍有规律的报时声；回声猎手说，那是空舱在回应脚步。",
  "ember-altar":
    "露天的祭火早该灭了，却一直在烧。余燃者围着火堆游荡，雨夜赌徒曾在火光里输掉最后一枚硬币。",
  "foundry-depths":
    "断炉的机械臂还在空转，像在等一批永远不会来的工件。拆件匠认得这里的型号，电塔学徒想拆一根完好的线圈走。",
  "whispering-archive":
    "无人归还的档案大厅，纸页在干燥的空气里继续翻动。旧校舍学徒在这里见过同款教材，信号解读者想找回最后一段广播。",
  "glacier-vault":
    "军械冷库的冰层每年加厚一寸。冻库深处的门从未被打开过，镜面碎屑散在门口——碎镜拾荒者说，里面照得出人心里最怕的东西。",
  "obsidian-throne":
    "旧权力中枢空了数百年，王座一直亮着。没有人继承它，也没有人敢把灯关掉。",
};

const GLOBAL_DICT = [
  ...Object.entries(DUNGEON_OLD_NAMES),
  ["苔皮拾荒者", "苔皮游荡者"],
  ["苔皮监工", "苔皮巢主"],
  ["燃焰信徒", "余燃者"],
  ["矿坑", "沉井"],
  ["旧校舍", "旧校舍"],
];
function retheme(value) {
  if (typeof value === "string") {
    let out = value;
    for (const [from, to] of GLOBAL_DICT) out = out.split(from).join(to);
    return out;
  }
  if (Array.isArray(value)) return value.map(retheme);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retheme(v)]));
  }
  return value;
}

// ---------------------------------------------------------------------------
// 1) pack.json: 文明消失数百年
// ---------------------------------------------------------------------------
write("pack.json", {
  formatVersion: 1,
  id: "ember-marches",
  name: "雨蚀荒原",
  version: "0.7.0",
  description:
    "旧文明在数百年前的一场长雨里停摆。城市沉入水下，机器停在原地，活下来的人散落在高处檐廊与排水系统里，靠拆解遗物过活。",
  lore:
    "断代三百年后，酸雨仍在下。没有人记得文明是怎么结束的，也没人再提起它的名字。幸存者的后代把旧世界叫作「断代以前」，把地面上的废墟叫作无人区。行会把可回收的东西写成悬赏：沉井的滤水设备、眠舱的电池、断炉的线圈、空档厅的档案——每一处都空无一人，只有野化生物和失控的机器还在看守。你召集的不是英雄，是一支愿意冒雨走进无人的拾荒队。",
});

// ---------------------------------------------------------------------------
// 2) 材料简化
// ---------------------------------------------------------------------------
const items = read("items.json");
const oldAlchemy = items.filter(
  (item) => item.kind === "material" && item.material?.type === "alchemy",
);
const alchemyQualityById = Object.fromEntries(
  oldAlchemy.map((item) => [item.id, item.material.quality ?? 1]),
);
const oldAlchemyEffectById = Object.fromEntries(
  oldAlchemy.map((item) => [item.id, item.material.effect ?? "healing"]),
);

const NEW_MATERIALS = [
  {
    id: "scrap-forge-1",
    name: "锈铁片",
    description: "从坍塌结构上剥下来的锈铁片，能凑合着修补 1–5 级装备。",
    level: 5,
    value: 30,
    rarity: "common",
    material: { type: "forge", forgeLevel: 5 },
  },
  {
    id: "scrap-forge-2",
    name: "旧钢件",
    description: "断代以前的承重钢件，切割后可用于 6–10 级装备。",
    level: 10,
    value: 90,
    rarity: "common",
    material: { type: "forge", forgeLevel: 10 },
  },
  {
    id: "scrap-forge-3",
    name: "精密合金件",
    description: "从旧机器核心拆出的合金件，适合 11–15 级装备。",
    level: 15,
    value: 240,
    rarity: "uncommon",
    material: { type: "forge", forgeLevel: 15 },
  },
  {
    id: "scrap-forge-4",
    name: "完好旧组件",
    description: "几乎没有锈蚀的旧文明组件，能支撑 16–20 级装备的强化。",
    level: 20,
    value: 480,
    rarity: "uncommon",
    material: { type: "forge", forgeLevel: 20 },
  },
  ...[1, 2, 3].map((q) => ({
    id: `scrap-filter-${q}`,
    name: `净水滤芯 ${["I", "II", "III"][q - 1]}`,
    description: "旧净水设备的滤芯残片，炼药时提供治疗成分。",
    level: 1,
    value: 20 + q * 10,
    rarity: "common",
    material: { type: "alchemy", effect: "healing", base: { heal: 220, healPct: 0.45 }, quality: q },
  })),
  ...[1, 2, 3].map((q) => ({
    id: `scrap-cell-${q}`,
    name: `电解残液 ${["I", "II", "III"][q - 1]}`,
    description: "旧电池里剩余的电解液，炼药时提供法力成分。",
    level: 1,
    value: 20 + q * 10,
    rarity: "common",
    material: { type: "alchemy", effect: "mana", base: { energy: 140, energyPct: 0.45 }, quality: q },
  })),
].map((entry) => ({
  id: entry.id,
  name: entry.name,
  description: entry.description,
  kind: "material",
  slot: "material",
  rarity: entry.rarity,
  level: entry.level,
  value: entry.value,
  material: entry.material,
  modifiers: [],
  effects: [],
}));

const keptItems = items
  .filter((item) => item.kind !== "material")
  .map((item) => retheme(item));
write("items.json", [...keptItems, ...NEW_MATERIALS]);

// ---------------------------------------------------------------------------
// 3) 掉落表重建
// ---------------------------------------------------------------------------
function mapMaterialId(id, qualityOverride) {
  const forge = /^forge-material-(\d+)$/.exec(id);
  if (forge) return `scrap-forge-${Math.max(1, Math.ceil(Number(forge[1]) / 5))}`;
  if (qualityOverride && oldAlchemyEffectById[id]) {
    return oldAlchemyEffectById[id] === "mana"
      ? `scrap-cell-${qualityOverride}`
      : `scrap-filter-${qualityOverride}`;
  }
  if (alchemyQualityById[id] !== undefined) {
    return oldAlchemyEffectById[id] === "mana"
      ? `scrap-cell-${alchemyQualityById[id]}`
      : `scrap-filter-${alchemyQualityById[id]}`;
  }
  return id;
}

const oldTables = read("loot-tables.json");
const tables = [];
for (const table of oldTables) {
  if (/-alchemy$|-forge$/.test(table.id) || table.id.endsWith("-material")) continue;
  const entries = table.entries.map((entry) => {
    const mapped = mapMaterialId(entry.templateId, entry.quality);
    const next = { templateId: mapped, weight: entry.weight };
    if (entry.quantity) next.quantity = entry.quantity;
    if (entry.quality && mapped.startsWith("scrap-forge")) next.quality = entry.quality;
    if (entry.quality && mapped.startsWith("scrap-filter") && !mapped.endsWith(`-${entry.quality}`)) {
      next.quality = entry.quality;
    }
    return next;
  });
  tables.push({ ...retheme(table), entries });
}

const PREFIXES = ["mine", "crypt", "altar", "foundry", "archive", "vault", "throne"];
const QUALITY_BY_PREFIX = { mine: 1, crypt: 1, altar: 2, foundry: 2, archive: 2, vault: 3, throne: 3 };
for (const prefix of PREFIXES) {
  const q = QUALITY_BY_PREFIX[prefix];
  tables.push({
    id: `${prefix}-material`,
    chance: 1,
    rolls: 2,
    entries: [
      { templateId: "scrap-filter-1", weight: 5 },
      { templateId: "scrap-filter-2", weight: 4 },
      { templateId: "scrap-filter-3", weight: 3 },
      { templateId: "scrap-cell-1", weight: 5 },
      { templateId: "scrap-cell-2", weight: 4 },
      { templateId: "scrap-cell-3", weight: 3 },
      { templateId: "scrap-forge-1", weight: 6 },
      { templateId: "scrap-forge-2", weight: 4 },
      { templateId: "scrap-forge-3", weight: 3 },
      { templateId: "scrap-forge-4", weight: 2 },
      ...(q >= 2 ? [{ templateId: `scrap-filter-${q}`, weight: 2 }, { templateId: `scrap-cell-${q}`, weight: 2 }] : []),
    ],
  });
}
write("loot-tables.json", tables);

// ---------------------------------------------------------------------------
// 4) 迷宫副本
// ---------------------------------------------------------------------------
const ROOM_TEMPLATE = [
  { id: "start", x: 2, y: 3, kind: "start" },
  { id: "combat-1", x: 0, y: 2, kind: "combat" },
  { id: "combat-2", x: 2, y: 2, kind: "combat" },
  { id: "combat-3", x: 4, y: 2, kind: "combat" },
  { id: "material", x: 0, y: 1, kind: "material" },
  { id: "combat-4", x: 2, y: 1, kind: "combat" },
  { id: "treasure", x: 4, y: 1, kind: "treasure" },
  { id: "boss", x: 2, y: 0, kind: "boss" },
];
const EDGES_BASE = [
  ["start", "combat-1"],
  ["start", "combat-2"],
  ["start", "combat-3"],
  ["combat-1", "combat-2"],
  ["combat-2", "combat-3"],
  ["combat-1", "material"],
  ["combat-2", "material"],
  ["combat-2", "combat-4"],
  ["combat-3", "combat-4"],
  ["combat-3", "treasure"],
  ["material", "combat-4"],
  ["combat-4", "treasure"],
  ["material", "boss"],
  ["combat-4", "boss"],
  ["treasure", "boss"],
];

function roomFromEncounter(id, kind, encounter, name, durationSeconds, extra = {}) {
  return {
    id,
    name,
    ...(encounter?.description ? { description: encounter.description } : {}),
    kind,
    x: 0,
    y: 0,
    monsters: encounter?.monsters ?? [],
    durationSeconds,
    monsterPower: encounter?.monsterPower ?? 0,
    ...(encounter?.gold ? { gold: encounter.gold } : {}),
    ...extra,
  };
}

const dungeons = read("dungeons.json").map((dungeon) => {
  const bossRoute = dungeon.routes.find((route) => route.kind === "boss");
  const alchemyRoute = dungeon.routes.find((route) => route.kind === "alchemy");
  const forgeRoute = dungeon.routes.find((route) => route.kind === "forge");
  if (!bossRoute) throw new Error(`缺少 boss 线路 ${dungeon.id}`);
  const bossEncounter = bossRoute.encounters[bossRoute.encounters.length - 1];
  const palette = [...bossRoute.encounters.slice(0, -1), ...(alchemyRoute?.encounters ?? []), ...(forgeRoute?.encounters ?? [])]
    .sort((a, b) => a.monsterPower - b.monsterPower);
  const combatEncounters = [];
  for (const encounter of palette) {
    if (combatEncounters.length >= 4) break;
    if (combatEncounters.includes(encounter)) continue;
    combatEncounters.push(encounter);
  }
  while (combatEncounters.length < 4) combatEncounters.push(bossEncounter);
  const extraRoom = ["foundry-depths", "whispering-archive", "glacier-vault", "obsidian-throne"].includes(dungeon.id);
  const prefix = dungeon.id
    .replace("abandoned-mine", "mine")
    .replace("frost-crypt", "crypt")
    .replace("ember-altar", "altar")
    .replace("foundry-depths", "foundry")
    .replace("whispering-archive", "archive")
    .replace("glacier-vault", "vault")
    .replace("obsidian-throne", "throne");

  const rooms = [];
  for (const slot of ROOM_TEMPLATE) {
    const base = { ...slot };
    if (slot.kind === "start") {
      rooms.push({
        id: slot.id,
        name: "入口",
        description: "雨声被挡在门外。队伍在这里最后一次检查装备。",
        kind: "start",
        x: slot.x,
        y: slot.y,
        monsters: [],
        durationSeconds: 10,
        monsterPower: 0,
      });
      continue;
    }
    if (slot.kind === "material") {
      const guard = alchemyRoute?.encounters[0] ?? combatEncounters[0];
      rooms.push({
        id: slot.id,
        name: "回收点",
        description: "旧物资堆还压在雨棚下面，拆得动就能带走。",
        kind: "material",
        x: slot.x,
        y: slot.y,
        monsters: guard.monsters,
        durationSeconds: 40,
        monsterPower: guard.monsterPower,
        lootTableId: `${prefix}-material`,
        ...(guard.gold ? { gold: guard.gold } : {}),
      });
      continue;
    }
    if (slot.kind === "treasure") {
      rooms.push({
        id: slot.id,
        name: "藏匿处",
        description: "有人把东西藏在这里，然后再也没回来取。",
        kind: "treasure",
        x: slot.x,
        y: slot.y,
        monsters: [],
        durationSeconds: 20,
        monsterPower: 0,
        lootTableId: (() => {
          const treasureId = `${prefix}-treasure`;
          return tables.some((table) => table.id === treasureId) ? treasureId : `${prefix}-material`;
        })(),
        gold: [5, 20],
      });
      continue;
    }
    if (slot.kind === "boss") {
      rooms.push({
        id: slot.id,
        name: bossEncounter.name,
        ...(bossEncounter.description ? { description: bossEncounter.description } : {}),
        kind: "boss",
        x: slot.x,
        y: slot.y,
        monsters: bossEncounter.monsters,
        durationSeconds: 90,
        monsterPower: bossEncounter.monsterPower,
        ...(bossEncounter.gold ? { gold: bossEncounter.gold } : {}),
      });
      continue;
    }
    const index = Number(slot.id.replace("combat-", "")) - 1;
    const encounter = combatEncounters[index];
    rooms.push({
      id: slot.id,
      name: encounter.name,
      ...(encounter.description ? { description: encounter.description } : {}),
      kind: "combat",
      x: slot.x,
      y: slot.y,
      monsters: encounter.monsters,
      durationSeconds: 45 + index * 5,
      monsterPower: encounter.monsterPower,
      ...(encounter.gold ? { gold: encounter.gold } : {}),
    });
  }
  const edges = [...EDGES_BASE];
  if (extraRoom) {
    rooms.push({
      id: "combat-5",
      name: bossRoute.encounters[bossRoute.encounters.length - 2]?.name ?? "深处",
      kind: "combat",
      x: 0,
      y: 0,
      monsters: bossRoute.encounters[bossRoute.encounters.length - 2]?.monsters ?? combatEncounters[3].monsters,
      durationSeconds: 60,
      monsterPower: bossRoute.encounters[bossRoute.encounters.length - 2]?.monsterPower ?? combatEncounters[3].monsterPower,
    });
    edges.push(["material", "combat-5"], ["combat-5", "boss"]);
  }

  return {
    ...retheme({
      id: dungeon.id,
      name: DUNGEON_NAMES[dungeon.id],
      subtitle:
        {
          "abandoned-mine": "雨声灌满了竖井",
          "frost-crypt": "没有人再醒来",
          "ember-altar": "火还在烧",
          "foundry-depths": "机器还在空转",
          "whispering-archive": "纸页还在翻动",
          "glacier-vault": "冰层每年加厚",
          "obsidian-throne": "座位一直亮着",
        }[dungeon.id],
      description: DUNGEON_STORIES[dungeon.id],
      kind: dungeon.kind,
      ...(dungeon.schedule ? { schedule: dungeon.schedule } : {}),
      tags: DUNGEON_TAGS[dungeon.id],
      roomSeconds: 45,
      npcAssistIds: dungeon.npcAssistIds,
      theme: dungeon.theme,
    }),
    rooms,
    edges,
    completionReward: bossRoute.rewards,
  };
});
write("dungeons.json", dungeons.map(retheme));

// ---------------------------------------------------------------------------
// 5) 过往(11)重写:钩子分区 + 亲和标签 + 改名
// ---------------------------------------------------------------------------
const PASTS = {
  borderlander: {
    name: "檐上跑者",
    subtitle: "在楼宇檐脊之间长大",
    description:
      "你从小在高层檐廊的雨布与缆索间穿梭。下雨的时候，别人躲，你赶路；等他们绕到门口，你已经站在对面楼顶。",
    hooks: {
      ignoresEnemyFormation: true,
      positionModifiers: [{ position: "back", modifiers: [{ kind: "hit", amount: 3 }, { kind: "crit", amount: 4 }] }],
    },
    affinity: { tags: ["室内", "旧文明"], perk: "extra-loot", label: "高处熟路" },
    trait: { name: "檐脊捷径", description: "后排时命中 +3、暴击率 +4%；近战攻击可越过敌方前排。" },
    recommended: { agi: 2, dex: 1 },
    passive: { hpPct: 0.05, manaPct: 0.05 },
  },
  dinturan: {
    name: "闸门守卫",
    subtitle: "守着排水闸门长大的人",
    description:
      "你的童年是沉重的铁闸门和不断上涨的污水。你知道怎么站住脚跟，也知道一次退让会让整条巷道灌满水。",
    hooks: {
      positionModifiers: [{ position: "front", modifiers: [{ kind: "damageTaken", amount: -8 }, { kind: "armor", amount: 6 }] }],
    },
    affinity: { tags: ["积水", "地下"], perk: "field-rest", label: "闸后歇脚" },
    trait: { name: "闸前不退", description: "站在前排时受到伤害 -8%、护甲 +6。" },
    recommended: { con: 2, str: 1 },
    passive: { hpPct: 0.15, manaPct: -0.05 },
  },
  gnome: {
    name: "管道孩童",
    subtitle: "在下水管网里认路",
    description:
      "你比同龄人更熟悉管道的回声。哪里能钻过去、哪里会塌，你听一声滴水就知道。",
    hooks: {
      positionModifiers: [{ position: "flank", modifiers: [{ kind: "initiative", amount: 4 }, { kind: "energyRegen", amount: 1 }] }],
    },
    affinity: { tags: ["地下", "狭窄"], perk: "swift", label: "管道捷径" },
    trait: { name: "管线脉络", description: "站在中排时先攻 +4、每回合额外恢复 1 点法力。" },
    recommended: { int: 2, agi: 1 },
    passive: { hpPct: -0.05, manaPct: 0.15 },
  },
  halfling: {
    name: "回声猎手",
    subtitle: "靠回声判断猎物的位置",
    description:
      "废墟里的回声比眼睛可靠。你学会在雨声里分辨脚步，也学会一次呼吸之间出手两次。",
    hooks: { extraActions: 1 },
    affinity: { tags: ["地下", "低温"], perk: "swift", label: "回声探路" },
    trait: { name: "回声定位", description: "每回合额外获得 1 次行动。" },
    recommended: { agi: 2, dex: 1 },
    passive: { hpPct: 0.05, manaPct: 0.05 },
  },
  kargashian: {
    name: "鸦群唤者",
    subtitle: "和雨鸦共享一顿饭的人",
    description:
      "你懂得在废墟顶层呼唤鸦群。它们替你探路，也替你撕开猎物的防线——只要你舍得把最后一块干粮分出去。",
    hooks: { multiTargetBonusPct: 0.1 },
    affinity: { tags: ["露天", "高温"], perk: "extra-loot", label: "鸦群视野" },
    trait: { name: "鸦群盘旋", description: "群攻每多命中 1 个目标，伤害额外 +10%。" },
    recommended: { cha: 2, per: 1 },
    passive: { hpPct: 0.1 },
  },
  kerasi: {
    name: "试水人",
    subtitle: "喝过过滤塔最后一口水",
    description:
      "你走遍荒原寻找还能喝的水，身体早被滤芯和苦味磨出了耐性。毒素与诅咒在你身上停留不了多久。",
    hooks: { debuffDurationReduction: 1 },
    affinity: { tags: ["积水", "室内"], perk: "field-rest", label: "净水营地" },
    trait: { name: "滤净体质", description: "受到的负面效果持续回合 -1。" },
    recommended: { con: 2, wil: 1 },
    passive: { hpPct: 0.1 },
  },
  "mag-mor": {
    name: "碎镜拾荒者",
    subtitle: "在镜面废料场里活下来的人",
    description:
      "镜面废料场的碎片改变了你。别人施来的恶意会先经过一面看不见的镜子，再决定落在谁身上。",
    hooks: { debuffReflectChance: 0.25 },
    affinity: { tags: ["旧文明", "室内"], perk: "extra-loot", label: "镜面回廊" },
    trait: { name: "镜像折返", description: "受到负面效果时 25% 概率原样反弹给施加者。" },
    recommended: { wil: 2, per: 1 },
    passive: { manaPct: 0.1 },
  },
  partan: {
    name: "旧校舍学徒",
    subtitle: "在倒塌的教室里读完最后一本书",
    description:
      "你在旧校舍的废墟里自学了线路、剂量和一种奇怪的坚持。你更擅长把学过的东西用在增益与辅助上。",
    hooks: { skillLevelBonus: { attack: 0, heal: 0, buff: 2 } },
    affinity: { tags: ["旧文明", "干燥"], perk: "field-rest", label: "旧校舍笔记" },
    trait: { name: "旧校舍底子", description: "增益类技能等级 +2。" },
    recommended: { int: 2, wil: 1 },
    passive: { manaPct: 0.1 },
  },
  targeshian: {
    name: "拆件匠",
    subtitle: "把最后半格电拆成三份用",
    description:
      "你修过荒原上几乎所有型号的旧机器。别人眼里的废件，在你这儿还能再点亮一次雨灯。",
    hooks: { energyCostPct: -0.2 },
    affinity: { tags: ["机械", "地下"], perk: "swift", label: "拆件熟路" },
    trait: { name: "拆件经验", description: "技能法力消耗 -20%。" },
    recommended: { con: 2, dex: 1 },
    passive: { hpPct: 0.15, manaPct: -0.05 },
  },
  "tirem-ag": {
    name: "雨夜赌徒",
    subtitle: "在雨声里押上最后一块干粮",
    description:
      "你在雨夜里赌过太多次命。越是逼近绝境，你的手越稳，出手越狠。",
    hooks: { lowHpFuryPct: 0.3 },
    affinity: { tags: ["高温", "露天"], perk: "extra-loot", label: "赌徒直觉" },
    trait: { name: "雨夜赌命", description: "生命低于 40% 时造成伤害 +30%。" },
    recommended: { dex: 2, cha: 1 },
    passive: { hpPct: -0.05, manaPct: 0.15 },
  },
  woodlander: {
    name: "长夜守灯人",
    subtitle: "守着聚落最后一盏雨灯的人",
    description:
      "你负责在长夜里给檐廊的雨灯添油。灯不能灭，人也一样——电见底的时候，你总能再多榨出一点。",
    hooks: { energySurgeRegen: 4 },
    affinity: { tags: ["低温", "室内"], perk: "field-rest", label: "守灯人的火种" },
    trait: { name: "守灯余温", description: "法力低于 30% 时每回合额外恢复 4 点法力。" },
    recommended: { wil: 2, con: 1 },
    passive: { hpPct: 0.05, manaPct: 0.05 },
  },
};
const races = read("races.json").map((race) => {
  const next = PASTS[race.id];
  if (!next) throw new Error(`缺少过往 ${race.id}`);
  return {
    id: race.id,
    name: next.name,
    subtitle: next.subtitle,
    description: next.description,
    recommended: next.recommended,
    passive: next.passive,
    hooks: next.hooks,
    dungeonAffinity: next.affinity,
    trait: next.trait,
  };
});
write("races.json", races);

// ---------------------------------------------------------------------------
// 6) 职业解耦:移除与过往重叠的钩子 + 改名
// ---------------------------------------------------------------------------
const CLASS_OVERRIDES = {
  fighter: { name: "前哨守卫", hooks: {}, description: "前哨守卫相信一件事：只要自己还站在入口，后面的人就能把物资搬回去。他们把盾和站位练成一种本能。" },
  archer: { name: "雨幕射手", hooks: {}, description: "雨幕射手把雨滴当作刻度。站位与队形交给别人，他们只负责在雨线里算准提前量。" },
  knight: { name: "盾墙继承者", hooks: {}, description: "盾墙继承者从旧世界的防暴手册里学会了怎么站住。他们相信一排盾牌能挡住的不只是攻击。" },
  barbarian: { name: "撕裂者", hooks: {}, description: "撕裂者把疼痛当成燃料。他们不靠低血搏命，只靠一次比一次更重的挥砍把防线撕开。" },
  warlock: { name: "腐蚀研究者", hooks: {}, description: "腐蚀研究者把每一次腐蚀都写成数据。他们不介意被污染，只介意样本不够多。" },
  alchemist: { name: "药剂师", hooks: {}, description: "药剂师相信所有问题都能用正确的配方解决。他们用毒雾和药剂覆盖战场，顺手给同伴递一瓶解药。" },
  shaman: { name: "滤塔祭司", hooks: {}, description: "滤塔祭司照看聚落唯一还能用的滤水塔。他们相信干净的水能冲掉诅咒，也相信每一次净化都有代价。" },
  bard: { name: "雨鼓手", hooks: {}, description: "雨鼓手用锈铁皮敲出节奏。鼓点一响，拾荒队就知道什么时候该冲、什么时候该退。" },
  scholar: { name: "信号解读者", hooks: {}, description: "信号解读者能读懂旧文明的广播残片。别人眼里的乱码，是他们手里的操作手册。" },
  apprentice: { name: "电塔学徒", hooks: {}, description: "电塔学徒刚学会接线，也刚学会在电量见底之前收手。他们不擅长的东西还很多。" },
  paladin: { name: "逆咒者", hooks: { invertDebuffSign: true }, description: "逆咒者背着一面从镜面废料场捡来的镜子。所有落在他们身上的诅咒，都会先被镜子照一遍。" },
};
const classes = read("classes.json").map((cls) => {
  const override = CLASS_OVERRIDES[cls.id] ?? {};
  const next = { ...cls, ...override };
  if (override.hooks !== undefined) next.hooks = override.hooks;
  if (override.name) next.name = override.name;
  if (override.description) next.description = override.description;
  return next;
});
write("classes.json", classes);

// ---------------------------------------------------------------------------
// 7) 其余文案:旧副本名替换 + 无人区语境
// ---------------------------------------------------------------------------
for (const file of ["skills.json", "monsters.json", "titles.json", "quests.json", "npcs.json"]) {
  write(file, retheme(read(file)));
}

// 怪物去"居民"化
const monNames = {
  "goblin-scavenger": ["苔皮游荡者", "浑身苔藓的游荡生物", "被孢毒改变了皮肤的人形生物，早已不再成群居住，只在废弃巷道里游荡。"],
  "goblin-overseer": ["苔皮巢主", "盘踞在旧工棚里的苔皮生物", "它戴着从旧世界工头身上剥下来的头盔，把工棚当成巢穴。"],
  "ash-cultist": ["余燃者", "被祭火余温改变的人形", "它已经不记得为什么要守火，只记得火不能灭。"],
};
const monsters = read("monsters.json").map((monster) => {
  const override = monNames[monster.id];
  if (!override) return monster;
  return { ...monster, name: override[0], subtitle: override[1], description: override[2] };
});
write("monsters.json", monsters);

console.log("maze-content done");
