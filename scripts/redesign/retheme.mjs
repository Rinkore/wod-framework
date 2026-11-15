// 雨蚀荒原内容重铸:世界观文案替换 + 过往(11)/职业(18) 全量重写。一次性脚本。
import fs from "node:fs";

const read = (name) => JSON.parse(fs.readFileSync(`content/${name}`, "utf8"));
const write = (name, data) =>
  fs.writeFileSync(`content/${name}`, JSON.stringify(data, null, 2) + "\n", "utf8");

// ---------------------------------------------------------------------------
// 1) 世界观术语字典:作用于全部内容字符串值(中文),id 不受影响。
// ---------------------------------------------------------------------------
const DICT = [
  ["边境议会", "拾荒行会"],
  ["议会", "行会"],
  ["边境", "荒原"],
  ["灰烬纪元", "雨季纪"],
  ["灰烬", "燃烬"],
  ["霜语", "冻眠"],
  ["铸炉", "锈炉"],
  ["穹库", "军械库"],
  ["王座", "王庭"],
  ["书库", "档案库"],
  ["地精", "苔皮拾荒者"],
  ["骷髅", "遗骸"],
  ["食尸鬼", "食骸者"],
  ["幽魂", "游魂"],
  ["幽灵", "游魂"],
  ["女妖", "哀鸣者"],
  ["信徒", "燃焰信徒"],
  ["圣光", "辐光"],
  ["奥术", "电磁"],
  ["冒险者", "拾荒者"],
  ["火把", "雨灯"],
  ["族裔", "经历"],
];

function retheme(value) {
  if (typeof value === "string") {
    let out = value;
    for (const [from, to] of DICT) out = out.split(from).join(to);
    return out;
  }
  if (Array.isArray(value)) return value.map(retheme);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retheme(v)]));
  }
  return value;
}

// ---------------------------------------------------------------------------
// 2) pack.json
// ---------------------------------------------------------------------------
write("pack.json", {
  formatVersion: 1,
  id: "ember-marches",
  name: "雨蚀荒原",
  version: "0.6.0",
  description:
    "一片被永不停歇的酸雨浸透的废土。旧文明的楼宇只剩下半截，幸存者聚居在高层檐廊与排水系统里，等待雨歇的间隙下到地面拾荒。",
  lore:
    "雨季纪 117 年，酸雨已经下了几代人。低处是被淹没的街道与锈穿的轨道，高处是拾荒者用缆索和雨布搭起的檐廊聚落。行会把旧文明残骸里的物资写成悬赏：沉水矿道、冻眠墓窖、低语档案库、黑曜王庭——每一处都有值得冒雨下去的东西。你召集的不是英雄，是一支愿意在雨里走远的拾荒队。",
});

// ---------------------------------------------------------------------------
// 3) 过往(races.json,保留 race id) —— 推荐 3 点 + 钩子 + 副本亲和
// ---------------------------------------------------------------------------
const mods = (...rows) => rows.map(([kind, amount]) => ({ kind, amount }));
const RACES = {
  borderlander: {
    name: "檐上跑者",
    subtitle: "在楼宇檐脊之间长大",
    description:
      "你从小在高层檐廊的雨布与缆索间穿梭，知道哪一块广告牌能承重、哪一条排水沟通向废墟。下雨的时候，别人躲，你赶路。",
    recommended: { agi: 2, dex: 1 },
    passive: { hpPct: 0.05, manaPct: 0.05 },
    hooks: {
      ignoresEnemyFormation: true,
      positionModifiers: [
        { position: "back", modifiers: mods(["hit", 3], ["crit", 4]) },
      ],
    },
    dungeonAffinity: {
      themes: ["archive", "vault"],
      modifiers: mods(["evasion", 4]),
      label: "高空路线",
    },
    trait: {
      name: "檐脊捷径",
      description:
        "站在后排时命中 +3、暴击率 +4%；近战攻击可以越过敌方前排；在档案库与军械库类副本中额外获得闪避 +4%。",
    },
  },
  dinturan: {
    name: "闸门守卫",
    subtitle: "守着排水闸门长大的人",
    description:
      "你的童年是沉重的铁闸门和不断上涨的污水。你知道怎么站住脚跟，也知道一次退让会让整条巷道灌满水。",
    recommended: { con: 2, str: 1 },
    passive: { hpPct: 0.15, manaPct: -0.05 },
    hooks: {
      positionModifiers: [
        { position: "front", modifiers: mods(["damageTaken", -8], ["armor", 6]) },
      ],
    },
    dungeonAffinity: {
      themes: ["mine", "foundry"],
      modifiers: mods(["damageTaken", -4]),
      label: "封闭巷道",
    },
    trait: {
      name: "闸前不退",
      description:
        "站在前排时受到伤害 -8%、护甲 +6；在矿道与锈炉类副本中额外获得受到伤害 -4%。",
    },
  },
  gnome: {
    name: "管道孩童",
    subtitle: "在下水管网里认路",
    description:
      "你比同龄人更熟悉管道的回声。哪里能钻过去、哪里会塌，你听一声滴水就知道。",
    recommended: { int: 2, agi: 1 },
    passive: { hpPct: -0.05, manaPct: 0.15 },
    hooks: {
      positionModifiers: [
        { position: "flank", modifiers: mods(["initiative", 4], ["energyRegen", 1]) },
      ],
    },
    dungeonAffinity: {
      themes: ["archive", "crypt"],
      modifiers: mods(["energyRegen", 1]),
      label: "管线脉络",
    },
    trait: {
      name: "管线脉络",
      description:
        "站在中排时先攻 +4、每回合额外恢复 1 点法力；在档案库与墓窖类副本中再获得法力回复 +1。",
    },
  },
  halfling: {
    name: "回声猎手",
    subtitle: "靠回声判断猎物的位置",
    description:
      "废墟里的回声比眼睛可靠。你学会在雨声里分辨脚步，也学会一次呼吸之间出手两次。",
    recommended: { agi: 2, dex: 1 },
    passive: { hpPct: 0.05, manaPct: 0.05 },
    hooks: { extraActions: 1 },
    dungeonAffinity: {
      themes: ["crypt", "vault"],
      modifiers: mods(["initiative", 2]),
      label: "回声定位",
    },
    trait: {
      name: "回声定位",
      description: "每回合额外获得 1 次行动；在墓窖与军械库类副本中额外获得先攻 +2。",
    },
  },
  kargashian: {
    name: "鸦群唤者",
    subtitle: "和雨鸦共享一顿饭的人",
    description:
      "你懂得在废墟顶层呼唤鸦群。它们替你探路，也替你撕开猎物的防线——只要你舍得把最后一块干粮分出去。",
    recommended: { cha: 2, per: 1 },
    passive: { hpPct: 0.1 },
    hooks: { multiTargetBonusPct: 0.1 },
    dungeonAffinity: {
      themes: ["mine", "altar"],
      modifiers: mods(["damageDealt", 4]),
      label: "鸦群盘旋",
    },
    trait: {
      name: "鸦群盘旋",
      description:
        "群攻每多命中 1 个目标，伤害额外 +10%；在矿道与祭坛类副本中造成伤害 +4%。",
    },
  },
  kerasi: {
    name: "净水行者",
    subtitle: "喝过过滤塔最后一口水",
    description:
      "你走遍荒原寻找还能喝的水，身体早被滤芯和苦味磨出了耐性。毒素与诅咒在你身上停留不了多久。",
    recommended: { con: 2, wil: 1 },
    passive: { hpPct: 0.1 },
    hooks: { debuffDurationReduction: 1 },
    dungeonAffinity: {
      themes: ["archive", "crypt"],
      modifiers: mods(["chaosResist", 8]),
      label: "滤净体质",
    },
    trait: {
      name: "滤净体质",
      description:
        "受到的负面效果持续回合 -1；在档案库与墓窖类副本中额外获得混沌抗性 +8%。",
    },
  },
  "mag-mor": {
    name: "镜面病患",
    subtitle: "在镜面废料场里活下来的人",
    description:
      "镜面废料场的碎片改变了你。别人施来的恶意会先经过一面看不见的镜子，再决定落在谁身上。",
    recommended: { wil: 2, per: 1 },
    passive: { manaPct: 0.1 },
    hooks: { debuffReflectChance: 0.25 },
    dungeonAffinity: {
      themes: ["vault", "throne"],
      modifiers: mods(["elementalResist", 8]),
      label: "镜像折返",
    },
    trait: {
      name: "镜像折返",
      description:
        "受到负面效果时 25% 概率原样反弹给施加者；在军械库与王庭类副本中额外获得元素抗性 +8%。",
    },
  },
  partan: {
    name: "旧校舍学徒",
    subtitle: "在倒塌的教室里读完最后一本书",
    description:
      "你在旧校舍的废墟里自学了线路、剂量和一种奇怪的坚持。你施出的每一道技能都比别人更熟练一分。",
    recommended: { int: 2, wil: 1 },
    passive: { manaPct: 0.1 },
    hooks: { skillLevelBonus: 2 },
    dungeonAffinity: {
      themes: ["archive"],
      modifiers: mods(["energyRegen", 1]),
      label: "旧校舍底子",
    },
    trait: {
      name: "旧校舍底子",
      description: "所有技能等级 +2；在档案库类副本中额外获得法力回复 +1。",
    },
  },
  targeshian: {
    name: "省电匠",
    subtitle: "把最后半格电拆成三份用",
    description:
      "你修过荒原上几乎所有型号的电池。别人眼里的废件，在你这儿还能再点亮一次雨灯。",
    recommended: { con: 2, dex: 1 },
    passive: { hpPct: 0.15, manaPct: -0.05 },
    hooks: { energyCostPct: -0.2 },
    dungeonAffinity: {
      themes: ["foundry", "mine"],
      modifiers: mods(["energyRegen", 1]),
      label: "拆件经验",
    },
    trait: {
      name: "拆件经验",
      description:
        "技能法力消耗 -20%；在锈炉与矿道类副本中额外获得法力回复 +1。",
    },
  },
  "tirem-ag": {
    name: "残响赌徒",
    subtitle: "在雨声里押上最后一块干粮",
    description:
      "你在雨夜里赌过太多次命。越是逼近绝境，你的手越稳，出手越狠。",
    recommended: { dex: 2, cha: 1 },
    passive: { hpPct: -0.05, manaPct: 0.15 },
    hooks: { lowHpFuryPct: 0.3 },
    dungeonAffinity: {
      themes: ["altar", "throne"],
      modifiers: mods(["crit", 4]),
      label: "雨夜赌命",
    },
    trait: {
      name: "雨夜赌命",
      description:
        "生命低于 40% 时造成伤害 +30%；在祭坛与王庭类副本中额外获得暴击率 +4%。",
    },
  },
  woodlander: {
    name: "长夜守灯人",
    subtitle: "守着聚落最后一盏雨灯的人",
    description:
      "你负责在长夜里给檐廊的雨灯添油。灯不能灭，人也一样——电见底的时候，你总能再多榨出一点。",
    recommended: { wil: 2, con: 1 },
    passive: { hpPct: 0.05, manaPct: 0.05 },
    hooks: { energySurgeRegen: 4 },
    dungeonAffinity: {
      themes: ["crypt", "foundry"],
      modifiers: mods(["healing", 8]),
      label: "守灯余温",
    },
    trait: {
      name: "守灯余温",
      description:
        "法力低于 30% 时每回合额外恢复 4 点法力；在墓窖与锈炉类副本中额外获得治疗效果 +8%。",
    },
  },
};

const races = read("races.json").map((race) => {
  const next = RACES[race.id];
  if (!next) throw new Error(`缺少过往 ${race.id} 的新文案`);
  return {
    id: race.id,
    name: next.name,
    subtitle: next.subtitle,
    description: next.description,
    recommended: next.recommended,
    passive: next.passive,
    hooks: next.hooks,
    dungeonAffinity: next.dungeonAffinity,
    trait: next.trait,
  };
});
write("races.json", races);

// ---------------------------------------------------------------------------
// 4) 职业(classes.json,保留 18 个旧 id) —— 全量重写名称/钩子/技能池
// ---------------------------------------------------------------------------
const ALL_WEAPONS = ["sword", "axe", "hammer", "bow", "staff", "dagger", "book", "instrument"];
const CLASSES = {
  fighter: {
    name: "檐前守卫",
    subtitle: "站在队伍最前面的人",
    role: "tank",
    attackStat: "str",
    attackDamageType: "cutting",
    recommended: { str: 2, con: 1 },
    modifiers: mods(["damageTaken", -8], ["armor", 5]),
    hooks: {
      positionModifiers: [
        { position: "front", modifiers: mods(["damageTaken", -6], ["armor", 4]) },
      ],
    },
    skillIds: ["heavy-strike", "shield-bash", "block-stance", "war-cry"],
    description:
      "檐前守卫相信一件事：只要自己还站在入口，后面的人就能把物资搬回去。他们把盾和站位练成一种本能。",
  },
  gladiator: {
    name: "锈刃客",
    subtitle: "在废料场斗笼里活下来的人",
    role: "damage",
    attackStat: "str",
    attackDamageType: "cutting",
    recommended: { str: 2, dex: 1 },
    modifiers: mods(["critDamage", 15]),
    skillIds: ["twin-strike", "backstab", "heavy-strike", "armor-breaker"],
    description:
      "锈刃客不在意武器是不是锈的，只在意它够不够快。斗笼教会他们把握每一次暴露破绽的瞬间。",
  },
  barbarian: {
    name: "残响暴徒",
    subtitle: "越疼越清醒的疯子",
    role: "damage",
    attackStat: "str",
    recommended: { str: 2, con: 1 },
    modifiers: mods(["damageDealt", 8], ["damageTaken", 5]),
    hooks: { lowHpFuryPct: 0.35 },
    skillIds: ["cleave", "heavy-strike", "berserk", "war-cry"],
    description:
      "残响暴徒把疼痛当成燃料。血量见底的时候，他们的铲子反而抡得更快。",
  },
  hunter: {
    name: "陷阱猎手",
    subtitle: "用锈钉和毒草布下陷阱",
    role: "damage",
    attackStat: "dex",
    recommended: { dex: 2, per: 1 },
    modifiers: mods(["dotPotency", 15]),
    skillIds: ["venom-blade", "precise-shot", "weak-spot", "venom-cloud"],
    description:
      "陷阱猎手不追求一击致命。他们用锈钉、毒草和耐心，把猎物拖到血流干的那一刻。",
  },
  archer: {
    name: "雨幕射手",
    subtitle: "在雨线里算提前量的人",
    role: "damage",
    attackStat: "dex",
    recommended: { per: 2, dex: 1 },
    modifiers: mods(["hit", 4]),
    hooks: {
      positionModifiers: [
        { position: "back", modifiers: mods(["hit", 3], ["crit", 4]) },
      ],
    },
    skillIds: ["precise-shot", "arrow-rain", "scatter-shot", "eagle-eye"],
    description:
      "雨幕射手把雨滴当作刻度。站在后排时，他们能算出箭矢穿过雨幕的每一寸偏移。",
  },
  mage: {
    name: "雷声术士",
    subtitle: "用旧电池召唤雷暴的人",
    role: "damage",
    attackStat: "int",
    attackDamageType: "lightning",
    recommended: { int: 2, wil: 1 },
    modifiers: mods(["damageDealt", 10], ["elementalResist", 10]),
    hooks: { skillPowerPct: 0.12 },
    skillIds: ["chain-lightning", "firebolt", "frost-lance", "mana-surge"],
    description:
      "雷声术士把捡来的电池串成阵列，一次放电就是一场小型雷暴。他们相信所有的旧文明，都死在电不够用上。",
  },
  warlock: {
    name: "腐蚀研究者",
    subtitle: "记录孢毒与酸蚀的人",
    role: "damage",
    attackStat: "int",
    attackDamageType: "shadow",
    recommended: { int: 2, wil: 1 },
    modifiers: mods(["dotPotency", 10]),
    hooks: { skillLevelBonus: 1 },
    skillIds: ["corrosive-touch", "venom-cloud", "shadow-drain", "arcane-missile"],
    description:
      "腐蚀研究者把每一次腐蚀都写成数据。他们不介意被污染，只介意样本不够多。",
  },
  alchemist: {
    name: "药剂师",
    subtitle: "把危险装进瓶子的人",
    role: "support",
    attackStat: "int",
    attackDamageType: "nature",
    recommended: { int: 2, dex: 1 },
    modifiers: mods(["healing", 8]),
    hooks: { multiTargetBonusPct: 0.1 },
    skillIds: ["venom-cloud", "venom-blade", "renew", "corrosive-touch"],
    description:
      "药剂师相信所有问题都能用正确的配方解决。他们用毒雾和药剂覆盖战场，顺手给同伴递一瓶解药。",
  },
  priest: {
    name: "疗雾者",
    subtitle: "在檐廊下缝合伤口",
    role: "healer",
    attackStat: "wil",
    attackDamageType: "holy",
    recommended: { wil: 2, cha: 1 },
    modifiers: mods(["healing", 10]),
    hooks: { skillPowerPct: 0.1 },
    skillIds: ["lesser-heal", "healing-wave", "renew", "holy-smite"],
    description:
      "疗雾者用蒸馏水和辐光缝合伤口。他们不承诺把人救活，只承诺不会先松手。",
  },
  shaman: {
    name: "净水祭司",
    subtitle: "守着滤水塔的人",
    role: "healer",
    attackStat: "wil",
    attackDamageType: "nature",
    recommended: { wil: 2, con: 1 },
    modifiers: mods(["healing", 8], ["chaosResist", 8]),
    hooks: { debuffDurationReduction: 1 },
    skillIds: ["healing-wave", "purifying-light", "sacred-shield", "venom-cloud"],
    description:
      "净水祭司照看聚落唯一还能用的滤水塔。他们相信干净的水能冲掉诅咒，也相信每一次净化都有代价。",
  },
  bard: {
    name: "雨鼓手",
    subtitle: "用鼓点盖过雨声的人",
    role: "support",
    attackStat: "cha",
    attackDamageType: "shadow",
    recommended: { cha: 2, agi: 1 },
    modifiers: mods(["energyRegen", 2], ["initiative", 2]),
    hooks: { multiTargetBonusPct: 0.12 },
    skillIds: ["discordant-note", "war-song", "battle-horn", "requiem"],
    description:
      "雨鼓手用锈铁皮敲出节奏。鼓点一响，拾荒队就知道什么时候该冲、什么时候该退。",
  },
  musician: {
    name: "拾音者",
    subtitle: "在废墟里收集声音的人",
    role: "support",
    attackStat: "cha",
    attackDamageType: "shadow",
    recommended: { cha: 2, per: 1 },
    modifiers: mods(["initiative", 3], ["energyRegen", 2]),
    hooks: { cooldownReduction: 1 },
    skillIds: ["discordant-note", "battle-horn", "inspiring-note", "hypnotize"],
    description:
      "拾音者能分辨雨声里每一种不该出现的声音。他把这些声音编成曲子，也编成武器。",
  },
  engineer: {
    name: "拆解师",
    subtitle: "把一发子弹拆成三颗炸弹",
    role: "support",
    attackStat: "dex",
    recommended: { dex: 2, con: 1 },
    modifiers: mods(["damageTaken", -5], ["energyRegen", 2]),
    hooks: { spreadSingleTarget: true, spreadPenaltyPct: -0.2 },
    skillIds: ["quick-shot", "ice-barrier", "block-stance", "thorn-aura"],
    description:
      "拆解师的手更习惯握着扳手而不是武器。他们能把一次单体射击拆成覆盖整个敌阵的弹片。",
  },
  scholar: {
    name: "档案解读者",
    subtitle: "在旧文明档案里找答案的人",
    role: "support",
    attackStat: "int",
    recommended: { int: 2, per: 1 },
    modifiers: mods(["energyRegen", 2], ["elementalResist", 5]),
    hooks: { skillLevelBonus: 2 },
    skillIds: ["arcane-missile", "eagle-eye", "mana-surge", "ice-barrier"],
    description:
      "档案解读者能读懂旧文明的说明书。别人眼里的乱码，是他们手里的操作手册。",
  },
  drifter: {
    name: "拾荒游侠",
    subtitle: "什么都会一点的万能拾荒者",
    role: "damage",
    attackStat: "dex",
    recommended: { dex: 1, per: 1, con: 1 },
    modifiers: mods(["damageDealt", 5], ["evasion", 3]),
    skillAccess: "all",
    skillIds: ["heavy-strike", "quick-shot", "firebolt", "lesser-heal"],
    description:
      "拾荒游侠没有专精，因为荒原不给他们专精的机会。只要捡到趁手的武器，他们就能立刻学会怎么用。",
  },
  paladin: {
    name: "竖镜人",
    subtitle: "把恶意照回原处的人",
    role: "tank",
    attackStat: "str",
    attackDamageType: "holy",
    recommended: { str: 2, wil: 1 },
    modifiers: mods(["damageTaken", -8], ["healing", 8]),
    hooks: { invertDebuffSign: true },
    skillIds: ["heavy-strike", "holy-smite", "sacred-shield", "block-stance"],
    description:
      "竖镜人背着一面从镜面废料场捡来的镜子。所有落在他们身上的诅咒，都会先被镜子照一遍。",
  },
  knight: {
    name: "盾墙继承者",
    subtitle: "学会了旧世界盾墙阵的人",
    role: "tank",
    attackStat: "str",
    recommended: { str: 2, con: 1 },
    modifiers: mods(["armor", 8], ["damageTaken", -5]),
    hooks: {
      positionModifiers: [
        { position: "front", modifiers: mods(["damageTaken", -8]) },
      ],
    },
    skillIds: ["shield-bash", "block-stance", "provoke", "armor-breaker"],
    description:
      "盾墙继承者从旧世界的防暴手册里学会了怎么站住。他们相信一排盾牌能挡住的不只是攻击。",
  },
  apprentice: {
    name: "电路学徒",
    subtitle: "刚学会接线的年轻人",
    role: "damage",
    attackStat: "int",
    recommended: { int: 2, agi: 1 },
    modifiers: mods(["energyRegen", 3]),
    hooks: { energyCostPct: -0.2, energySurgeRegen: 3 },
    skillIds: ["firebolt", "arcane-missile", "mana-surge", "ice-barrier"],
    description:
      "电路学徒还在犯错，但学得很快。他们懂得怎么把最后一点电用在最该用的地方。",
  },
};

const KEEP_IDS = new Set(Object.keys(CLASSES));
const classes = read("classes.json")
  .filter((cls) => KEEP_IDS.has(cls.id))
  .map((cls) => {
    const next = CLASSES[cls.id];
    return {
      id: cls.id,
      name: next.name,
      subtitle: next.subtitle,
      description: next.description,
      role: next.role ?? cls.role,
      attackStat: next.attackStat ?? cls.attackStat,
      attackDamageType: next.attackDamageType ?? cls.attackDamageType,
      recommended: next.recommended,
      modifiers: next.modifiers,
      hooks: next.hooks ?? {},
      skillAccess: next.skillAccess ?? "own",
      hpPct: cls.hpPct,
      manaPct: cls.manaPct,
      reactionMod: cls.reactionMod,
      premium: cls.premium,
      weaponProficiencies: next.skillAccess === "all" ? ALL_WEAPONS : cls.weaponProficiencies,
      skillIds: next.skillIds,
      startingItemIds: cls.startingItemIds,
      color: cls.color,
    };
  });
write("classes.json", classes);

// ---------------------------------------------------------------------------
// 5) 技能名/描述重铸(保留 id 与全部机制)
// ---------------------------------------------------------------------------
const SKILLS = {
  firebolt: ["燃烧瓶", "掷出点燃的旧世界燃料罐，伤害 = 基础 + 智力×1.2（元素）。"],
  flamestorm: ["燃油风暴", "点燃的燃料铺满敌阵：伤害 = 基础 + 智力×0.85（元素），并留下每回合（4 + 智力×0.4）的灼烧，持续 2 回合。"],
  "frost-lance": ["冻蚀长钉", "钉入目标的霜蚀钢钉：伤害 = 基础 + 智力×1.05（元素），并使其先攻降低（6 + 智力×0.5 点），持续 2 回合。"],
  "chain-lightning": ["电弧链", "旧电池组的放电在敌阵中跳跃，伤害 = 基础 + 智力×0.95（元素）。"],
  "arcane-missile": ["电磁飞弹", "没有吟唱的电磁冲击，伤害 = 基础 + 智力×0.75（混沌）。"],
  "mana-surge": ["电容涌动", "短接一整组电容：自身每回合额外恢复（6 + 智力×0.5）点法力，持续 4 回合。"],
  "ice-barrier": ["冻蚀护壁", "凝出厚实的霜蚀屏障：吸收（12 + 智力×2.5）点伤害，持续 3 回合。"],
  "eagle-eye": ["鹰眼透镜", "戴上拾来的战术透镜：自身命中提升（6 + 感知×0.8 点）、暴击率提升（6 + 感知×0.6%），持续 3 回合。"],
  "healing-wave": ["医疗波", "医用喷雾覆盖全队，每人生效 = 基础 + 意志×0.6 点生命。"],
  renew: ["再生剂", "立即恢复（4 + 意志×0.5）点生命，并在此后每回合继续恢复同量，持续 3 回合。"],
  "holy-smite": ["辐光灼击", "把辐光聚焦成灼热的束流，伤害 = 基础 + 意志×1.1（混沌）。"],
  "shadow-drain": ["暗蚀汲取", "抽取目标的生命：伤害 = 基础 + 意志×0.85（混沌），并为自己附加每回合（2 + 意志×0.3）的持续治疗，持续 2 回合。"],
  "sacred-shield": ["辐光护罩", "滤光片拼成的屏障：为目标附加可吸收（15 + 意志×2.2）点伤害的护罩，持续 3 回合。"],
  "purifying-light": ["滤光护符", "分发给全队的滤光片：全队混沌抗性提升（10 + 意志×0.8%），持续 3 回合。"],
  requiem: ["静默挽歌", "安抚的低声哼唱流过全队，每人生效 = 基础 + 魅力×0.55 点生命。"],
  hypnotize: ["白噪低语", "白噪耳机里的循环低语：有 50% 概率沉默其 2 回合，无法使用技能。"],
  "thorn-aura": ["荆棘镜面", "拼贴的镜片与铁刺：3 回合内反弹 25% 所受到的攻击伤害。"],
  "sacrificial-flame": ["燃素引火", "以血引燃燃料：伤害 = 基础 + 意志×1.1（元素），并点燃（4 + 意志×0.4）点灼烧，持续 3 回合。"],
  "fire-chorus": ["燃油合唱", "齐声点燃燃油沟，伤害 = 基础 + 智力×0.8（元素）。"],
  "magma-slam": ["熔芯重锤", "裹着熔芯的旧世界重锤，伤害 = 基础 + 力量×1.1（元素）。"],
  eruption: ["熔芯喷发", "地下的熔芯管路破裂，伤害 = 基础 + 智力×0.9（元素）。"],
  "venom-cloud": ["孢毒雾", "孢毒弥漫整个敌阵：伤害 = 基础 + 智力×0.7（元素），并使其中毒（3 + 智力×0.4）点，持续 3 回合。"],
  "shadow-breath": ["暗蚀吐息", "喷吐吞噬光线的暗蚀雾，伤害 = 基础 + 力量×1.0（混沌）。"],
  "dark-mend": ["暗蚀敷愈", "用暗蚀菌丝缝合伤口，恢复 = 基础 + 意志×1.0 点生命。"],
};

const skills = read("skills.json").map((skill) => {
  const override = SKILLS[skill.id];
  const next = retheme(skill);
  if (override) {
    next.name = override[0];
    next.description = override[1];
  }
  return next;
});
write("skills.json", skills);

// ---------------------------------------------------------------------------
// 6) 怪物名/描述重铸(保留 id 与数值)
// ---------------------------------------------------------------------------
const MONSTERS = {
  "mine-bat": ["洞巢雨蝠", "积水穹顶的雨蝠", "在沉水矿道的穹顶筑巢，靠回声和雨声分辨猎物。"],
  "goblin-scavenger": ["苔皮拾荒者", "浑身苔藓的拾荒者", "被孢毒改变了皮肤的人形生物，成群守着废弃巷道，看到雨灯就会围上来。"],
  "goblin-overseer": ["苔皮监工", "让苔皮拾荒者低头的东西", "它戴着从旧世界工头身上剥下来的头盔，用一根锈镐维持秩序。"],
  "skeleton-guard": ["锈甲守骸", "旧防暴部队的残骸", "防暴装甲还扣在身上，骨头早已被水泡成了灰色。它只认得巡逻路线。"],
  "frost-wraith": ["冻眠游魂", "在墓窖里继续值班的人", "冻眠墓窖启动过应急程序，值班人员的意识被留在了冷雾里。"],
  "frost-banshee": ["冻眠哀鸣者", "循环播放的警报声", "警报系统坏掉了，只剩下哀鸣。它会用同样的声音回应活人。"],
  "ash-hound": ["燃烬猎犬", "被燃烬腌过的犬形生物", "毛发间常燃不灭，叼走燃焰信徒的供品，也叼走迷路的拾荒者。"],
  "ash-cultist": ["燃焰信徒", "相信火能把雨烧停的人", "他们守着献焰祭坛，把能烧的都喂给那团火，包括自己。"],
  "lava-elemental": ["熔芯构装", "祭坛底下的旧世界机器", "冷却管路早已失效，它还在按最后一个指令继续浇筑。"],
  "cinder-slug": ["燃渣蛞蝓", "在锈炉废料堆里爬行的东西", "表面结着烧过的渣壳，爬过的地方会留下一道温热的痕迹。"],
  "forge-ghoul": ["炉底食骸", "在锈炉底层啃食废料的人形", "它们不再需要食物，只是本能地咀嚼一切能咬碎的东西。"],
  "slag-hound": ["熔渣猎犬", "熔渣堆里守食的犬形生物", "移动时不断掉落冷却的渣块，喉咙深处透出微光。"],
  "slag-golem": ["熔渣构装", "锈炉的搬运单元", "它还在执行搬运熔渣的旧任务，把挡路的一切都扫进坩埚。"],
  "ink-wraith": ["墨蚀幽灵", "档案库墨池的产物", "被墨与酸蚀浸泡过的数据载体，会用旧文明口音念出档案编号。"],
  "archive-sentinel": ["档案防卫机", "档案库的安保单元", "它把一切未登记的活体识别为入侵者，并执行隔离程序。"],
  "page-eater": ["蚀页兽", "啃食档案的软体生物", "它把纸质档案吃掉后，会在身上显出吃下去的文字。"],
  "forbidden-scribe": ["禁读抄录者", "被档案同化的人形", "它抄录了太多不该读的内容，如今只剩下抄写这个动作。"],
  "rime-stalker": ["冻痕潜行者", "冰层下的伏击者", "皮肤与霜冻融在一起，移动时几乎没有声音。"],
  "frost-revenant": ["冻归遗骸", "从冰层里爬回来的旧守望者", "冰窖守卫的遗骸重新站了起来，还认得古老的哨位。"],
  "hail-caller": ["唤雹者", "站在高处呼唤冰雨的人", "它相信一场足够大的冰雹能洗掉废土上的所有痕迹。"],
  "ice-warden": ["冰窖守望者", "冰穹军械库的最后守卫", "它冻在军械库的门前，却从没放下过手里的武器。"],
  "obsidian-knight": ["黑曜执刃者", "王庭的旧卫队", "黑曜石甲片下没有活人，只有一个不断巡逻的姿势。"],
  "void-priest": ["虚空执礼者", "王庭仪式的执行者", "它把虚空当作新的神，把每一个闯入者当作祭品。"],
  "shadow-drake": ["影鳞巨蜥", "王庭地下的爬行巨兽", "鳞片吸光，呼吸带蚀。它把王庭的回廊当作自己的洞穴。"],
  "throne-tyrant": ["王庭暴君", "坐在王庭最深处的东西", "没人知道它原本是什么。它只是从未离开过那张椅子，也从未让任何人离开。"],
};

const monsters = read("monsters.json").map((monster) => {
  const override = MONSTERS[monster.id];
  const next = retheme(monster);
  if (override) {
    next.name = override[0];
    next.subtitle = override[1];
    next.description = override[2];
  }
  return next;
});
write("monsters.json", monsters);

// ---------------------------------------------------------------------------
// 7) 地牢名与线路文案重铸(保留结构/编成/数值)
// ---------------------------------------------------------------------------
const DUNGEONS = {
  "abandoned-mine": {
    name: "沉水矿道",
    subtitle: "锈水没过了运矿车",
    description:
      "矿脉早被抽干，雨水却从裂开的顶板灌了进来。行会只提了一个条件：把还能用的滤水设备捞出来，或者确认下面再没有活人。",
  },
  "frost-crypt": {
    name: "冻眠墓窖",
    subtitle: "冷雾里还有人在值班",
    description:
      "旧文明的冻眠设施，应急电源撑了几代人。冷雾里传来规律的报时声，派去回收电池的人没有一个回来报到。",
  },
  "ember-altar": {
    name: "献焰祭坛",
    subtitle: "火焰记得一切",
    description:
      "祭坛的火烧了十七年。燃焰信徒说它在等一个名字，行会说这团火挡了南边的雨道，必须熄灭。",
  },
  "foundry-depths": {
    name: "锈炉深层",
    subtitle: "铁水仍在流动",
    description:
      "锈炉废弃了三十年，炉膛里的铁水却从未冷却。矿工说夜里能听见下面有人在敲钟，行会想确认那是不是一台还能换钱的旧机器。",
  },
  "whispering-archive": {
    name: "低语档案库",
    subtitle: "每一页都在说话",
    description:
      "档案库的门没有锁，进去的人却都说听见有人在书架后念自己的名字。旧文明的知识还在，只是不再欢迎读者。",
  },
  "glacier-vault": {
    name: "冰穹军械库",
    subtitle: "寒冷保存了一切",
    description:
      "冰川下封着旧时代的兵器与尸骨，冰层每年加厚一寸。行会想要的不是武器，而是冰里存着的干燥种子。",
  },
  "obsidian-throne": {
    name: "黑曜王庭",
    subtitle: "王庭从来没有空过",
    description:
      "旧王朝最后一座宫殿沉入地下，黑曜石的王庭一直亮着。行会只想知道，坐在上面的到底还是不是人。",
  },
};
const ROUTES = {
  boss: { name: "深入回收", description: "沿主通道一路清到底，把能带走的都带走。" },
  alchemy: { name: "滤材支线", description: "偏向滤材与药剂的短程支线，路线更短、风险更集中。" },
  forge: { name: "锻件支线", description: "偏向旧世界锻件与零件的短程支线，适合带着拆解工具下地。" },
};

const dungeons = read("dungeons.json").map((dungeon) => {
  const meta = DUNGEONS[dungeon.id];
  if (!meta) throw new Error(`缺少副本 ${dungeon.id} 的新文案`);
  const next = retheme(dungeon);
  next.name = meta.name;
  next.subtitle = meta.subtitle;
  next.description = meta.description;
  next.routes = next.routes.map((route) => {
    const routeMeta = ROUTES[route.kind];
    if (!routeMeta) return route;
    return { ...route, name: routeMeta.name, description: routeMeta.description };
  });
  return next;
});
write("dungeons.json", dungeons);

// ---------------------------------------------------------------------------
// 8) 其余文案: NPC/称号/任务/物品 名称替换 + 全局字典
// ---------------------------------------------------------------------------
const npcs = read("npcs.json").map((npc) => {
  const next = retheme(npc);
  if (npc.id === "npc-warrior") next.name = "滤水游侠";
  if (npc.id === "npc-priest") next.name = "雨幕医师";
  return next;
});
write("npcs.json", npcs);

const TITLE_NAMES = {
  "fame-5": "荒原行者",
  "fame-10": "矿道守望者",
  "fame-20": "锈炉见证者",
  "fame-35": "档案解读者",
  "fame-50": "霜原行者",
  "fame-70": "冰川破晓",
  "fame-90": "黑曜挑战者",
  "fame-120": "王庭觊觎者",
  "fame-160": "荒原传奇",
  "fame-220": "燃烬之名",
  "crypt-warden": "墓窖守夜人",
  "altar-silencer": "止祭者",
  "foundry-witness": "炉心见证者",
  "archive-reader": "低语解读者",
  "vault-breaker": "破冰者",
  "throne-challenger": "王庭挑战者",
};
const titles = read("titles.json").map((title) => {
  const next = retheme(title);
  if (TITLE_NAMES[title.id]) next.name = TITLE_NAMES[title.id];
  return next;
});
write("titles.json", titles);

const quests = read("quests.json").map(retheme);
write("quests.json", quests);

const items = read("items.json").map(retheme);
write("items.json", items);

console.log("雨蚀荒原内容重铸完成:races/classes/pack/skills/items/monsters/dungeons/npcs/titles/quests");
