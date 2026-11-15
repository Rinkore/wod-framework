import type {
  Affix,
  BaseStats,
  Ailment,
  DamageType,
  ItemEffect,
  Modifier,
  ModifierKind,
  PartialBaseStats,
  Race,
  Rarity,
  Resistance,
  Slot,
  Dungeon,
  WeaponType,
  Position as CombatPosition,
  GroupVisibility,
  HeroCombatSettings,
  ItemKind,
  ItemSlot,
  SkillPassive,
  SkillPhase,
  SkillTreeNode,
  TargetPriority,
} from "./schemas.js";

export const ZERO_BASE_STATS: BaseStats = {
  hp: 0,
  mana: 0,
  attack: 0,
  armor: 0,
  hit: 0,
  evasion: 0,
  initiative: 0,
  crit: 0,
};

export function addBaseStats(base: BaseStats, delta: PartialBaseStats): BaseStats {
  return {
    hp: base.hp + (delta.hp ?? 0),
    mana: base.mana + (delta.mana ?? 0),
    attack: base.attack + (delta.attack ?? 0),
    armor: base.armor + (delta.armor ?? 0),
    hit: base.hit + (delta.hit ?? 0),
    evasion: base.evasion + (delta.evasion ?? 0),
    initiative: base.initiative + (delta.initiative ?? 0),
    crit: base.crit + (delta.crit ?? 0),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${rest} 秒`;
  return `${rest} 秒`;
}

/** 单个账号最多可拥有的英雄数量。 */
export const MAX_HEROES_PER_ACCOUNT = 5;

export interface AuthUser {
  id: string;
  username: string;
  gold: number;
  premium: boolean;
  createdAt: number;
}

/** 掉落时固化的词缀 roll：修正词缀携带掷点结果，特效词缀原样携带特效。 */
export interface AffixRoll {
  affixId: string;
  name: string;
  modifiers?: Modifier[];
  effect?: ItemEffect;
}

export interface ItemRoll {
  templateId: string;
  name: string;
  description: string;
  kind: ItemKind;
  slot: ItemSlot;
  rarity: Rarity;
  level: number;
  /** 掉落时固化的修正词条快照（模板词条 + 词缀词条）。 */
  modifiers: Modifier[];
  /** 掉落时固化的特效词条快照。 */
  effects: ItemEffect[];
  armor?: number;
  weaponDamage?: number;
  damageType?: DamageType;
  weaponType?: WeaponType;
  affixes: AffixRoll[];
  value: number;
}

export interface ItemView extends ItemRoll {
  id: string;
  equippedBy: string | null;
  equippedSlot: Slot | null;
  acquiredAt: number;
  ownerUserId?: string;
  ownerName?: string;
}

export interface HeroSkillView {
  id: string;
  name: string;
  description: string;
  kind: "attack" | "heal" | "buff" | "passive" | "trait";
  category: "basic" | "secondary" | "foreign" | "class";
  damageType?: DamageType;
  range?: "melee" | "ranged" | "magic";
  cooldown: number;
  energyCost: number;
  power: number;
  levelScale: number;
  weaponScale: number;
  /** 技能基础暴击率（百分点）。 */
  baseCritRate: number;
  /** 技能基础命中率（百分比）。 */
  baseHitRate: number;
  /** 异常效率；默认 2。 */
  ailmentEfficiency: number;
  /** 处决阈值与增伤；未配置则无。 */
  executeThreshold?: number;
  executeBonusPct?: number;
  /** 对带对应异常目标的增伤。 */
  ailmentBonusPct?: number;
  target: "enemy" | "all-enemies" | "ally" | "all-allies" | "self";
  level: number;
  maxLevel: number;
  epCost: number;
  goldCost: number;
  weaponTypes?: WeaponType[];
  usable: boolean;
  /** 该技能可被用于哪些战斗阶段。 */
  phases: SkillPhase[];
  /** 是否已解锁；false 表示技能树上的锁定节点。 */
  unlocked: boolean;
  /** basic：普攻/强力；weapon：武器树。 */
  source: "basic" | "weapon";
  /** 该节点所属武器树；通用/基础为空。 */
  treeWeaponType?: WeaponType;
  tier: number | null;
  /** 同层布局行；基础技能为 0。 */
  row: number;
  /** 解锁该节点需要的技能点。 */
  cost: number;
  minLevel: number;
  requires: string[];
  requiresAny: string[];
  /** 无向跨树连接目标节点 id。 */
  links: string[];
  role?: SkillTreeNode["role"];
  canUnlock: boolean;
  lockedReason?: string;
  passive?: SkillPassive;
}

export interface HeroTitleView {
  id: string;
  name: string;
  description: string;
  color?: string;
  fameThreshold: number;
  source: "fame" | "quest";
  unlockedAt: number;
}

export interface HeroTitlesView {
  fame: number;
  activeTitleId: string | null;
  titles: HeroTitleView[];
}

export type QuestStatus = "locked" | "active" | "completed" | "claimed";

export interface QuestObjectiveView {
  type: "complete-dungeon" | "win-expedition" | "defeat-monsters" | "win-duel" | "earn-fame";
  targetId?: string;
  count: number;
  current: number;
}

export interface QuestRewardView {
  gold: number;
  ep: number;
  fame: number;
  titleId?: string;
}

export interface QuestView {
  id: string;
  name: string;
  description: string;
  category: "main" | "side";
  objectives: QuestObjectiveView[];
  rewards: QuestRewardView;
  prerequisiteQuestIds: string[];
  status: QuestStatus;
  completedAt: number | null;
  claimedAt: number | null;
}

export interface HeroView {
  id: string;
  name: string;
  raceId: string;
  raceName: string;
  /** 创建时选择的武器路径。 */
  pathWeaponType: WeaponType;
  weaponName: string;
  weaponColor?: string;
  /** 当前装备的武器类型；未装备武器时为 null。 */
  weaponType: WeaponType | null;
  weaponProficiencies: WeaponType[];
  level: number;
  ep: number;
  epEarned: number;
  epToNext: number;
  /** 面板最终数值：已计入特质、被动、装备词条与强化，不含局内 buff。 */
  finalStats: BaseStats;
  maxHp: number;
  maxEnergy: number;
  /** 先攻（已含常驻修正）。 */
  initiative: number;
  /** 护甲（已含基础、装备与常驻修正）。 */
  armor: number;
  /** 对同级标准物理攻击的减伤率（0–0.9）。 */
  physicalReduction: number;
  /** 命中评分（已含常驻修正）。 */
  hit: number;
  /** 对同级标准怪物的实际命中率。 */
  hitRate: number;
  /** 闪避评分（已含常驻修正）。 */
  evasion: number;
  /** 对同级标准怪物的实际闪避率。 */
  evasionRate: number;
  /** 暴击率（小数比例，已含常驻修正）。 */
  critChance: number;
  /** 基础攻击 + 武器伤害。 */
  attackPower: number;
  /** 每回合主要行动次数；当前固定为 1，先攻只决定顺序。 */
  actionsPerRound: number;
  /** 面板概率的参考对手：同级标准怪物。 */
  reference: { level: number; hit: number; evasion: number; hitDamage: number };
  /** 元素/混沌双通道抗性（小数比例，含过往与被动）。 */
  resistances: Resistance;
  /** 常驻修正汇总（被动 + 装备词条）。 */
  modifiers: Modifier[];
  /** 英雄战力；由等级、最终面板数值、技能、装备与特质钩子综合计算。 */
  power: number;
  trait: Race["trait"];
  skills: HeroSkillView[];
  skillPoints: { total: number; spent: number; available: number };
  equipment: Record<Slot, ItemView | null>;
  busyExpeditionId: string | null;
  /** 永久死亡时间；null 表示存活。 */
  diedAt: number | null;
  fame: number;
  activeTitle: HeroTitleView | null;
  createdAt: number;
}

/** 每个英雄最多保存的战斗预设数量。 */
export const MAX_HERO_PRESETS = 5;

// ---------------------------------------------------------------------------
// 永久死亡：死亡名册 / 墓碑 / 复活券
// ---------------------------------------------------------------------------

/** 死亡名册正式容量；超出后新死亡进入待取舍，总上限 5，超过直接删除。 */
export const DEATH_ROSTER_CAPACITY = 3;
/** 死亡名册总上限（含待取舍）。 */
export const DEATH_ROSTER_HARD_LIMIT = 5;
/** 名册待取舍时，创建英雄与派遣远征会被拒绝。 */
export const HERO_DELETE_COST = 100;

export interface DeathRosterEntry {
  heroId: string;
  name: string;
  raceId: string;
  weaponType: WeaponType;
  level: number;
  epEarned: number;
  fame: number;
  diedAt: number;
}

export interface TombstoneEntry {
  tombstoneId: string;
  name: string;
  raceId: string;
  weaponType: WeaponType;
  level: number;
  epEarned: number;
  diedAt: number;
  deletedAt: number;
}

export interface DeathTokenView {
  type: "pardon" | "redemption";
  count: number;
}

export interface DeathRosterView {
  /** 死亡名册（died 角色），最多 5 条；超过 3 条时创建/派遣前需取舍。 */
  dead: DeathRosterEntry[];
  /** 已被直接删除的英雄墓碑（仅死亡赎回券可复活）。 */
  tombstones: TombstoneEntry[];
  tokens: DeathTokenView[];
  /** 死亡角色数量是否超过正式容量（需取舍才能建号/派遣）。 */
  needsResolution: boolean;
}

/** 建号抽选：从全部过往中抽 2 个、武器路径中抽 3 个供玩家选择。 */
export interface HeroDraftView {
  draftId: string;
  raceIds: string[];
  weaponTypes: WeaponType[];
  expiresAt: number;
  rerollsRemaining: number;
}

// ---------------------------------------------------------------------------
// 彩票：库存券主动投入、每天一轮、系统随机六号、按命中档自动结算
// ---------------------------------------------------------------------------

/** 彩票号码范围：00–30。 */
export const LOTTERY_NUMBER_MIN = 0;
export const LOTTERY_NUMBER_MAX = 30;
/** 每期开奖号码个数。 */
export const LOTTERY_DRAW_COUNT = 6;
/** 彩票数字位数范围。 */
export const LOTTERY_DIGITS_MIN = 6;
export const LOTTERY_DIGITS_MAX = 6;
/** 仅供历史周彩票兑奖。 */
export const LOTTERY_CONSOLATION_GOLD = 50;
/** 每日奖池周期。 */
export const LOTTERY_PERIOD_MS = 24 * 60 * 60 * 1000;
/** 遗产碎片按命中数发放；用于后续传承兑换。 */
export function lotteryShardPrizeFor(matched: number): number {
  if (matched >= 6) return 1000;
  if (matched === 5) return 200;
  if (matched === 4) return 40;
  if (matched === 3) return 10;
  if (matched === 2) return 3;
  return 1;
}

/** 命中数对应奖励：死亡赦免券 / 死亡赎回券张数；null 表示未中奖。 */
export function lotteryPrizeFor(matched: number): { pardon: number; redemption: number } | null {
  if (matched >= 6) return { pardon: 0, redemption: 5 };
  if (matched === 5) return { pardon: 0, redemption: 1 };
  if (matched === 4) return { pardon: 3, redemption: 0 };
  if (matched === 3) return { pardon: 1, redemption: 0 };
  return null;
}

export interface LotteryTicketView {
  id: string;
  periodNumber: number | null;
  /** 库存券未投入时为空；投入后为已排序的六个号码。 */
  digits: number[];
  status: "stock" | "entered" | "drawn" | "redeemed";
  /** true 表示升级前的历史奖券。 */
  legacy: boolean;
  /** 新日池开奖自动发放的遗产碎片。 */
  prizeShards: number;
  /** 开奖后命中的号码（升序）。 */
  matchedDigits: number[] | null;
  matchedCount: number;
  /** 中奖奖励描述；未中奖为 null。 */
  prize: string | null;
  /** 中奖奖励结构；未中奖为 null。 */
  prizeTokens: { pardon: number; redemption: number } | null;
  /** 旧周彩票未中奖安慰金币，仅历史票使用。 */
  consolationGold: number;
}

export interface LotteryPeriodView {
  number: number;
  startAt: number;
  endAt: number;
  status: "active" | "drawn";
  /** 开奖号码（仅已开奖期次）。 */
  numbers: number[] | null;
}

export interface LotteryStateView {
  currentPeriod: LotteryPeriodView;
  /** 最近一期已开奖的期次（含号码）。 */
  lastDrawn: LotteryPeriodView | null;
  tickets: LotteryTicketView[];
  legacyShards: number;
  manuals: number;
  cosmetics: string[];
  stockCount: number;
  enteredCount: number;
  totalTickets: number;
  page: number;
  pageSize: number;
  weeklyTickets: number;
  /** 当前持有的旧版复活券，仅为历史兼容。 */
  deathTokens: DeathTokenView[];
}

/** @deprecated 使用 HeroCombatSettings；保留名字避免旧引用断裂。 */
export type HeroPresetSettings = HeroCombatSettings;

export interface HeroPresetView {
  id: string;
  heroId: string;
  name: string;
  position: CombatPosition;
  settings: HeroCombatSettings;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EquipResultView {
  hero: HeroView;
  /** 被替换下来、已经回到背包的装备。 */
  replacedItem: ItemView | null;
  /** 如果装备原本穿在另一名英雄身上，这里是原主人。 */
  fromHero: { id: string; name: string } | null;
}

export interface UnequipResultView {
  hero: HeroView;
  item: ItemView;
}

export type LogKind =
  | "system"
  | "damage"
  | "heal"
  | "buff"
  | "debuff"
  | "down"
  | "crit"
  | "miss";

export interface CombatLogParticipant {
  id: string;
  name: string;
  side: "hero" | "enemy";
}

export interface CombatLogEffect {
  type:
    | "mod"
    | "dot"
    | "hot"
    | "stun"
    | "shield"
    | "silence"
    | "taunt"
    | "reflect"
    | "burn"
    | "freeze"
    | "paralysis"
    | "sleep"
    | "poison"
    | "bleed"
    | "wound";
  /** mod 效果的修正种类。 */
  kind?: ModifierKind;
  /** mod 幅度（百分比类为百分点，平值类为数值）。 */
  amount?: number;
  duration?: number;
  /** dot/hot 每跳快照值。 */
  damage?: number;
  damageType?: DamageType;
  /** shield 快照吸收量。 */
  value?: number;
  /** reflect 反伤比例（小数）。 */
  percent?: number;
  /** 中毒/伤口层数。 */
  stacks?: number;
}

export interface CombatLogAilmentProgress {
  ailment: Ailment;
  /** 本次命中带来的异常积累变化。 */
  delta: number;
  /** 本次命中前的积累值。 */
  before: number;
  /** 本次命中后的积累值；触发后为 0。 */
  after: number;
  /** 达到该值时触发异常。 */
  threshold: number;
  triggered: boolean;
}

export interface CombatLogEntry {
  round: number;
  kind: LogKind;
  text: string;
  amount?: number;
  effect?: CombatLogEffect;
  /** 本次伤害带来的异常积累变化。 */
  ailment?: CombatLogAilmentProgress;

  /** 同一次技能施放产生的多条日志共享 actionId，便于合并多目标攻击。 */
  actionId?: string;
  actor?: CombatLogParticipant;
  target?: CombatLogParticipant;
  actionName?: string;
  /** 该动作发生在哪个战斗阶段。 */
  phase?: SkillPhase;

  /** 本次攻击的命中率（0–1）；治疗/增益不填。 */
  hitChance?: number;
  /** 本次攻击是否命中。 */
  hit?: boolean;
  /** 本次攻击的暴击率（0–1）。 */
  critChance?: number;
  /** 未命中原因；百分比判定统一为 hit-chance。 */
  missReason?: "hit-chance";

  damageType?: DamageType;
  crit?: boolean;

  /** 目标在本次变化前后的生命值。 */
  hpBefore?: number;
  hpAfter?: number;
  maxHp?: number;

  /** 目标护盾在本次受击前后的剩余值（含本次吸收量）。 */
  shieldBefore?: number;
  shieldAfter?: number;
  shieldAbsorbed?: number;

  /** 药水恢复法力时使用。 */
  energyBefore?: number;
  energyAfter?: number;
  maxEnergy?: number;

  /** 药水恢复的资源类型。 */
  resource?: "hp" | "energy";

  /** 回合开始的持续效果结算条目。 */
  tick?: boolean;
  /** 持续效果来源（用于把 DoT/HoT 归因到施放者）。 */
  sourceName?: string;
  sourceSide?: "hero" | "enemy";
}

/** 开战时的参战单位快照，供战报展示从未被命中的单位。 */
export interface CombatantSnapshot {
  id: string;
  name: string;
  side: "hero" | "enemy";
  level: number;
  position: CombatPosition;
  maxHp: number;
  maxEnergy: number;
  startHp: number;
  startEnergy: number;
}

export interface EncounterResult {
  name: string;
  description?: string;
  rounds: number;
  victory: boolean;
  timeout: boolean;
  log: CombatLogEntry[];
  damageDealt: number;
  damageTaken: number;
  /** 开战名单；旧存档没有该字段。 */
  combatants?: CombatantSnapshot[];
  /** 各单位每回合实际回蓝量（含钩子加成），供战报回放使用；旧存档没有该字段。 */
  energyRegen?: Record<string, number>;
}

export interface ExpeditionHeroResult {
  heroId: string;
  name: string;
  downed: boolean;
  epGained: number;
  fromLevel: number;
  toLevel: number;
  epEarnedAfter: number;
}

export interface ExpeditionNpcResult {
  id: string;
  name: string;
  weaponType: WeaponType;
  position: CombatPosition;
  downed: boolean;
}

export interface ExpeditionEngineResult {
  outcome: "victory" | "defeat" | "evacuated";
  seed: number;
  /** 本次远征选择的迷宫路径（房间 id）；旧存档可能没有这些字段。 */
  roomPath?: string[];
  /** 路径对应的房间名，便于展示。 */
  roomNames?: string[];
  /** 是否走到 boss 并打通；提前收队为 false。 */
  routeCleared?: boolean;
  encounters: EncounterResult[];
  rewards: {
    gold: number;
    ep: number;
    /** 通关声望；旧存档可能没有该字段。 */
    fame?: number;
    items: ItemRoll[];
  };
  perHero: ExpeditionHeroResult[];
  /** 参战的固定 NPC 支援；旧存档可能没有该字段。 */
  npcs?: ExpeditionNpcResult[];
  summary: {
    rounds: number;
    monstersSlain: number;
    survivors: number;
    /** 已清除的房间数；旧存档可能没有该字段。 */
    floorsCleared?: number;
  };
}

export interface GroupShare {
  userId: string;
  username: string;
  gold: number;
  itemCount: number;
}

export interface ExpeditionResultView extends Omit<ExpeditionEngineResult, "rewards"> {
  rewards: {
    gold: number;
    ep: number;
    fame?: number;
    items: ItemView[];
  };
  groupShares?: GroupShare[];
  /** 本次结算获得的库存彩票；尚未投入任何奖池。 */
  lotteryDrops?: Array<{ userId: string; ticketId: string }>;
}

export interface ExpeditionHeroSnapshot {
  id: string;
  name: string;
  level: number;
  weaponType: WeaponType;
  weaponName: string;
  weaponColor: string;
}

export interface ExpeditionNpcSnapshot {
  id: string;
  name: string;
  weaponType: WeaponType;
  weaponName: string;
  weaponColor: string;
  position: CombatPosition;
}

export interface ExpeditionView {
  id: string;
  dungeonId: string;
  dungeonName: string;
  dungeonTheme?: string;
  /** 选择的迷宫路径；旧存档可能没有这些字段。 */
  roomPath?: string[];
  roomNames?: string[];
  status: "running" | "completed";
  startAt: number;
  endAt: number;
  heroes: ExpeditionHeroSnapshot[];
  npcs?: ExpeditionNpcSnapshot[];
  result: ExpeditionResultView | null;
}

export interface PersonalMazeRegionView {
  seriesId: string;
  depth: number;
  seed: number;
  generatorVersion: number;
  sourceDungeonId: string;
  status: "frontier" | "cleared";
  exploredRoomIds: string[];
  dungeon: Dungeon;
}

export interface GroupMemberView {
  userId: string;
  username: string;
  role: "leader" | "member";
  heroCount: number;
  /** 0 未响应 / 1 已准备 / 2 已拒绝（仅对队长发起的组队通知有意义）。 */
  readyState: 0 | 1 | 2;
  /** 该成员 staged 的死亡英雄名。 */
  deadHeroes: string[];
}

export interface GroupQueueView {
  dungeonId: string;
  dungeonName: string;
  /** 队长选择的迷宫路径（房间 id 与名称）。 */
  roomPath: string[];
  roomNames: string[];
  createdAt: number;
}

export interface GroupHeroView {
  heroId: string;
  heroName: string;
  raceId: string;
  userId: string;
  playerName: string;
  weaponType: WeaponType;
  weaponName: string;
  weaponColor: string;
  level: number;
  /** 英雄战力，用于迷宫楼层门槛预览。 */
  power: number;
  position: CombatPosition;
  /** 队伍中为该英雄选定的战斗预设；null 表示使用绑定迷宫/默认预设。 */
  presetId: string | null;
  /** 组队页面临时战前配置；空对象表示使用预设。 */
  settings: HeroCombatSettings;
  /** 永久死亡时间；null 表示存活。 */
  diedAt: number | null;
}

export interface GroupView {
  id: string;
  name: string;
  joinCode: string;
  leaderUserId: string;
  status: "recruiting" | "running" | "completed";
  visibility: GroupVisibility;
  dungeonId: string | null;
  dungeonName: string | null;
  expeditionId: string | null;
  members: GroupMemberView[];
  heroes: GroupHeroView[];
  createdAt: number;
  /** 队长发起的组队通知（迷宫 + 深度），null 表示没有待响应的通知。 */
  queue: GroupQueueView | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  visibility: GroupVisibility;
  leaderName: string;
  memberCount: number;
  heroCount: number;
  createdAt: number;
}

export interface FriendView {
  userId: string;
  username: string;
  since: number;
}

export interface FriendRequestView {
  id: string;
  userId: string;
  username: string;
  createdAt: number;
}

export interface FriendsView {
  friends: FriendView[];
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
}

export interface FriendSearchResult {
  userId: string;
  username: string;
  relation: "none" | "friend" | "incoming" | "outgoing" | "self";
}

export interface MarketListingView {
  id: string;
  sellerId: string;
  sellerName: string;
  item: ItemView;
  price: number;
  createdAt: number;
  expiresAt: number;
  mine: boolean;
}

export type AuctionStatus = "active" | "sold" | "cancelled" | "expired";

export interface AuctionListingView {
  id: string;
  sellerId: string;
  sellerName: string;
  item: ItemView;
  startPrice: number;
  currentBid: number | null;
  minNextBid: number;
  buyoutPrice: number | null;
  bidCount: number;
  currentBidderId: string | null;
  currentBidderName: string | null;
  status: AuctionStatus;
  createdAt: number;
  closesAt: number;
  mine: boolean;
}

export interface AuctionBidView {
  id: string;
  bidderId: string;
  bidderName: string;
  amount: number;
  createdAt: number;
}

export interface AuctionDetailView {
  auction: AuctionListingView;
  bids: AuctionBidView[];
}

export interface ClanMemberView {
  userId: string;
  username: string;
  role: "leader" | "member";
  joinedAt: number;
}

export interface ClanView {
  id: string;
  name: string;
  tag: string;
  leaderUserId: string;
  gold: number;
  members: ClanMemberView[];
  createdAt: number;
}

export interface ClanTreasuryItemView {
  id: string;
  item: ItemView;
  addedBy: string;
  addedByName: string;
  addedAt: number;
}

export interface ArenaEntry {
  rank: number;
  heroId: string;
  heroName: string;
  playerName: string;
  weaponType: WeaponType;
  weaponName: string;
  weaponColor: string;
  rating: number;
  wins: number;
  losses: number;
}

/** A player's persistent four-hero arena roster. */
export interface ArenaTeamMemberView extends DuelSide {
  position: CombatPosition;
  power: number;
}

export interface ArenaTeamView {
  id: string;
  userId: string;
  playerName: string;
  members: ArenaTeamMemberView[];
  power: number;
  rating: number;
  wins: number;
  losses: number;
  phantomUpdatedAt: number;
  createdAt: number;
}

export interface ArenaOpponentView extends ArenaTeamView {
  challenge: ArenaChallengeView;
}

export interface ArenaChallengeView {
  allowed: boolean;
  reason: string | null;
  dailyUsed: number;
  dailyLimit: number;
  cooldownUntil: number | null;
  powerException: boolean;
  defenderMultiplier: number;
}

export interface ArenaTeamEntry {
  rank: number;
  teamId: string;
  playerName: string;
  memberNames: string[];
  power: number;
  rating: number;
  wins: number;
  losses: number;
}

export interface ArenaTeamResultView {
  teamId: string;
  playerName: string;
  members: ArenaTeamMemberView[];
}

export interface ArenaTeamBattleResultView {
  id: string;
  attacker: ArenaTeamResultView;
  defender: ArenaTeamResultView;
  outcome: "victory" | "defeat";
  rounds: number;
  log: CombatLogEntry[];
  combatants?: CombatantSnapshot[];
  energyRegen?: Record<string, number>;
  damageDealt?: number;
  damageTaken?: number;
  ratingChanges: { attacker: number; defender: number };
  theoreticalRatingChanges: { attacker: number; defender: number };
  defenderMultiplier: number;
  createdAt: number;
}

export interface ArenaSeasonView {
  id: string;
  number: number;
  name: string;
  startAt: number;
  endAt: number;
  status: "active" | "ended";
}

export interface ArenaSeasonRewardView {
  seasonId: string;
  seasonName: string;
  heroId: string;
  heroName: string;
  placement: number;
  gold: number;
  ep: number;
  fame: number;
  claimedAt: number | null;
}

export interface ArenaSeasonStateView {
  season: ArenaSeasonView;
  leaderboard: ArenaEntry[];
  myBest: ArenaEntry | null;
  rewards: ArenaSeasonRewardView[];
}

export interface ArenaTeamSeasonRewardView {
  seasonId: string;
  seasonName: string;
  teamId: string;
  placement: number;
  gold: number;
  ep: number;
  fame: number;
  memberIds: string[];
  claimedAt: number | null;
}

export interface ArenaTeamSeasonStateView {
  season: ArenaSeasonView;
  leaderboard: ArenaTeamEntry[];
  myBest: ArenaTeamEntry | null;
  rewards: ArenaTeamSeasonRewardView[];
}

export interface ClaimTeamSeasonRewardsView {
  claimed: ArenaTeamSeasonRewardView[];
  user: AuthUser;
}

export interface ClaimSeasonRewardsView {
  claimed: ArenaSeasonRewardView[];
  user: AuthUser;
}

export interface ChatMessageView {
  id: string;
  userId: string;
  username: string;
  channel: "global" | "clan" | "group";
  groupId?: string | null;
  message: string;
  createdAt: number;
}

export interface ClanSummary {
  id: string;
  name: string;
  tag: string;
  leaderName: string;
  memberCount: number;
  createdAt: number;
}

export interface DuelSide {
  heroId: string;
  heroName: string;
  playerName: string;
  weaponType: WeaponType;
  weaponName: string;
  weaponColor: string;
  level: number;
}

export interface DuelResultView {
  id: string;
  attacker: DuelSide;
  defender: DuelSide;
  outcome: "victory" | "defeat" | "evacuated";
  rounds: number;
  log: CombatLogEntry[];
  /** 新决斗记录保留开战名单；旧记录没有该字段。 */
  combatants?: CombatantSnapshot[];
  energyRegen?: Record<string, number>;
  damageDealt?: number;
  damageTaken?: number;
  ratingChanges?: { attacker: number; defender: number };
  createdAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  heroId: string;
  heroName: string;
  level: number;
  epEarned: number;
  weaponName: string;
  weaponType: WeaponType;
  weaponColor: string;
  playerName: string;
}

export function affixById(affixes: Affix[], id: string): Affix | undefined {
  return affixes.find((affix) => affix.id === id);
}

export function isDungeonOpen(dungeon: Dungeon, date = new Date()): boolean {
  if (dungeon.kind !== "appointment" || !dungeon.schedule) return true;
  const hour = date.getHours() + date.getMinutes() / 60;
  const { startHour, endHour } = dungeon.schedule;
  if (endHour === 24) return hour >= startHour;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function dungeonScheduleLabel(dungeon: Dungeon): string {
  if (dungeon.kind !== "appointment" || !dungeon.schedule) return "常驻开放";
  const { startHour, endHour, repeatDays } = dungeon.schedule;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `每日 ${pad(startHour)}:00–${pad(endHour)}:00 · ${repeatDays} 天周期`;
}
