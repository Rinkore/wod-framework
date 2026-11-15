# 原站框架研究记录（World of Dungeons）

> 研究时间：2026-11-11  
> 研究世界：Darkveil（英文服）  
> 方式：使用授权账号登录，读取游戏导航、英雄/属性/技能/训练/装备、地牢列表、派遣流程和战报。  
> 原则：只记录机制、结构、字段和数值；实现中不复制原站文案、图片、HTML/CSS 素材。

---

## 1. 账号与入口

- 首页按语言分为 German / English / Chinese 三个入口；世界选择包括 **Caledonii、Darkveil、Xenarthra、Zion** 四个世界。
- 账号在单一世界内登录，角色（hero）绑定世界。
- 账号可拥有多名英雄；非 Premium 账号最多同时派出 **2** 名英雄，Premium 为 **3** 名。组队副本由多名玩家共同凑齐队伍。
- 原站明确**一名玩家只能有一个账号**（Account → IP Sharing；Terms and Conditions §3.1、§7.6），多账号属于禁止行为。`IP Sharing` 是多用户共用同一出口网络的申请入口，不是单人开小号的许可。
- 本项目对应规则：默认同一网络只能注册一个账号；单账号最多 **10 名英雄**；多人共用网络时以 `WOD_ALLOW_SHARED_IP=1` 启动。

## 2. 一级导航（登录后）

```
News
Hero: My Heroes | Attributes | Skills | Equipment | Storage | Cellar |
      Group Storage | Treasure Vault | Group funds | Adventure | Settings |
      My hero | All heroes | Title
Group: My Group | Group search | Dungeon | Quests | Reports | Hall of Fame |
       Group-Forum | Chat | All Groups | My Clan | Clan-Forum | All Clans
Tavern
Colosseum
Bazaar
Account
Invite
Library: Forums | Encyclopedia | FAQ | Classes and Races | Title List |
         Training Costs | Master Ranks | Smileys | Finances | List of dungeons
```

对应到系统：

- **英雄**：属性、技能、装备、仓库、地窖、团队仓库、宝库、团队资金、冒险事件、战斗设置。
- **组队**：我的队伍、队伍搜索、地牢、任务、战报、名人堂、队伍论坛、聊天、所有队伍、氏族/公会。
- **社交/经济/PvP**：酒馆、竞技场、市场。
- **资料库**：职业与种族、训练费用、大师等级、地牢总表。

## 3. 属性系统（8 项）

| 属性 | 作用（由技能/面板可见） |
| --- | --- |
| Strength 力量 | 近战伤害、负重 |
| Constitution 体质 | 生命上限 |
| Intelligence 智力 | 法力上限、法术 |
| Dexterity 灵巧 | 攻击/防御检定、远程 |
| Charisma 魅力 | 社交/吟游类技能 |
| Agility 敏捷 | 先攻、闪避、部分武器 |
| Perception 感知 | 先攻、侦查、远程 |
| Willpower 意志 | 法力、抗性/精神类技能 |

- 新英雄八项属性**基础值均为 1**，种族与职业提供修正。
- 面板显示“裸值 [修正后值]”。例：Fighter + Borderlander 的 Strength 为 1 [4]，Willpower 为 2 [1]（最低为 1）。
- 生命/法力上限、先攻、每回合行动次数、护甲都从属性与职业/种族百分比推导。
- 护甲按**伤害类型 × 攻击类型**分列：crushing / cutting / piercing，每种又区分 all 与 melee，数值格式为“普通/良好/暴击”。
- 英雄永远不会死亡：战斗失败会被守卫带回，保留获得的 EP 与金币，但未通关则失去本层物品。

## 4. 职业与种族（当前版本）

- **26 个职业**：Adventurer、Alchemist、Apprentice、Archer、Barbarian、Bard、Cloudraider、Draclin、Drifter、Engineer、Fighter、Gladiator、Hunter、Juggler、Knight、Lightbringer、Mage、Musician、Paladin、Priest、Scholar、Shaman、Star Kinder、Warlock、Warlord、Zealot。
- **11 个种族**：Borderlander、Dinturan、Gnome、Halfling、Kargashian、Kerasi、Mag Mor、Partan、Targeshian、Tirem Ag、Woodlander。
- 每个职业提供：属性修正、生命/法力百分比、技能等级修正（如 Reaction +1/-2）、可用种族（当前页面全部为 Yes）、21 级后的 3–5 个子职业。
- 每个种族提供：属性修正、生命/法力百分比、可用职业（当前全部为 Yes）。
- 部分职业标记为 Premium（如 Alchemist、Bard、Draclin、Engineer、Knight、Priest 等）。
- 职业页示例（Fighter）：CON +1、STR +2、PER +1；HP +17%、Mana -22%；Reaction +1；子职业 Heroic Defender / Warmaster / Veteran Guard。

> 本项目 v2 已录入 26 职业与 11 种族的属性/生命/法力/反应修正；职业/种族描述为原创改写，不是原文。

## 5. 技能与训练经济（EP + 金币）

- 英雄不直接“升级获得属性点”；成长货币是 **EP（Experience Points）** 与 **金币**。
- 等级由**累计获得的 EP** 决定。原站等级表：

| 等级 | 升到该级所需累计 EP |
| --- | --- |
| 2 | 1,000 |
| 3 | 4,000 |
| 4 | 9,000 |
| 5 | 16,000 |
| 10 | 81,000 |
| 20 | 361,000 |
| 40 | 1,521,000 |

可归纳为 `1000 × (等级 − 1)²`，与本项目实现一致。

- 训练费用按英雄等级与技能类别变化。以等级 2 行（即刚达到 2 级附近）为例：
  - 属性：100 EP
  - 基础技能（basic）：40 EP
  - 次要技能（secondary）：80 EP
  - 外来技能（foreign）：100 EP
  - 职业（子职业）技能：1,800 EP
- 技能金币费用 = EP 费用 × **90%**（子职业天赋为 135%）。
- 技能必须至少 1 级才能使用；技能有等级、大师等级（master rank）与重置点（reset points）。
- 新英雄初始拥有 500 EP、100 金币与若干 1 级职业起始技能。
- 技能分页显示：技能名、当前等级、训练费用（金币 + EP）、提升/回退按钮。
- 例：Fighter 起始技能为 Drink Healing Potion、Use shield、Swordsmanship、Drink Mana Potion、blazon carrier；Swordsmanship 从 1 提到 2 需 40 EP + 36 金币。

### 技能数据模型（从技能弹窗抽取）

每个技能页面包含：

- `type`：attack / defense / buff / utility 等
- `may be used`：每回合可用次数
- `target`：one enemy / group 等
- `Mana points cost`
- `item`：需要的武器/盾/法器类型
- `attack type`：melee / ranged / spell
- `attack` 检定属性（如 dx, ag）
- `defense` 检定属性
- `damage` 检定属性
- `skill class`（如 Close Combat）
- 技能等级带来的防御/攻击修正
- 战斗公式提示

例：Swordsmanship

```
attack roll  = 2 × DX + AG + 2 × Swordsmanship
defense roll = 2 × DX + AG + 2 × Swordsmanship
damage roll  = ST / 2 + DX / 3 + Swordsmanship / 2
```

> v2 当前只实现了“技能等级影响主动技能强度”，尚未实现原站的攻击/防御双骰与武器技能体系；这是下一阶段重点。

## 6. 装备

- 装备槽远多于常见的“武器/护甲/饰品”：
  `head, ears, face, neck, torso, belt, cloak, shoulders, arms, gloves, both hands, right hand, left hand, legs, feet, medal #1–#3, pocket #1–#16, ring #1–#4`。
- 每件装备有属性/技能/等级要求；不满足要求时无法装备，或在重置后自动卸下。
- 初始装备示例（Fighter）：fighter's armor、fighter's sword、light fighter shield、simple cloth leggings；口袋中有 Guild Registration 与 3 次装填的 weak healing potion。
- 有“携带限制”（如 1 / 15），与力量/负重相关。
- 装备是永久/半永久的，通过掉落、市场、任务获得。
- 物品有品质、词缀、附魔/镶嵌（grafting / ornation）等扩展。

> v2 仍使用 3 个槽位（武器/护甲/饰品）；扩展为多槽位是下一阶段工作。

## 7. 地牢与组队

- 地牢分两类：
  - **Standard dungeons**：始终可用（如 The Keilerei Pub、The Academy、Robbery in the forest）。
  - **Appointment dungeons**：限定时间段开放，并标注“repeat after N days”。
- 地牢列表字段：名称、等级下限/上限、推荐等级、可用等级、开放时间。
- 地牢内部是**多层级**结构（1–10 层，每层可有多场战斗/房间）；每层有开场文本、敌人、战斗回合与掉落。
- 组队：
  - 队伍由队长和代表选择地牢；队伍成员来自不同玩家。
  - 非 Premium 玩家每次最多派出 2 名英雄，Premium 3 名；组队面板负责把英雄分配到队伍。
  - 队伍有聊天、论坛、队伍仓库、团队资金、名人堂。
  - 以上 2/3 名限制是原站规则；本项目已改为**单账号可填满 6 人队伍**，不再区分普通/进阶。
- 战斗设置（combat settings）可在派遣前选择“Default”等配置。
- 派遣后按预定时间/立即结算；战报包含：日期、地牢、统计、掉落、详情。
- 战报详情：开场剧情 → 队伍/敌人概览（位置、HP、法力、状态）→ 每回合行动 → 结果 → EP/声望/掉落。
- **站位**：front / flank / back（前排 / 游走 / 后排，战报中可见）；游走近战可越过存活前排，突袭后会暴露。
- 行动显示 `Initiative 9 / Action 1 of 1`，攻击写明“技能/技能等级/武器”，结果有“critical success / struck down / X cutting damage”。
- 初始 The Academy 战报：英雄 17 HP、4 Mana；Drunken Goblin 8 HP、5 Mana；一剑暴击击杀；获得 50 EP + 0.1 Fame 与两件物品。
- 物品只有在**所有层都成功通关**后才保留；失败只保留 EP 与金币。
- 英雄永不死亡。

## 8. 经济、PvP、社交（已确认存在，未深入）

- **Bazaar**：市场、买卖、拍卖、交易聊天、商人等级、慈善/乞讨、宝石市场。
- **Colosseum**：竞技场、决斗、锦标赛、联赛、排名、决斗聊天。
- **Clan**：氏族/公会、氏族论坛、成员、氏族仓库、团队资金。
- **Tavern**：组队招募与 NPC/任务入口。
- **Quests**：任务系统。
- **Library**：训练费用、大师等级、地牢总表、财务。
- **Fame/Title**：声望与称号，影响招募/社交。

## 9. 当前实现差距（v2 Phase 1）

| 模块 | 原站 | 当前 v2 | 状态 |
| --- | --- | --- | --- |
| 账号/多世界 | 4 世界 | 单世界，多账号 | 部分 |
| 属性 | 8 项 | 8 项 | ✅ |
| 种族/职业 | 11 / 26 | 11 / 26 | ✅ |
| 属性训练 | EP | EP + 训练接口 | ✅ |
| 技能等级 | 完整技能树/大师等级 | 每职业 3 个主动技能，1–20 级 | 部分 |
| 技能战斗公式 | 攻防双骰/武器技能 | 主动技能 + 冷却/精力 | 待重做 |
| 装备槽 | 20+ | 3 | 待扩展 |
| 地牢 | 标准/预约、多层 | 3 条线路、按怪物等级准入（可高 5 级）、怪物战力参考、可选深度、提前收队、失败不保留物品、预约字段/UI | 部分（10 层/重复周期待补） |
| 组队 | 多玩家队伍、2/3 派遣上限 | 队伍大厅、2/3 上限、队长出发 | 部分（金币/物品分配待做） |
| 战报 | 多层、位置、逐动作 | 逐层/逐回合日志、站位/伤害类型 | 部分 |
| 市场/公会/PvP | 完整 | 挂单市场、拍卖行、公会名册、1v1 竞技场 | 部分（公会仓库/赛季待做） |
| 声望/称号 | 完整 | 声望、任务、称号解锁/展示 | 部分（称号无数值加成） |
| 公会金库/聊天 | 完整 | 金币/物品金库、世界/公会聊天 | 部分（公会战/私聊待做） |
| 竞技场排名 | 完整 | Elo 积分榜、赛季积分与赛季奖励 | 部分（锦标赛待做） |

## 9.1 Phase 2 已实现

- 攻防双骰（d20 + 属性 + 技能等级）、暴击、闪避。
- 伤害类型扩展为打击/斩击/穿刺/火焰/冰霜/闪电/强酸/神圣/暗影/自然；护甲只减免三种物理类型，元素走抗性。
- 每回合行动次数（敏捷推导，最多 3 次）。
- 前排/游走/后排；普通近战只能攻击敌方前排，游走近战可越过前排攻击非前排，之后暴露到下次行动。
- 地牢遭遇改为“层级”；战报显示“第 N 层”。
- 失败不保留物品，只保留 EP 与金币。
- 派遣 UI 支持逐英雄选择站位。

仍需补齐：完整武器技能树/技能等级需求、10 层地牢、预约地牢、20+ 装备槽、多玩家组队。

## 9.2 Phase 3 已实现

- 多玩家队伍大厅：创建队伍、邀请码加入、公开队伍直接加入、离开/解散、队长转移。
- 队伍上限 6；本项目不再限制单个账号的派遣人数，单账号可以填满整支队伍。
- 队伍英雄可逐人设置前/中/后排；队长选择地牢后统一出发。
- 组队远征共用同一战斗引擎；任意队员可查看战报；所有参战英雄获得 EP。
- 预约地牢字段 `kind/schedule`、开放时间校验和 UI 提示。
- 组队冒烟测试：单账号 6 名英雄填满队伍、第 7 名被队伍容量拒绝、组队结算、队员离队。

组队金币平均分配、物品按参战成员轮转；已加入组队临时战前配置与队伍频道；队伍金库/人工分配、10 层地牢是后续工作。

## 9.3 Phase 4 已实现

- **市场**：上架未装备物品、设置价格、7 天挂单、购买/下架、金币与物品原子转移。
- **公会**：创建（名称+标签）、按标签加入、成员名册、离开/解散、会长转移。
- **竞技场**：1v1 异步决斗，使用统一战斗引擎；双方获得 EP，胜者更多；战报与历史记录。
- **组队分配**：金币按参战成员平均分配，物品按成员轮转归属；结果展示 `groupShares` 与物品归属。
- 冒烟测试覆盖市场买卖、公会加入/离开、决斗与 EP、组队分配。

仍需补齐：拍卖行、公会战、赛季奖励、声望称号、私聊/聊天管理、组队物品人工分配。

## 9.4 Phase 5 已实现

- 竞技场 Elo：初始 1000，胜者加分/败者减分，记录胜负；新增竞技场积分榜。
- 公会金库：成员存入金币/物品，会长取出；解散时自动归还会长。
- 世界/公会聊天：轮询加载，每账号 2 秒限流；公会频道要求公会身份。
- 冒烟测试覆盖评分变化、金库存取与权限、世界/公会消息。

仍需补齐：拍卖行、公会战、赛季奖励、私聊/聊天管理、组队物品人工分配。

## 10. 下一阶段建议

1. **Phase 2 — 战斗与地牢**：攻击/防御双骰、武器技能、伤害类型（crushing/cutting/piercing + 元素）、护甲分型、前后排、多层地牢、失败保留规则。
2. **Phase 3 — 组队与派遣**：多玩家队伍、队长/代表、队伍搜索、每人 2/3 英雄上限、预约地牢、战报共享。
3. **Phase 4 — 经济与社交**：Bazaar、Clan、Colosseum、Tavern、Quests、Fame/Title。
4. **Phase 5 — 装备深化**：多槽位、需求校验、附魔/镶嵌、携带限制。

---

## 版权说明

本记录只保留机制、字段和数值等事实性信息；实现中的职业/种族描述、UI 文案与视觉均为原创。原站的 HTML/CSS、图片、百科长文本未复制进项目。
