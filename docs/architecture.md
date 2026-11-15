# 架构说明

> 当前实现（v0.9.1）：8 项基础数值由过往 + 等级 + 技能被动 + 装备派生，不再有属性点分配/重置；内容包为 11 个过往 / 8 条武器路径。原站完整对照见 [wod-parity.md](wod-parity.md)。

## 1. 总览

```
┌─────────────────────────────────────────────────────────────┐
│                        apps/web (React)                     │
│  登录 / 概览 / 英雄 / 迷宫组队 / 战报 / 背包 / 图鉴 / 排行  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP /api（同源，Cookie 会话）
┌──────────────────────────▼──────────────────────────────────┐
│                    apps/server (Express)                    │
│  鉴权与会话 │ 英雄服务 │ 远征服务 │ 背包装备 │ 排行 │ 内容API │
│        结算器（到期远征 apply-once） │ 静态站点托管            │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
        ┌──────▼──────┐                ┌──────▼──────┐
        │  node:sqlite │                │ content/*.json│
        │   data/wod.db│                │ 启动时校验并缓存│
        └──────────────┘                └──────┬──────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │ packages/engine     │
                                    │ 纯函数规则引擎       │
                                    └──────────┬──────────┘
                                               │ 类型 / schema
                                    ┌──────────▼──────────┐
                                    │ packages/shared     │
                                    │ Zod + 跨端类型 + 标签 │
                                    └─────────────────────┘
```

设计原则：

- **内容与规则分离**：`content/` 只描述数据，`engine/` 只实现通用规则。
- **引擎无 I/O**：不访问数据库、不发网络请求、不读文件；输入内容包 + 英雄快照 + 种子，输出结果。可单测、可模拟、可移植。
- **服务端是唯一事实来源**：远征在派出的瞬间由服务端模拟并保存结果，客户端只展示。
- **确定性**：同一内容 + 同一英雄状态 + 同一种子 ⇒ 完全相同的战报。

---

## 2. 包职责

### `packages/shared`

- Zod schema：内容格式、API 输入、效果/目标枚举。
- 跨端 TypeScript 类型：`HeroView`、`ItemView`、`ExpeditionView`、战斗日志、排行榜等。
- 中文标签与静态枚举：属性、伤害类型、稀有度、部位、角色。
- `validateContent()`：跨文件引用校验。

### `packages/engine`

| 文件 | 职责 |
| --- | --- |
| `rng.ts` | mulberry32 种子随机、整数/概率/权重抽取 |
| `progression.ts` | EP 等级阈值、技能训练费用 |
| `stats.ts` | 过往/被动/装备叠加、最终面板、PoE 式命中/护甲曲线、强化倍率 |
| `power.ts` | 英雄战力评分（等级/最终数值/技能/装备/特质钩子） |
| `crafting.ts` | 炼药品质 I–III、效果独立缩放与取整、混合药水 |
| `combat.ts` | 战斗回合、目标选择、伤害/治疗/效果、冷却/法力、日志 |
| `loot.ts` | 词缀、物品/材料 roll、掉落表、出售价 |
| `expedition.ts` | 线路/深度、多场遭遇、休整、怪物收益、全通奖励、每英雄 EP |

战斗中的 `Combatant` 是可变的运行时对象；英雄状态在遭遇之间保留（生命/法力/倒下），装备与属性在远征开始时快照。

武器适配：装备模板声明 `weaponType`，英雄由起始武器/技能树根/被动获得 `weaponProficiencies`，技能可声明 `weaponTypes`。装备校验使用武器熟练度；战斗 AI 会跳过当前武器不匹配的技能，最后回退普通攻击。

### `apps/server`

- Express 路由与中间件。
- `requireUser`：Cookie → 会话哈希 → 用户。
- 每个受保护请求先 `settleDueForUser()`，保证“到点即结算”。
- 10 秒定时器 `settleAllDue()`，让离线玩家也按时结算。
- `node:sqlite` 同步数据库；无 ORM、无原生依赖。

### `apps/web`

- React 19 + Vite + React Router。
- 无全局状态库；页面用 `useApi` 拉取，认证与内容包用 Context。
- 所有类型来自 `@wod/shared`；创建英雄预览直接复用 `computeHeroDerived()`，保证与服务端一致。
- 弹窗使用 `createPortal` 渲染到 `body`，避免父级 `transform` 影响 `position: fixed`。

---

## 3. 请求与结算生命周期

### 派出远征

```
POST /api/expeditions
  → 校验迷宫、队伍人数、重复英雄
  → 解析线路（显式 routeId → 记忆偏好 → boss）与目标深度
  → 逐人校验：拥有、未忙碌、未重伤
  → 读取当前装备与加点，构造 HeroRunSpec
  → 计算队伍平均等级，逐层校验怪物等级（允许高出 5 级；战力不参与准入）
  → simulateExpedition(content, { dungeonId, routeId, depth, heroes, seed })
      → 逐场 simulateEncounter（只跑所选深度）
      → 汇总金币/EP/掉落；仅全通追加线路奖励
  → BEGIN IMMEDIATE
      再次检查英雄未被其他请求锁定
      INSERT expeditions(route_id, depth, result_json = 完整结果)
      INSERT expedition_heroes
      写入 dungeon_route_preferences（线路记忆）
    COMMIT
  → 返回 running 状态的远征（不返回结果）
```

远征在派出时已经算完，但结果对客户端隐藏，直到 `endAt`。这样可以：

- 精确地按真实时间返回，不需要在后台跑战斗；
- 服务器重启、玩家离线都不影响结果；
- 避免结算时再读装备（英雄已被锁定）。

### 到期结算

触发点：

1. 任何受保护 API 调用前（按用户）；
2. 每 10 秒全局扫描一次。

```
settleExpedition(row)
  → BEGIN IMMEDIATE
  → 重新读取 status='running' 的行（幂等保护）
  → 解析 result_json
  → 为每件掉落生成 item id，写入 inventory_items（材料按模板+品质/等级堆叠 quantity）
  → 更新每名英雄 level/xp(可用 EP)/ep_earned/技能/injured_until
  → users.gold += 金币
  → 把结果中的 ItemRoll 替换为带 id 的 ItemView，写回 result_json
  → UPDATE status='completed' ... WHERE status='running'
  → 若 changes=0 → ROLLBACK
  → COMMIT
```

**幂等性**：`UPDATE ... WHERE status='running'` 加事务保证同一远征只会发放一次奖励。
**原子性**：物品、金币、EP、状态在同一事务中提交。

### 防并发

- Node 单线程 + 同步 SQLite，天然串行执行结算。
- 派队时在事务内二次检查英雄是否已被其他远征锁定。
- 唯一索引 `inventory_items(equipped_by, equipped_slot)` 防止同一英雄同部位装备两件物品。

---

## 4. 战斗管线

```
simulateExpedition
  for each encounter:
    spawn monsters (hp = (24 + con*5 + level*4) * hpMultiplier)
    simulateEncounter
      round 1..25:
        order = alive combatants by initiative + jitter
        for each actor:
          regen energy; tick cooldowns
          tick DOT/HOT; if downed → skip
          if stunned → skip
          choose skill by priority + conditions
          execute:
            attack → hit roll → crit → armor/resist → damage → effects
            heal   → amount → cap → effects
            buff   → refresh effect
        end of round: decrement buff/debuff/stun durations
        check victory/defeat
    if victory: award monsters EP/gold/loot; rest party
    else: stop
  if all encounters cleared: completion rewards
  compute per-hero EP (downed heroes 50%) and level from cumulative EP
```

关键实现细节：

- 行动顺序：先攻（含常驻修正 + 局内修正）从高到低；同先攻按站位/阵营/id 排序。
- 命中：`clamp(1.1×命中 / (命中 + (0.5×闪避)^0.9), 5%, 98%)`；闪避为平值评分，局内 buff 只叠加临时修正。
- 暴击：暴击率不封顶；每次暴击判定 +50% 伤害，超过 100% 的部分继续判定，每次成功再 +50%；暴击同时让异常积累 ×(1+暴击次数)。
- 伤害结算顺序：命中 → 暴击 → 护甲（仅物理，`护甲/(护甲+4×本次伤害)`，上限 90%）→ 抗性 → 最小 1 点。
- 资源：最大生命 = `(过往生命 + 等级成长 + 被动) × (1 + 生命%)`；最大法力同理。面板与战斗快照都使用已计入被动/装备的最终值。
- 行动：英雄 `1 + floor(先攻/20) + 额外行动钩子`，上限 4；怪物 L7 起 2 行动。
- 冷却：使用技能时设为 `cooldown + 1`，每回合开始递减；因此“冷却 1”正好跳过下一回合。
- 回合开始统一结算：先 HoT、再 DoT、再眩晕检查，随后所有效果持续时间统一 -1 并清理到期效果；回合结束只做胜负清算。新施加的控制/持续效果从下一回合开始生效。
- 目标选择：攻击优先血量比例最低的敌人（75% 概率），治疗选最低血量比例队友。
- 同一技能对同一目标的 buff/debuff 刷新而不叠加。
- 战报日志同时保存可读 `text` 与结构化字段（actor/target/action/attack/defense/missReason/damage/hpBefore/hpAfter/maxHp/energyBefore/energyAfter/maxEnergy/effect）；buff/debuff、DoT/HoT、击倒文本均带施加者与技能来源。同一 `actionId` 的伤害、治疗与 AOE 增益/减益会合并为一张行动卡，旧战报自动回退文本行。
- 遭遇之间清空冷却/效果/眩晕，恢复 15% 生命与 35% 法力；倒下的英雄不复活。

---

## 5. 数据库

SQLite（WAL 模式、外键开启、busy_timeout 5s）。文件默认 `data/wod.db`。

### `users`

| 列 | 说明 |
| --- | --- |
| `id` | UUID |
| `username` | 唯一，`COLLATE NOCASE` |
| `password_hash` | `salt:scryptHash`（Node crypto scrypt，64 字节） |
| `gold` | 账号金币 |
| `premium` | 是否进阶账号（当前不影响组队人数） |
| `registration_ip_hash` | 注册网络 IP 的 SHA-256，用于默认“一人一号”限制；不存原始 IP |
| `created_at` | epoch ms |

### `sessions`

| 列 | 说明 |
| --- | --- |
| `token_hash` | SHA-256(token)，不存明文 |
| `user_id` | 外键 |
| `created_at` / `expires_at` | 30 天 TTL |

### `heroes`

| 列 | 说明 |
| --- | --- |
| `id` / `user_id` | |
| `name` | 同账号内唯一 |
| `race_id` / `weapon_type` | 内容包 id；创建时选择，之后不变 |
| `level` / `xp` | 等级；`xp` 为当前可用 EP |
| `ep_earned` | 累计 EP，用于等级与装备等级门槛 |
| `skills_json` | 已解锁技能树节点与技能等级 |
| `injured_until` | epoch ms，null 表示健康 |
| `created_at` / `fame` / `active_title_id` | 创建时间、声望、当前称号 |

### `hero_presets`

| 列 | 说明 |
| --- | --- |
| `id` / `user_id` / `hero_id` | UUID；归属英雄 |
| `name` | 同英雄内唯一 |
| `position` | `front` / `flank` / `back` |
| `settings_json` | 扩展设置；预留 `potions`、`targetPriority` |
| `is_default` | 每个英雄仅一套默认预设（部分唯一索引） |
| `created_at` / `updated_at` | |

### `inventory_items`

| 列 | 说明 |
| --- | --- |
| `id` | UUID |
| `user_id` | |
| `template_id` | 内容包模板 id |
| `data_json` | 完整 ItemRoll（名称、词缀、数值、强化等级、材料品质），物品自包含 |
| `acquired_at` | |
| `equipped_by` / `equipped_slot` | 英雄 id + 部位；唯一索引 |
| `quantity` | 材料堆叠数量；非材料通常为 1 |

### `dungeon_route_preferences`

`(user_id, dungeon_id, route_id, updated_at)`，主键 `(user_id, dungeon_id)`；记录玩家上次在该迷宫选择的线路。出发成功后写入，`GET /api/dungeons/preferences` 读取。

### `expeditions`

| 列 | 说明 |
| --- | --- |
| `id` / `user_id` / `dungeon_id` | |
| `route_id` / `depth` | 线路与目标深度；旧存档可为空 |
| `hero_ids_json` | 参战英雄快照顺序 |
| `seed` | 随机种子 |
| `status` | `running` / `completed` |
| `start_at` / `end_at` / `settled_at` | epoch ms |
| `result_json` | 引擎结果；结算后替换为带物品 id 的视图 |

### `expedition_heroes`

`(expedition_id, hero_id)` 关联表，用于快速判断“英雄是否正在远征”。

### `expedition_reads`

`(expedition_id, user_id, read_at)`，记录每个账号对一份战报的已读状态；组队成员各自独立，不影响其他玩家。

### 市场 / 公会 / 竞技场表（Phase 4–5）

- `market_listings`：`seller_user_id, item_json, price, status(active|sold|cancelled|expired), buyer_user_id, expires_at`；上架时物品从背包移出，7 天过期自动退回。
- `clans` / `clan_members`：公会名与标签唯一；一个账号同时只能加入一个公会；`clans.gold` 存公会金币。
- `clan_items`：公会物品，物品 JSON 自包含；成员可存入，会长可取出，解散时归还会长。
- `duels`：旧版 1v1 决斗记录攻守双方账号、种子、完整战报 JSON；不产生重伤。
- `arena_teams`：每账号一行的独立 4v4 队伍；保存 4 个英雄 id、站位、当前战力、长期积分/胜负，以及防守幻影 JSON 与更新时间。
- `arena_matches`：队伍攻防双方、双方快照、理论/实际积分变化、反刷分衰减系数、胜负和完整战报；用于每日次数、方向冷却和历史查询。
- `arena_season_team_scores` / `arena_season_team_rewards`：按赛季和队伍保存赛季积分/胜负及待领取奖励。赛季分数首次参赛时从队伍长期积分初始化，长期积分不因赛季滚动清零。
- `chat_messages`：世界/公会频道消息；公会频道要求成员身份。

### 好友与组队表（Phase 3）

- `friend_requests`：`id, requester_id, addressee_id, status(pending|accepted), created_at, responded_at`；同一对账号只保留一条关系记录。

- `groups`：`id, name, join_code, leader_user_id, status(recruiting|running|completed), visibility(public|invite|friends|guild|guild-friends), dungeon_id, expedition_id, created_at`。
- `group_members`：`group_id, user_id UNIQUE, role(leader|member), joined_at`；一个账号同时只能在一个队伍。
- `group_heroes`：`group_id, hero_id UNIQUE, user_id, position(front|flank|back)`；同一英雄不能同时在多个队伍。
- `expeditions.group_id`：组队远征标记；`expeditions.user_id` 存队长，用于远征所有权；奖励按参战成员分配。

队伍总上限 6；不再限制单个账号的派遣人数，只要账号名册里有足够角色，一个人也可以填满整支队伍。组队远征结算时，所有参战英雄获得 EP；金币按参战成员平均分配，物品按成员顺序轮转归属，结果中记录 `groupShares` 与物品 `ownerName`。

### 工坊服务

`apps/server/src/services/crafting.ts`：

- `listCrafting()`：按材料类型分组库存，返回可强化/分解的装备。
- `craftPotion()`：校验材料归属、品质 I–III、效果不重复；调用纯函数 `brewPotion()`，事务内扣材料并插入成品药水。
- `upgradeItem()`：校验装备/强化上限/装备者忙闲；按 `2^enhancement` 扣除同级锻造材料，更新 `data_json.enhancement`。
- `dismantleItem()`：仅允许未装备装备；按稀有度 1/2/4/8 返还同级材料，删除装备行。
- 材料不可装备、上架市场/拍卖或存入公会；`sellItem()` 按整堆数量计价。

---

## 6. API

所有错误格式：`{ "error": { "message": "中文提示", "code": "..." } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + 内容包版本 |
| GET | `/api/content` | 完整内容包（公开） |
| POST | `/api/auth/register` | 注册并登录（默认同一网络只能注册一个账号） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 注销当前会话 |
| GET | `/api/auth/me` | 当前用户（顺带结算） |
| GET | `/api/heroes` | 英雄列表 |
| POST | `/api/heroes` | 创建英雄（单账号最多 10 名） |
| GET | `/api/heroes/:id` | 英雄详情 |
| POST | `/api/heroes/:id/train` | 训练技能等级 `{target:"skill", key}` |
| POST | `/api/heroes/:id/train/batch` | 批量训练/解锁技能树节点（按实际技能点与 EP 校验） |
| POST | `/api/heroes/:id/heal` | 花金币治疗重伤 |
| POST | `/api/heroes/:id/equip` | 装备/替换/跨英雄转移 `{itemId}`；校验武器熟练度与物品等级，返回 `replacedItem/fromHero` |
| POST | `/api/heroes/:id/unequip` | 卸下 `{slot}`；返回 `{hero, item}` |
| GET | `/api/heroes/presets` | 当前账号所有英雄的战斗预设 |
| GET/POST | `/api/heroes/:id/presets` | 列出/新建战斗预设 |
| PATCH/DELETE | `/api/heroes/:id/presets/:presetId` | 编辑/删除战斗预设 |
| POST | `/api/heroes/:id/presets/:presetId/default` | 设为默认预设 |
| GET | `/api/inventory` | 全部物品（含装备状态、材料数量与强化等级） |
| POST | `/api/inventory/:id/sell` | 出售未装备物品；材料按整堆出售 |
| GET | `/api/crafting` | 工坊概览：炼药材料、锻造材料、装备 |
| POST | `/api/crafting/alchemy` | 炼药 `{ingredientIds}`（1–2 个不同效果类别） |
| POST | `/api/crafting/forge/upgrade` | 强化装备 `{itemId}`；消耗 `2^当前强化等级` 个同级材料 |
| POST | `/api/crafting/forge/dismantle` | 分解未装备装备 `{itemId}`；返还 1/2/4/8 个同级材料 |
| GET | `/api/dungeons/preferences` | 当前账号各迷宫的记忆线路 |
| GET | `/api/expeditions/active` | 进行中的远征 |
| GET | `/api/expeditions?limit=20` | 历史记录 |
| GET | `/api/expeditions/unread` | 当前账号的未读已完成战报 |
| POST | `/api/expeditions` | 派队 `{dungeonId, routeId?, depth?, heroIds, ...}` |
| GET | `/api/expeditions/:id` | 单条远征（含到期结算） |
| POST | `/api/expeditions/:id/read` | 标记战报为已读 |
| GET | `/api/leaderboard` | 前 50 名英雄 |
| GET | `/api/groups/mine` | 当前队伍 |
| GET | `/api/groups/open` | 当前账号可加入的招募队伍（公开/好友/同公会） |
| POST | `/api/groups` | 创建队伍 `{name, visibility}` |
| POST | `/api/groups/join` | 邀请码加入 `{code}` |
| POST | `/api/groups/:id/join` | 按队伍可见性直接加入（仅邀请需用邀请码） |
| POST | `/api/groups/:id/leave` | 离开队伍 |
| POST | `/api/groups/:id/heroes` | 加入英雄 `{heroId, position}` |
| DELETE | `/api/groups/:id/heroes/:heroId` | 移除英雄 |
| POST | `/api/groups/:id/position` | 调整站位 `{heroId, position}` |
| POST | `/api/groups/:id/start` | 队长开始组队远征 `{dungeonId, routeId?, depth?}` |
| POST | `/api/groups/:id/disband` | 解散队伍 |
| GET | `/api/groups/:id/expedition` | 队伍远征 |
| GET | `/api/market?mine=1` | 市场 / 我的挂单 |
| POST | `/api/market/list` | 上架 `{itemId, price}` |
| POST | `/api/market/:id/buy` | 购买挂单 |
| POST | `/api/market/:id/cancel` | 下架挂单 |
| GET | `/api/friends` | 好友、收到/发出的申请 |
| GET | `/api/friends/search?q=` | 按用户名搜索账号 |
| POST | `/api/friends/request` | 发送好友申请 `{username}` |
| POST | `/api/friends/:id/accept` | 接受好友申请 |
| POST | `/api/friends/:id/decline` | 拒绝好友申请 |
| POST | `/api/friends/:id/cancel` | 撤回自己发出的申请 |
| DELETE | `/api/friends/:userId` | 删除好友 |
| GET | `/api/clans/mine` | 我的公会 |
| GET | `/api/clans` | 公会列表 |
| POST | `/api/clans` | 创建公会 `{name, tag}` |
| POST | `/api/clans/join` | 按标签加入 `{tag}` |
| POST | `/api/clans/leave` | 离开公会 |
| POST | `/api/clans/:id/disband` | 解散公会 |
| GET | `/api/colosseum/team` | 当前账号的 4v4 独立队伍 |
| PUT/POST | `/api/colosseum/team` | 保存 4 名不同英雄与站位 |
| GET | `/api/colosseum/team/opponents` | 可挑战的 4v4 队伍幻影与限制 |
| POST | `/api/colosseum/team/challenge` | 挑战 `{opponentTeamId}`，立即结算 |
| GET | `/api/colosseum/team/leaderboard` | 4v4 队伍总榜 |
| GET | `/api/colosseum/team/history` | 4v4 队伍历史战报 |
| GET | `/api/colosseum/team/season` | 4v4 队伍赛季状态与待领奖励 |
| POST | `/api/colosseum/team/season/claim` | 领取队伍赛季奖励 |
| GET | `/api/colosseum/opponents` | 旧版 1v1 可挑战英雄（兼容） |
| POST | `/api/colosseum/duel` | 旧版 1v1 `{heroId, opponentHeroId}`（兼容） |
| GET | `/api/colosseum/leaderboard` | 有队伍时返回 4v4 榜，否则返回旧版榜 |
| GET | `/api/colosseum/history` | 有队伍时返回 4v4 历史，否则返回旧版历史 |
| GET | `/api/clans/:id/treasury` | 公会金库 |
| POST | `/api/clans/:id/gold/deposit` | 存入公会金币 `{amount}` |
| POST | `/api/clans/:id/gold/withdraw` | 会长取出金币 |
| POST | `/api/clans/:id/items/deposit` | 存入物品 `{itemId}` |
| POST | `/api/clans/:id/items/:itemId/withdraw` | 会长取出物品 |
| GET | `/api/chat?channel=global|clan` | 聊天记录 |
| POST | `/api/chat` | 发言 `{channel, message}` |

输入均用 `packages/shared/src/api.ts` 中的 Zod schema 校验；错误统一由 Express 错误中间件转换。

---

## 6.1 组队结算与访问

- `settleDueForUser()` 会结算“自己是队长”或“自己所属队伍”的到期远征，因此任意队员上线都能触发。
- 组队远征的 `getExpedition()` 允许队长、当前队伍成员、或参战英雄的拥有者查看。
- 结算后 `groups.status` 变为 `completed`；成员可以查看战报后离开，离开后账号才能加入新队伍。
- 金币按参战成员平均分配（余数给队长），物品按参战账号轮转；EP 按英雄归属写入。

## 6.2 Phase 4 经济与 PvP

- 市场挂单是“移出背包 → 托管 → 买家入库 / 卖家取回”的原子事务；金币在买卖双方之间转移。
- 公会当前只提供身份、名册、加入/离开/解散；公会仓库与公会战待后续。
- 旧版竞技场是 1v1 异步快照，保留用于兼容旧客户端；保存 4v4 队伍后，竞技场入口切换到队伍榜、历史和赛季。
- 组队奖励分配：金币平均分配（余数给队长），物品按参战账号轮转；战报物品带 `ownerName`。

## 6.3 Phase 5 长期互动

### 竞技场队伍生命周期

- 一个账号最多一支竞技场队伍，固定 4 名不同英雄。保存时验证英雄归属、可用状态和站位，并计算当前队伍战力。
- `saveArenaTeam()` 首次保存时将当前阵容写入 `phantom_json`；后续编辑只更新当前阵容/战力，幻影保持不变。防守方始终由幻影快照构造，不要求对手在线。
- `fightArena()` 读取攻击方当前可用 4 人与防守方幻影，调用 `simulateEncounter` 立即生成战报；只有攻击胜利才刷新攻击方幻影。结果、双方快照和积分变更在一个 SQLite 事务中写入。

### 积分与反刷分

- 队伍长期 Elo 初始 1000，K=24；积分最低 0，实际变化为零和转移。`arena_matches` 同时保存理论变化和实际变化。
- 主动挑战每日最多 5 次；同一攻击方 → 防守方方向 48 小时冷却；默认只能挑战更高积分队伍，双方战力差小于 1% 时例外放行。
- 同一服务器本地日内，一支防守队伍被击败后，针对它的后续胜利收益会递减：第一次击败该防守队伍为理论值 100%，第二次为 25%，再后续为 0。挑战接口返回这些服务端判定字段，客户端不自行推导准入。
- 防守方的实际扣分与进攻方实际收益相等且相反，因此衰减不会制造或销毁积分，也不会让积分跌破 0。

### 赛季持久化

- `arena_seasons` 默认每 14 天懒滚动；请求竞技场赛季状态或结算队伍比赛时调用 `ensureSeason()`，过期赛季在同一事务中生成奖励并标记 ended，再创建下一个 active 赛季。
- `arena_season_team_scores` 以 `(season_id, team_id)` 为主键，首次参赛从 `arena_teams.rating` 初始化。赛季结束只结算赛季表；`arena_teams.rating/wins/losses` 和 `phantom_json` 跨赛季保留。
- 赛季奖励按赛季排名（积分 → 胜场 → 更新时间），仅 `wins + losses > 0` 的队伍进入奖励；奖励记录参赛时的成员 id。领取事务标记 `claimed_at`，金币给账号，EP 与声望按结算快照在仍归该账号的成员间平均分配（余数按快照顺序），并防止重复发放。

- 公会金库：金币与物品独立于个人背包；成员可存入，会长可取用，解散时自动归还。
- 聊天：世界频道全员可读，公会频道需公会身份；每账号 2 秒发言间隔。

## 7. 安全

已实现：

- 密码 scrypt（随机 salt，`timingSafeEqual` 比较）。
- 会话 token 32 字节随机，数据库只存 SHA-256；HttpOnly、SameSite=Lax；HTTPS 下可加 Secure。
- 登录/注册内存限流（每 IP 每分钟 30 次）。
- 一人一号：默认按注册网络 IP 的 SHA-256 限制同一网络只能注册一个账号；反向代理部署需 `WOD_TRUST_PROXY=1` 才能读到真实客户端 IP。
- 所有 SQL 参数化；所有对象访问校验 `user_id`。
- 英雄忙碌/重伤/等级校验；装备武器熟练度与物品等级限制；事务防重复奖励。
- 响应不包含 `password_hash`。

上线前建议补：

- 反向代理层限流、HTTPS、HSTS。
- 邮箱验证 / 找回密码。
- CSRF 双提交 token（当前依赖 SameSite + JSON API）。
- 管理员审计日志、封禁、内容热更新权限。
- 数据库备份与监控。

---

## 8. 扩展方向

### 市场 / 拍卖行

新增 `market_listings` 表（seller、item_id、price、expires_at）。上架时把物品从 `inventory_items` 移入托管状态（`listed_by`）；购买事务内转移 `user_id` 与金币。物品已经是自包含的 `ItemRoll`，无需迁移。

### 公会

`guilds`、`guild_members` 表；权限角色；公会共享仓库可复用 `inventory_items`（增加 `guild_id`）或单独建表。聊天可用 SSE/WebSocket。

### PvP / 竞技场

引擎的 `simulateEncounter` 已支持任意两个 `Combatant[]` 阵容。当前队伍竞技场使用固定 4v4 阵容：`arena_teams` 保存账号当前队伍与长期积分，`phantom_json` 保存防守快照，`arena_matches` 保存双方快照、理论/实际积分变化和完整战报；服务端在一次事务内结算比赛、更新长期积分并写入赛季分数。每日次数、方向冷却、向上挑战门槛、近似同战力例外和防守胜利收益衰减共同提供反刷分保护。赛季滚动只结束赛季表并生成可领取奖励，不清除队伍积分或幻影。

### 单中文服务器约束

本项目固定为**单中文服务器**：只有一套内容包、一个共享账号库，没有世界选择或分服入口。所有页面均为中文；新增内容继续使用中文文案。若未来确实需要多世界，需要另行引入 `world_id` 与多内容包加载，不属于当前范围。

### 内容后台

`content/` 的 Zod schema 可直接生成表单。编辑器 API 写入 JSON → `loadContent()` 重新校验 → 原子替换内存引用 → 可选广播。当前客户端已把所有内容通过 `/api/content` 获取，天然支持热更新。

### 数据库迁移

当前使用 `CREATE TABLE IF NOT EXISTS`。正式迭代建议引入版本表与顺序 migration；或迁移到 Postgres（`node:sqlite` 调用集中在 `db.ts` 与服务层，可通过 repository 抽象替换）。

### 实时通知

用 SSE 推送“远征完成”“市场成交”。结算器在 `settleExpedition()` 提交后可发出事件；客户端轮询逻辑可平滑替换。

---

## 9. 测试策略

- `packages/engine/test/engine.test.ts`：
  - 内容包跨引用校验；
  - EP 等级阈值与训练费用；
  - 属性叠加；
  - 稀有词缀数量；
  - 相同种子结果一致；
  - 六人队通关首个迷宫；
  - 单人挑战高难迷宫失败且不发通关奖励。
- `packages/engine/test/crafting.test.ts`：
  - 品质 I/II/III 的缩放与 5 点/5% 取整；
  - 混合药水各效果独立结算；
  - 强化倍率与 `2^强化等级` 费用；
  - 战力随等级/强化提升；
  - 材料掉落的数量/品质覆盖；
  - 提前收队与全通奖励差异。
- `scripts/smoke.mjs`：
  - 启动临时服务端（临时 DB + 时间缩放）；
  - 注册 → 同网络第二账号被拒绝 → 建满 10 英雄（第 11 名被拒绝）→ 派 6 人队 → 等待结算 → 校验 EP/金币/物品/忙碌状态；
  - 未读战报列表 → 标记已读 → 未读消失；
  - 排行、出售、登出后 401。
- `scripts/crafting-smoke.mjs`：炼药混合结算、材料堆叠、强化/分解、提前收队、线路偏好记忆。
- `scripts/equipment-smoke.mjs`：装备等级门槛、跨英雄直接转移、替换与卸下返回物品。
- `scripts/presets-smoke.mjs`：战斗预设新建、编辑、默认切换、数量上限与删除。
- `scripts/arena-team-smoke.mjs`：隔离临时服务端中创建两账号各 4 名英雄，验证固定 4v4 队伍、幻影快照、对手列表与战报、向上挑战/每日次数/方向冷却及防守收益衰减字段，并通过数据库推进赛季确认长期积分、赛季持久化、奖励领取和防重复。
- `scripts/simulate.ts`：按线路与深度跨 100 个种子做内容平衡回归，并输出队伍平均战力。

新增规则时优先在引擎层加纯函数测试，再在服务端接入。
