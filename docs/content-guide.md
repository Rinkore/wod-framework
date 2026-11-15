# 内容编辑指南

本项目的全部游戏内容都在 `content/` 目录。改 JSON → 校验 → 模拟 → 重启，不需要改代码。

```bash
npm run content:check
npm run simulate
```

开发模式下服务端用 `tsx watch` 运行，保存内容文件后会自动重启。

> **当前实现说明（v0.9.1）**：旧 v2 的「八维属性 / 职业 classes.json / 属性训练与重置」已删除。当前角色定位 = 过往 + 武器路径 + 技能树 + 装备；基础数值由过往、等级、技能被动与装备派生。本文中涉及 `classes.json`、八维、`attackStat`、`attributeMods`、属性重置的章节属于旧设计，已不适用。

---

## 1. 内容包结构

| 文件 | 内容 | 顶层结构 |
| --- | --- | --- |
| `pack.json` | 世界元信息、简介 | 对象 |
| `races.json` | 过往 | 数组 |
| `weapons.json` | 武器路径（起始物品、技能树根） | 数组 |
| `skill-trees.json` | 每把武器的技能树节点 | 对象 |
| `skills.json` | 技能（英雄与怪物共用） | 数组 |
| `items.json` | 装备模板 | 数组 |
| `affixes.json` | 随机词缀池 | 数组 |
| `monsters.json` | 怪物 | 数组 |
| `loot-tables.json` | 掉落表 | 数组 |
| `npcs.json` | 固定 NPC 支援模板 | 数组 |
| `titles.json` | 声望称号 | 数组 |
| `quests.json` | 任务定义 | 数组 |
| `dungeons.json` | 迷宫、遭遇、奖励 | 数组 |

服务端启动时会做两层校验：

1. **格式校验**（Zod schema）：字段类型、范围、枚举值。
2. **引用校验**：职业引用的技能是否存在、迷宫引用的怪物是否存在、掉落表引用的物品是否存在、id 是否重复等。

任何错误都会让服务端拒绝启动，并在控制台列出文件与字段路径。修改后先跑 `npm run content:check`。

### 通用约定

- `id` 只能包含小写字母、数字、连字符：`^[a-z0-9-]+$`。
- 显示名、描述、副标题可以自由使用中文/任意文字。
- 不要修改已被存档引用的既有 `id`（英雄的种族/职业、装备的模板、迷宫等）。新增内容请用新 id。
- JSON 不支持注释；不要在文件里写 `//`。
- 所有数值均为整数（除非字段说明为小数）。

---

## 2. `pack.json`

```json
{
  "formatVersion": 1,
  "id": "ember-marches",
  "name": "余烬边境",
  "version": "0.1.0",
  "description": "一句话介绍世界。",
  "lore": "登录页与概览页展示的世界简介。"
}
```

`formatVersion` 目前必须为 `1`。

---

## 3. 种族 `races.json`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一 id |
| `name` / `subtitle` / `description` | string | 展示文本 |
| `bonuses` | 八维部分属性 | STR/CON/INT/DEX/CHA/AGI/PER/WIL 修正，缺省 0 |
| `passive` | object，可选 | `hpPct` / `manaPct` / `initiativePct` / `critPct` / `resist` |
| `trait` | `{name, description}` | 展示用天赋说明（数值效果必须同时写进 `bonuses`/`passive`） |

```json
{
  "id": "borderlander",
  "name": "边境人",
  "subtitle": "在旧国界上长大的人",
  "description": "……",
  "bonuses": { "str": 1, "per": 1, "wil": -1 },
  "passive": { "hpPct": 0.05, "manaPct": 0.05 },
  "trait": { "name": "见多识广", "description": "生命与法力上限提高 5%。" }
}
```

- 新英雄八项裸属性从 1 开始；修正后最低为 1。
- `hpPct` / `manaPct`：小数百分比（0.08 = +8%）。
- `critPct`：暴击率绝对值（0.03 = +3 个百分点）。
- `resist`：按伤害类型，0.1 = 10% 减伤，-0.25 = 25% 易伤。

## 4. 职业 `classes.json`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` / `name` / `subtitle` / `description` | string | 展示 |
| `role` | `tank` / `damage` / `healer` / `support` | 展示与筛选 |
| `attackStat` | 八维之一 | 普通攻击缩放属性 |
| `attackDamageType` | 伤害类型，默认 `cutting` | 普通攻击类型 |
| `attributeMods` | 八维部分属性 | 职业属性修正 |
| `hpPct` / `manaPct` | 小数，默认 0 | 生命/法力百分比修正 |
| `reactionMod` | 整数，默认 0 | 先攻/反应修正 |
| `premium` | boolean，默认 false | 是否标记为进阶职业 |
| `subclasses` | string[]，默认 [] | 21 级子职业名称（展示用，暂未实现选择） |
| `weaponProficiencies` | 武器类型数组 | 本职业可使用的武器类型，见第 6 节 |
| `skillIds` | string[] | **顺序即 AI 优先级** |
| `startingItemIds` | string[] | 初始装备模板；每个部位自动装备第一件 |
| `color` | `#rrggbb`，可选 | 主题色 |

```json
{
  "id": "fighter",
  "name": "战士",
  "subtitle": "受过完整训练的士兵",
  "description": "……",
  "role": "tank",
  "attackStat": "str",
  "attackDamageType": "cutting",
  "attributeMods": { "str": 2, "con": 1, "per": 1 },
  "hpPct": 0.17,
  "manaPct": -0.22,
  "reactionMod": 1,
  "premium": false,
  "weaponProficiencies": ["sword", "axe", "hammer"],
  "skillIds": ["heavy-strike", "shield-bash", "battle-cry"],
  "startingItemIds": ["iron-sword", "leather-armor"],
  "color": "#c87941"
}
```

战斗 AI 仍按 `skillIds` 顺序检查冷却/法力/血量条件；治疗与增益优先于攻击。

## 5. 技能 `skills.json`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` / `name` / `description` | string | 展示 |
| `kind` | `attack` / `heal` / `buff` / `passive` / `trait` | 技能类型 |
| `category` | `basic` / `secondary` / `foreign` / `class`，默认 basic | 训练费用类别 |
| `maxLevel` | 整数，默认 20 | 技能等级上限 |
| `damageType` | 伤害类型，可选 | 打击/斩击/穿刺/火焰/冰霜/闪电/强酸/神圣/暗影/自然 |
| `levelScale` / `weaponScale` / `power` | 数字 | 每英雄等级成长 / 武器伤害倍率 / 基础威力 |
| `baseCritRate` / `baseHitRate` | 数字，可选 | 技能基础暴击率（百分点）/ 基础命中率（%）；攻击技能默认 5 / 90，其他默认 0 / 100 |
| `cooldown` / `energyCost` | 整数 | 冷却 / 法力 |
| `target` | 目标类型 | enemy / all-enemies / ally / all-allies / self |
| `range` | 可选 | melee / ranged / magic；近战只能攻击敌方最前排 |
| `weaponTypes` | 武器类型数组，可选 | 需要对应武器才能使用；缺省为通用技能 |
| `effects` | 效果数组 | 见下 |

**训练经济**

- 技能训练：`基础系数 × 英雄等级 × (英雄等级+1)` EP；`basic=20`、`secondary=40`、`foreign=50`、`class=450`。
- 金币消耗 = EP × 90%。
- 英雄等级 = `levelFromEp(累计 EP)`，阈值 `1000 × (等级−1)²`；训练消耗的是**可用 EP**，不会降低已获得等级。
- 新英雄初始 500 EP / 100 金币，起始武器技能均为 1 级。

**效果**：与旧版相同（stun / buff / debuff / dot / hot）。攻击技能上的 `buff` 给自己，`debuff`/`dot`/`stun` 给目标。

**武器需求**：带 `weaponTypes` 的技能只在装备对应武器时可用；战斗 AI 会跳过不匹配的技能并回退普通攻击。每个职业的初始武器必须在其 `weaponProficiencies` 中，且至少有一个适配初始武器的攻击技能，否则 `content:check` 会报错。

## 5.1 战斗与站位

- 攻击使用**攻防双骰**：
  - 攻击骰 = `2×灵巧 + 敏捷 + 2×当前技能等级 + d20`
  - 防御骰 = `2×灵巧 + 敏捷 + 2×防御熟练 + d20`
  - 攻击骰 > 防御骰才命中；差值 ≥10 视为暴击。
  - 命中后还会判定闪避：`5% + (闪避 - 命中加成)/150`，限制 2%–35%。
- 暴击率 = `3% + 灵巧×0.2% + 种族暴击%`，限制 2%–50%，战斗 buff 后上限 60%；暴击伤害 ×1.7。
- 先攻 = `(敏捷×2 + 感知 + 等级×1.5) × (1 + 种族先攻%) + 职业反应修正`，行动顺序加 d0–5。
- 伤害 = `技能基础值 + 缩放属性×倍率 + 武器伤害`，再乘以伤害浮动、暴击与护甲/抗性。
- 打击/斩击/穿刺受护甲减免：`护甲/(护甲+70)`，上限 75%；元素伤害受对应抗性影响。
- 最大法力受智力/意志/等级/职业与种族法力%影响，并叠加种族 `energyPct`。
- 每回合行动次数 = `1 + floor(敏捷/10)`，上限 3。
- 站位：前排 / 游走 / 后排。普通近战只能攻击敌方前排；游走近战可越过前排攻击非前排，攻击后暴露到下次行动。远程/魔法按目标优先级选敌。
- 提前收队保留已清层掉落；战败只保留 EP 与金币，**不保留任何物品/材料**；只有全通才发放线路完成奖励。
- 迷宫的 `routes[].encounters` 即“层级”，战报会显示“第 N 层”；每条线路独立计算深度与完成奖励。

## 6. 物品 `items.json`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` / `name` / `description` | string | 展示 |
| `kind` | `equipment` / `consumable` / `material`，默认 equipment | 物品大类 |
| `slot` | `weapon` / `armor` / `trinket` / `consumable` / `material` | 部位；材料使用 `material` |
| `rarity` | `common` / `uncommon` / `rare` / `epic` | 决定词缀数量与分解产量 |
| `level` | 1–99 | 物品等级；英雄等级低于此值不能装备 |
| `value` | 整数 | 基础价值（出售价另有系数） |
| `stats` | 部分八维对象，默认 `{}` | 固定属性 |
| `armor` | 整数，可选 | 护甲 |
| `weaponDamage` | 整数，可选 | 武器伤害（只对打击/斩击/穿刺生效） |
| `damageType` | 可选 | 武器伤害类型提示 |
| `weaponType` | 武器类型，武器必填 | sword / axe / hammer / bow / staff / dagger / book / instrument |
| `classes` | string[]，可选 | 显式限定职业，优先于 `weaponProficiencies` |
| `potion` | object，可选 | 消耗品效果：`heal` / `healPct` / `energy` / `energyPct` |
| `charges` | 整数，可选 | 药剂固定为 `1`：每瓶只能饮用一次；库存数量由 `quantity` 堆叠表示 |
| `material` | object，可选 | 材料定义，见下 |

```json
{
  "id": "iron-sword",
  "name": "铁剑",
  "description": "边境铁匠铺里最常见的制式长剑，胜在可靠。",
  "slot": "weapon",
  "rarity": "common",
  "level": 1,
  "value": 18,
  "stats": { "str": 1 },
  "weaponDamage": 6,
  "damageType": "cutting",
  "weaponType": "sword"
}
```

### 材料与炼金药水

材料使用 `kind: "material"`、`slot: "material"`，不能装备、上架市场/拍卖或存入公会，但可以在背包整堆出售。

**炼药材料**

```json
{
  "id": "mine-moss",
  "name": "矿坑苔藓",
  "description": "……",
  "kind": "material",
  "slot": "material",
  "rarity": "common",
  "level": 1,
  "value": 26,
  "stats": {},
  "material": {
    "type": "alchemy",
    "effect": "healing",
    "base": { "heal": 220, "healPct": 0.45 },
    "quality": 1
  }
}
```

- `effect`：`healing` 或 `mana`；同一瓶药水每种效果只能用一个材料。
- `quality`：固定品质 `1` / `2` / `3`（I / II / III）；不再记录百分比浓度。
- `base`：品质 III 时的效果；实际效果倍率 I=30%、II=65%、III=100%，平值取整到 5 的倍数，百分比取整到 5%。
- 混合时每种效果只按自身素材的品质结算，不会被低品质素材拖低。成品模板按效果组合选择 `crafted-healing-potion` / `crafted-mana-potion` / `crafted-hybrid-potion`。
- 旧存档中的浓度材料会在启动时自动折算为 1–3 品质并合并同品质堆叠。
- 成品药剂单次使用；同名且同效果、同品质档的药剂会在背包中按数量堆叠。旧的多充能药剂会在启动时折算为对应瓶数并合并。

**锻造材料**

```json
{
  "id": "forge-material-8",
  "name": "精钢锭（8级）",
  "description": "……",
  "kind": "material",
  "slot": "material",
  "rarity": "common",
  "level": 8,
  "value": 40,
  "stats": {},
  "material": { "type": "forge", "forgeLevel": 8 }
}
```

- `forgeLevel` 必须等于模板 `level`；强化时只会消耗与装备同级的锻造材料。
- 每个装备等级都必须存在对应的锻造材料模板，否则 `content:check` 会报错。
- 强化费用 = `2^当前强化等级`（+0→+1 为 1 个，+3→+4 为 8 个，+9→+10 为 512 个）。
- 分解返还：普通 1、精良 2、稀有 4、史诗 8 个同级材料；强化投入不返还。

### 词缀 `affixes.json`

| 字段 | 说明 |
| --- | --- |
| `id` / `name` | 唯一 id；`name` 会作为掉落名称前缀，例如「锋锐的」 |
| `stat` | 八维之一或 `armor` |
| `min` / `max` | 单条词缀的随机区间（整数） |
| `slots` | 可出现的部位数组 |

稀有度词缀数量：普通 0、精良 1、稀有 2、史诗 3。掉落时从该部位可用词缀中不重复抽取，每条数值随机。

### 掉落表 `loot-tables.json`

```json
{
  "id": "mine-common",
  "chance": 0.4,
  "rolls": 1,
  "entries": [
    { "templateId": "copper-ring", "weight": 3 },
    { "templateId": "forge-material-1", "weight": 4, "quantity": [1, 2] },
    { "templateId": "mine-moss", "weight": 2, "quantity": [1, 1], "quality": 2 }
  ]
}
```

- `chance`：本次调用是否掉落的概率。
- `rolls`：掉落成功后抽几次。
- `entries[].weight`：相对权重，越大越常见。
- `entries[].quantity`：材料掉落数量区间；非材料条目忽略。
- `entries[].quality`：炼药材料本次掉落的品质覆盖（1–3）；不填则使用模板固定品质。支线可用它提供更高品质。
- 怪物每击杀一次会调用一次自己的 `lootTableId`；线路全通奖励会再调用一次线路的 `rewards.lootTableId`。
- **迷宫掉落表不应直接出现消耗品/药水**；药水由炼药制作或来自旧存档。`content:check` 会拒绝直接掉药水的表。

---

## 7. 怪物 `monsters.json`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` / `name` / `subtitle` / `description` | string | 展示 |
| `level` | 整数 | 等级 |
| `stats` | 完整八维 | 基础属性 |
| `hpMultiplier` | 小数，默认 1 | 生命倍率（Boss 用 2–5） |
| `damageMultiplier` | 小数，默认 1 | **全部攻击伤害倍率**（主要难度旋钮） |
| `armor` | 整数，默认 0 | 对打击/斩击/穿刺的护甲减伤 |
| `resist` | 可选 | 各伤害类型抗性 |
| `skillIds` | string[] | 技能与优先级 |
| `xp` | 整数 | 击杀获得的 EP（字段名保留为 xp） |
| `gold` | `[min, max]` | 击杀金币 |
| `lootTableId` | 可选 | 击杀掉落表 |

生命公式：`round((3 + 体质×2 + 等级×3) × hpMultiplier)`；英雄生命为 `round((5 + 体质×6 + 等级×2) × (1+生命%))`。

**调难度优先改**：`damageMultiplier`、`hpMultiplier`、数量、群攻技能；其次才是改基础属性（会影响攻防检定/先攻）。

---

## 8. 迷宫 `dungeons.json`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` / `name` / `subtitle` / `description` | string | 展示 |
| `kind` | `standard` / `appointment`，默认 standard | 常驻或预约迷宫 |
| `schedule` | object，可选 | 预约迷宫必填：`{startHour,endHour,repeatDays}`，按本地小时判断 |
| `routes` | 数组，至少 1 | 同一迷宫的多条线路；必须恰好有一条 `kind:"boss"` |
| `npcAssistIds` | string[]，默认 `[]` | 该迷宫允许携带的 NPC 支援 id，见 `npcs.json` |
| `theme` | string，可选 | 前端主题图标：`mine` / `crypt` / `altar` 等 |

### 线路 `routes[]`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` / `name` / `description` | string | 线路 id 在迷宫内唯一；默认线路为 `kind:"boss"` |
| `kind` | `boss` / `alchemy` / `forge` | 讨伐 / 炼金支线 / 锻造支线 |
| `durationSeconds` | 整数 | 线路全通真实时长；实际远征按目标深度折算 |
| `encounters` | 数组，1–10 | 按顺序发生的战斗 |
| `rewards` | object | 线路全通金币区间、EP、声望、掉落表 |
| `rewardTags` | string[] | UI 展示的预期奖励标签，如 `["炼金素材","更高品质"]` |

```json
{
  "id": "boss",
  "name": "讨伐监工",
  "kind": "boss",
  "description": "……",
  "durationSeconds": 60,
  "encounters": [
    {
      "name": "塌陷的入口",
      "description": "……",
      "monsters": [{ "monsterId": "mine-bat", "count": 2 }],
      "gold": [5, 10],
      "monsterPower": 60
    }
  ],
  "rewards": { "gold": [35, 55], "ep": 45, "fame": 1, "lootTableId": "starter-cache" },
  "rewardTags": ["装备", "金币"]
}
```

### 遭遇 `encounters[]`

| 字段 | 说明 |
| --- | --- |
| `name` / `description` | 战斗名称与日志描述 |
| `monsters` | `[{monsterId, count}]`，同名怪物自动编号 |
| `gold` | 可选，该场胜利后的额外金币区间 |
| `monsterPower` | 整数 | 该层怪物的**强度参考**（整层怪物的总战力评分），只用于展示与调平，不参与准入；沿线路建议非递减 |

- 每层**怪物等级**取该层所有怪物中的最高等级；迷宫/线路展示的等级取对应范围内最高值。
- 准入只校验等级：真实英雄平均等级（NPC 不计入）最多可低于该层怪物 5 级；战力不参与判定，`monsterPower` 仅作怪物强度参考。
- 玩家可以选择只打到第 N 层；服务端在出发时逐层校验，UI 会禁用超出等级容差的深度。
- `monsterPower` 沿线路建议非递减；`content:check` 会拒绝倒挂。

### 战斗、提前收队与休整

- 每场战斗最多 25 回合，超时判负。
- 胜利后：存活英雄恢复 15% 生命、35% 法力，清空冷却/效果/眩晕。
- 倒下的英雄不会复活，后续战斗不再参战；全员倒下则远征失败。
- **提前收队**：清完所选深度后主动结束，保留已清层物品/材料，但没有线路全通奖励。
- **战败**：只保留已清层的 EP 与金币，物品/材料丢弃。
- **全通**：只有清完整条线路才发放 `route.rewards` 的金币/EP/声望/完成掉落表。
- 远征中倒下的英雄在结算后获得 10 分钟重伤。

### 预约迷宫

`kind: "appointment"` 时必须提供 `schedule`。例如：

```json
"kind": "appointment",
"schedule": { "startHour": 18, "endHour": 22, "repeatDays": 2 }
```

- `startHour` 0–23，`endHour` 1–24；`endHour: 24` 表示到当天结束。
- 服务端在派队时校验，UI 会显示“预约开放/关闭”和每日时段。
- `repeatDays` 仅作展示与内容规划，当前未做跨日周期锁定。

### 奖励

```json
"rewards": { "gold": [35, 55], "ep": 45, "fame": 1, "lootTableId": "starter-cache" }
```

每名英雄获得完整 EP；远征中倒下过的英雄只获得 50%。金币进入账号，物品/材料进入背包。线路选择会按玩家与迷宫记忆，下次打开时自动预选。

### NPC 支援 `npcs.json`

固定 NPC 是内容包里的“半个英雄”，用于补齐低等级迷宫的阵容。它们由服务端自动战斗，**不获得 EP/战利品，也不会重伤**，但会占用队伍 6 人上限。

| 字段 | 说明 |
| --- | --- |
| `id` / `name` | 唯一 id 与战报显示名 |
| `classId` / `raceId` | 必须是已有职业/种族；属性、技能、装备都按正常英雄公式计算 |
| `level` | 固定等级 |
| `attributes` | 完整八维；建议与同等级玩家英雄相当 |
| `skillLevels` | 技能 id → 等级；只能填该职业拥有的技能 |
| `equipment` | 装备模板 id 数组；必须符合职业武器熟练度 |
| `position` | `front` / `flank` / `back`，固定站位 |

```json
{
  "id": "npc-warrior",
  "name": "佣兵战士",
  "classId": "fighter",
  "raceId": "borderlander",
  "level": 1,
  "attributes": { "str": 3, "con": 3, "int": 1, "dex": 2, "cha": 1, "agi": 2, "per": 1, "wil": 1 },
  "skillLevels": { "heavy-strike": 2, "shield-bash": 1, "battle-cry": 1 },
  "equipment": ["iron-sword", "leather-armor"],
  "position": "front"
}
```

迷宫通过 `npcAssistIds` 引用这些模板；目前只有 1 级迷宫“废弃矿坑”提供 `npc-warrior` 与 `npc-priest`。派遣时英雄 + NPC 总数不能超过 6，且至少要有 1 名玩家英雄。

### 高等级内容带（8–20 级）

| 迷宫 | 怪物等级 | 层数 | 定位 |
| --- | --- | --- | --- |
| `foundry-depths` 锈落铸炉 | 10 | 4 | 熔渣/火焰，第一套 8 级装备 |
| `whispering-archive` 低语书库 | 13 | 5 | 暗影/书库，控制与群攻 |
| `glacier-vault` 冰川穹库 | 16 | 6 | 冰霜/重甲，长线消耗 |
| `obsidian-throne` 黑曜王座 | 20 | 8 | 物理/暗影，Boss 爆发 |

高等级迷宫的怪物等级最高到上表数值，但首层通常更低，队伍平均等级最多可低于怪物 5 级。新增怪物使用独立的等级模板，不靠遭遇覆盖；高等级装备强度放在模板 `stats`/`armor`/`weaponDamage`，不新增词缀 tier。平衡验证用 `npm run simulate -- <dungeon-id> 200 <level> <gear-level> <route-id>`。

### 任务 `quests.json`

| 字段 | 说明 |
| --- | --- |
| `id` / `name` / `description` | 唯一 id 与展示文案 |
| `category` | `main` 主线 / `side` 支线 |
| `objectives[]` | `type`：`complete-dungeon` / `win-expedition` / `defeat-monsters` / `win-duel` / `earn-fame`；`targetId` 仅迷宫目标需要；`count` 目标次数 |
| `rewards` | `gold` / `ep` / `fame` / `titleId`；EP/声望/称号发放给领取时选定的英雄 |
| `prerequisiteQuestIds` | 前置任务 id；前置**领取后**才解锁 |

任务进度是账号级，存 `quest_progress.progress_json`（按 objectives 下标计数）。领取奖励是显式操作，重复领取会被拒绝。

### 称号 `titles.json`

| 字段 | 说明 |
| --- | --- |
| `id` / `name` / `description` | 展示 |
| `fameThreshold` | 声望达到该值自动解锁；任务专属称号填 `9999` |
| `color` | 可选，前端展示色 |

称号仅展示，不提供属性加成。线路完成声望写在 `dungeons[].routes[].rewards.fame`；决斗胜者固定 +1 声望；任务奖励可额外给声望或直接授予称号。

---

## 9. 平衡工作流

1. 明确该迷宫的**目标等级**与队伍人数（默认按 6 人模拟）。
2. `npm run simulate -- <dungeon-id> 100 <level>`。
3. 看三个指标：
   - **胜率**：线路最高怪物等级下建议 65%–85%；更低等级下可以更低。
   - **平均存活**：太低说明爆发/治疗不足；接近满员说明没有压力。
   - **平均回合**：3–5 回合/场比较有节奏；超过 8 回合容易拖。
4. 优先调 `damageMultiplier`（±0.1–0.3）和 `hpMultiplier`（Boss ±0.5），再调技能数值。
5. 检查极值：如果某迷宫对某些阵容 0% 或 100%，考虑抗性/群攻是否过于针对。

模拟器使用“线路最高怪物等级 + 职业初始装备 + 自动加点”，不模拟换装与玩家操作，因此实际胜率通常会更高。

### 测试远征时长

```bash
# 所有远征缩短到 2%
WOD_TIME_SCALE=0.02 npm run dev:server
# 60 秒迷宫 → 1.2 秒
```

`smoke.mjs` 就是这么跑完整链路的。生产环境保持 `1`。

---

## 10. 常见错误

| 现象 | 原因 |
| --- | --- |
| 服务端启动失败，提示 `内容包格式校验失败` | 字段类型/枚举/范围不对，看路径定位 |
| 提示 `引用了不存在的技能/物品/怪物` | 拼写错误或删除了被引用的对象 |
| 提示 `重复 id` | 同一文件里 id 重复 |
| 迷宫打不开 / 无法派队 | 队伍平均等级低于所选楼层怪物等级超过 5 级；检查该层 `monsters` 的等级，以及英雄是否重伤/正在远征 |
| 战斗日志里没有技能 | 职业 `skillIds` 没写对，或技能始终不满足冷却/法力条件 |
| 治疗从不释放 | 治疗技能不在 `skillIds` 前面，或队友从未低于 80% |
| 改了描述但界面没变 | 服务端没有重启；生产模式需要重新部署内容文件 |
| 旧装备数值没变 | 装备实例在掉落时已固化 roll；修改模板不会重算旧物品 |

---

## 11. 内容设计建议

- **队伍构成**：6 人满编时，1 坦克 + 2 输出 + 1 治疗 + 1 辅助/控制 + 1 自由位比较稳。
- **每场战斗 1–3 种怪物**：超过 5 个敌人会让日志冗长、单体技能价值骤降。
- **Boss 至少有一个群攻或控制**，否则 6 人集火会让战斗过短。
- **抗性制造取舍**：例如幽灵高斩击/穿刺抗性、负火焰抗性，促使玩家换法师/装备。
- **奖励曲线**：EP 应让玩家在若干次当前迷宫后接近下一等级阈值（`1000×(等级−1)²`）；金币应覆盖治疗与下一阶段装备的期望成本。
- **命名与描述**是这个世界的主要“美术资源”，多写几句具体感官细节，比堆数值更有氛围。
