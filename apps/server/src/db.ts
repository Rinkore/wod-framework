import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./config.js";

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    gold INTEGER NOT NULL DEFAULT 0,
    premium INTEGER NOT NULL DEFAULT 0,
    registration_ip_hash TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS heroes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    race_id TEXT NOT NULL,
    weapon_type TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 500,
    ep_earned INTEGER NOT NULL DEFAULT 500,
    skills_json TEXT NOT NULL DEFAULT '{}',
    duel_wins INTEGER NOT NULL DEFAULT 0,
    duel_losses INTEGER NOT NULL DEFAULT 0,
    duel_rating INTEGER NOT NULL DEFAULT 1000,
    injured_until INTEGER,
    fame INTEGER NOT NULL DEFAULT 0,
    active_title_id TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_heroes_user ON heroes(user_id);

  CREATE TABLE IF NOT EXISTS hero_titles (
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    title_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'fame',
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (hero_id, title_id)
  );
  CREATE INDEX IF NOT EXISTS idx_hero_titles_hero ON hero_titles(hero_id);

  CREATE TABLE IF NOT EXISTS quest_progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    progress_json TEXT NOT NULL DEFAULT '{}',
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    claimed_at INTEGER,
    PRIMARY KEY (user_id, quest_id)
  );
  CREATE INDEX IF NOT EXISTS idx_quest_progress_user
    ON quest_progress(user_id, status);

  CREATE TABLE IF NOT EXISTS hero_presets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position TEXT NOT NULL DEFAULT 'front',
    settings_json TEXT NOT NULL DEFAULT '{}',
    bound_dungeon_id TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(hero_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_hero_presets_hero ON hero_presets(hero_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_hero_presets_default
    ON hero_presets(hero_id) WHERE is_default = 1;

  CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    equipped_by TEXT REFERENCES heroes(id) ON DELETE SET NULL,
    equipped_slot TEXT,
    quantity INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_items_user ON inventory_items(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_items_equipped_slot
    ON inventory_items(equipped_by, equipped_slot)
    WHERE equipped_by IS NOT NULL;

  CREATE TABLE IF NOT EXISTS expeditions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dungeon_id TEXT NOT NULL,
    route_id TEXT,
    depth INTEGER,
    hero_ids_json TEXT NOT NULL,
    seed INTEGER NOT NULL,
    status TEXT NOT NULL,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    settled_at INTEGER,
    result_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expeditions_user ON expeditions(user_id, status);

  CREATE TABLE IF NOT EXISTS dungeon_route_preferences (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dungeon_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, dungeon_id)
  );

  CREATE TABLE IF NOT EXISTS personal_maze_regions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_id TEXT NOT NULL,
    depth INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    generator_version INTEGER NOT NULL,
    source_dungeon_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'frontier' CHECK (status IN ('frontier', 'cleared')),
    explored_rooms_json TEXT NOT NULL DEFAULT '[]',
    dungeon_snapshot_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    cleared_at INTEGER,
    PRIMARY KEY (user_id, series_id, depth)
  );
  CREATE INDEX IF NOT EXISTS idx_personal_maze_regions_user
    ON personal_maze_regions(user_id, series_id, depth);

  CREATE TABLE IF NOT EXISTS personal_maze_progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_id TEXT NOT NULL,
    highest_cleared_depth INTEGER NOT NULL DEFAULT -1,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, series_id)
  );

  CREATE TABLE IF NOT EXISTS expedition_heroes (
    expedition_id TEXT NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    PRIMARY KEY (expedition_id, hero_id)
  );
  CREATE INDEX IF NOT EXISTS idx_expedition_heroes_hero ON expedition_heroes(hero_id);

  CREATE TABLE IF NOT EXISTS expedition_reads (
    expedition_id TEXT NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (expedition_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    leader_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'recruiting',
    dungeon_id TEXT,
    expedition_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id),
    UNIQUE (user_id)
  );

  CREATE TABLE IF NOT EXISTS group_heroes (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position TEXT NOT NULL DEFAULT 'front',
    preset_id TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (group_id, hero_id),
    UNIQUE (hero_id)
  );

  CREATE TABLE IF NOT EXISTS clans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    tag TEXT NOT NULL UNIQUE,
    leader_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gold INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clan_members (
    clan_id TEXT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (clan_id, user_id),
    UNIQUE (user_id)
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    responded_at INTEGER,
    UNIQUE (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_friend_requests_addressee
    ON friend_requests(addressee_id, status);
  CREATE INDEX IF NOT EXISTS idx_friend_requests_requester
    ON friend_requests(requester_id, status);

  CREATE TABLE IF NOT EXISTS duels (
    id TEXT PRIMARY KEY,
    attacker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    defender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seed INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_duels_attacker ON duels(attacker_user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_duels_defender ON duels(defender_user_id, created_at);

  CREATE TABLE IF NOT EXISTS arena_teams (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    member_ids_json TEXT NOT NULL,
    positions_json TEXT NOT NULL,
    power INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    phantom_json TEXT NOT NULL,
    phantom_updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_arena_teams_rating ON arena_teams(rating DESC, wins DESC);

  CREATE TABLE IF NOT EXISTS arena_matches (
    id TEXT PRIMARY KEY,
    attacker_team_id TEXT NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
    defender_team_id TEXT NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
    attacker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    defender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seed INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    attacker_snapshot_json TEXT NOT NULL,
    defender_snapshot_json TEXT NOT NULL,
    theoretical_attacker_delta INTEGER NOT NULL,
    theoretical_defender_delta INTEGER NOT NULL,
    actual_attacker_delta INTEGER NOT NULL,
    actual_defender_delta INTEGER NOT NULL,
    defender_multiplier REAL NOT NULL DEFAULT 1,
    attacker_won INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_arena_matches_attacker ON arena_matches(attacker_team_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_arena_matches_defender ON arena_matches(defender_team_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_arena_matches_pair ON arena_matches(attacker_team_id, defender_team_id, created_at);

  CREATE TABLE IF NOT EXISTS arena_season_team_scores (
    season_id TEXT NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (season_id, team_id)
  );
  CREATE INDEX IF NOT EXISTS idx_arena_season_team_scores_rank
    ON arena_season_team_scores(season_id, rating DESC);

  CREATE TABLE IF NOT EXISTS arena_season_team_rewards (
    season_id TEXT NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    placement INTEGER NOT NULL,
    gold INTEGER NOT NULL DEFAULT 0,
    ep INTEGER NOT NULL DEFAULT 0,
    fame INTEGER NOT NULL DEFAULT 0,
    member_ids_json TEXT NOT NULL DEFAULT '[]',
    claimed_at INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (season_id, team_id)
  );
  CREATE INDEX IF NOT EXISTS idx_arena_team_rewards_user
    ON arena_season_team_rewards(user_id, claimed_at);

  CREATE TABLE IF NOT EXISTS hero_tombstones (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hero_id TEXT NOT NULL,
    name TEXT NOT NULL,
    race_id TEXT NOT NULL,
    weapon_type TEXT NOT NULL,
    ep_earned INTEGER NOT NULL,
    skills_json TEXT NOT NULL DEFAULT '{}',
    duel_wins INTEGER NOT NULL DEFAULT 0,
    duel_losses INTEGER NOT NULL DEFAULT 0,
    duel_rating INTEGER NOT NULL DEFAULT 1000,
    fame INTEGER NOT NULL DEFAULT 0,
    active_title_id TEXT,
    titles_json TEXT NOT NULL DEFAULT '[]',
    died_at INTEGER NOT NULL,
    deleted_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tombstones_user ON hero_tombstones(user_id);

  CREATE TABLE IF NOT EXISTS death_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('pardon', 'redemption')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_death_tokens_user ON death_tokens(user_id, type);

  CREATE TABLE IF NOT EXISTS lottery_periods (
    number INTEGER PRIMARY KEY,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    numbers_json TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_lottery_pools (
    number INTEGER PRIMARY KEY,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'drawn')),
    numbers_json TEXT
  );

  CREATE TABLE IF NOT EXISTS legacy_rewards (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    shards INTEGER NOT NULL DEFAULT 0,
    manuals INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS legacy_cosmetics (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cosmetic_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, cosmetic_id)
  );
  CREATE TABLE IF NOT EXISTS legacy_training (
    hero_id TEXT PRIMARY KEY REFERENCES heroes(id) ON DELETE CASCADE,
    uses INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS hero_drafts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    race_ids_json TEXT NOT NULL,
    weapon_types_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    rerolls_used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lottery_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_number INTEGER,
    digits_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'stock',
    matched_json TEXT,
    matched_count INTEGER NOT NULL DEFAULT 0,
    redeemed_at INTEGER,
    created_at INTEGER NOT NULL,
    prize_shards INTEGER NOT NULL DEFAULT 0,
    legacy INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_lottery_tickets_user
    ON lottery_tickets(user_id, status);

  CREATE TABLE IF NOT EXISTS clan_items (
    id TEXT PRIMARY KEY,
    clan_id TEXT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    item_json TEXT NOT NULL,
    added_by TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_clan_items_clan ON clan_items(clan_id);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    channel TEXT NOT NULL,
    group_id TEXT,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel, created_at);

  CREATE TABLE IF NOT EXISTS market_listings (
    id TEXT PRIMARY KEY,
    seller_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    item_json TEXT NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    buyer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    sold_at INTEGER,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_market_status ON market_listings(status, expires_at);

  CREATE TABLE IF NOT EXISTS auction_listings (
    id TEXT PRIMARY KEY,
    seller_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    item_json TEXT NOT NULL,
    start_price INTEGER NOT NULL,
    buyout_price INTEGER,
    current_bid INTEGER,
    current_bidder_user_id TEXT,
    bid_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    closes_at INTEGER NOT NULL,
    sold_at INTEGER,
    final_price INTEGER,
    fee INTEGER NOT NULL DEFAULT 0,
    seller_payout INTEGER,
    buyer_user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_auctions_status
    ON auction_listings(status, closes_at);
  CREATE INDEX IF NOT EXISTS idx_auctions_seller
    ON auction_listings(seller_user_id, status);

  CREATE TABLE IF NOT EXISTS auction_bids (
    id TEXT PRIMARY KEY,
    auction_id TEXT NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
    bidder_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auction_bids_listing
    ON auction_bids(auction_id, amount DESC);

  CREATE TABLE IF NOT EXISTS arena_seasons (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_arena_seasons_status
    ON arena_seasons(status, end_at);

  CREATE TABLE IF NOT EXISTS arena_season_scores (
    season_id TEXT NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (season_id, hero_id)
  );
  CREATE INDEX IF NOT EXISTS idx_arena_season_scores_rank
    ON arena_season_scores(season_id, rating DESC);

  CREATE TABLE IF NOT EXISTS arena_season_rewards (
    season_id TEXT NOT NULL REFERENCES arena_seasons(id) ON DELETE CASCADE,
    hero_id TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    placement INTEGER NOT NULL,
    gold INTEGER NOT NULL,
    ep INTEGER NOT NULL,
    fame INTEGER NOT NULL,
    claimed_at INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (season_id, hero_id)
  );
  CREATE INDEX IF NOT EXISTS idx_arena_rewards_user
    ON arena_season_rewards(user_id, claimed_at);
`);

// 日池升级：旧未开奖券恢复为库存，已开奖券保留原奖励。迁移可重复启动。
const arenaMatchColumns = db.prepare("PRAGMA table_info(arena_matches)").all() as unknown as Array<{ name: string }>;
if (arenaMatchColumns.length > 0 && !arenaMatchColumns.some((column) => column.name === "attacker_won")) {
  db.exec("ALTER TABLE arena_matches ADD COLUMN attacker_won INTEGER NOT NULL DEFAULT 0");
}

const rewardsColumns = db.prepare("PRAGMA table_info(legacy_rewards)").all() as unknown as Array<{ name: string }>;
if (rewardsColumns.length > 0 && !rewardsColumns.some((column) => column.name === "manuals")) {
  db.exec("ALTER TABLE legacy_rewards ADD COLUMN manuals INTEGER NOT NULL DEFAULT 0");
}
const lotteryColumns = db.prepare("PRAGMA table_info(lottery_tickets)").all() as unknown as Array<{ name: string }>;
if (!lotteryColumns.some((column) => column.name === "legacy")) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("ALTER TABLE lottery_tickets RENAME TO lottery_tickets_old");
    db.exec(`CREATE TABLE lottery_tickets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_number INTEGER, digits_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'stock', matched_json TEXT, matched_count INTEGER NOT NULL DEFAULT 0,
      redeemed_at INTEGER, created_at INTEGER NOT NULL, prize_shards INTEGER NOT NULL DEFAULT 0,
      legacy INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`INSERT INTO lottery_tickets
      (id,user_id,period_number,digits_json,status,matched_json,matched_count,redeemed_at,created_at,legacy)
      SELECT id,user_id,CASE WHEN status='pending' THEN NULL ELSE period_number END,
        CASE WHEN status='pending' THEN '[]' ELSE digits_json END,
        CASE WHEN status='pending' THEN 'stock' ELSE status END,
        matched_json,matched_count,redeemed_at,created_at,CASE WHEN status='pending' THEN 0 ELSE 1 END
      FROM lottery_tickets_old`);
    db.exec("DROP TABLE lottery_tickets_old");
    db.exec("CREATE INDEX idx_lottery_tickets_user ON lottery_tickets(user_id,status)");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
const tombColumns = db.prepare("PRAGMA table_info(hero_tombstones)").all() as unknown as Array<{ name: string }>;
if (!tombColumns.some((column) => column.name === "available_ep")) {
  db.exec("ALTER TABLE hero_tombstones ADD COLUMN available_ep INTEGER");
}

// 轻量迁移：为旧存档补充 EP / 技能列。
const heroColumns = db.prepare("PRAGMA table_info(heroes)").all() as unknown as Array<{
  name: string;
}>;
const heroColumnNames = new Set(heroColumns.map((column) => column.name));
if (!heroColumnNames.has("ep_earned")) {
  db.exec("ALTER TABLE heroes ADD COLUMN ep_earned INTEGER NOT NULL DEFAULT 500");
}
if (!heroColumnNames.has("skills_json")) {
  db.exec("ALTER TABLE heroes ADD COLUMN skills_json TEXT NOT NULL DEFAULT '{}'");
}
if (!heroColumnNames.has("duel_wins")) {
  db.exec("ALTER TABLE heroes ADD COLUMN duel_wins INTEGER NOT NULL DEFAULT 0");
}
if (!heroColumnNames.has("duel_losses")) {
  db.exec("ALTER TABLE heroes ADD COLUMN duel_losses INTEGER NOT NULL DEFAULT 0");
}
if (!heroColumnNames.has("duel_rating")) {
  db.exec("ALTER TABLE heroes ADD COLUMN duel_rating INTEGER NOT NULL DEFAULT 1000");
}
if (!heroColumnNames.has("fame")) {
  db.exec("ALTER TABLE heroes ADD COLUMN fame INTEGER NOT NULL DEFAULT 0");
}
if (!heroColumnNames.has("active_title_id")) {
  db.exec("ALTER TABLE heroes ADD COLUMN active_title_id TEXT");
}
const userColumns = db.prepare("PRAGMA table_info(users)").all() as unknown as Array<{
  name: string;
}>;
if (!userColumns.some((column) => column.name === "premium")) {
  db.exec("ALTER TABLE users ADD COLUMN premium INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.some((column) => column.name === "registration_ip_hash")) {
  db.exec("ALTER TABLE users ADD COLUMN registration_ip_hash TEXT");
}
const presetColumns = db.prepare("PRAGMA table_info(hero_presets)").all() as unknown as Array<{
  name: string;
}>;
if (!presetColumns.some((column) => column.name === "bound_dungeon_id")) {
  db.exec("ALTER TABLE hero_presets ADD COLUMN bound_dungeon_id TEXT");
}
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_hero_presets_bound ON hero_presets(hero_id, bound_dungeon_id)",
);
const groupHeroColumns = db
  .prepare("PRAGMA table_info(group_heroes)")
  .all() as unknown as Array<{ name: string }>;
if (!groupHeroColumns.some((column) => column.name === "preset_id")) {
  db.exec("ALTER TABLE group_heroes ADD COLUMN preset_id TEXT");
}
if (!groupHeroColumns.some((column) => column.name === "settings_json")) {
  db.exec(
    "ALTER TABLE group_heroes ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'",
  );
}
const chatColumns = db
  .prepare("PRAGMA table_info(chat_messages)")
  .all() as unknown as Array<{ name: string }>;
if (!chatColumns.some((column) => column.name === "group_id")) {
  db.exec("ALTER TABLE chat_messages ADD COLUMN group_id TEXT");
}
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_chat_group ON chat_messages(channel, group_id, created_at)",
);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_users_registration_ip ON users(registration_ip_hash)",
);
const expeditionColumns = db.prepare("PRAGMA table_info(expeditions)").all() as unknown as Array<{
  name: string;
}>;
if (!expeditionColumns.some((column) => column.name === "group_id")) {
  db.exec("ALTER TABLE expeditions ADD COLUMN group_id TEXT");
}
if (!expeditionColumns.some((column) => column.name === "route_id")) {
  db.exec("ALTER TABLE expeditions ADD COLUMN route_id TEXT");
}
if (!expeditionColumns.some((column) => column.name === "room_path_json")) {
  db.exec("ALTER TABLE expeditions ADD COLUMN room_path_json TEXT");
}
const groupQueueColumns = db
  .prepare("PRAGMA table_info(groups)")
  .all() as unknown as Array<{ name: string }>;
if (!groupQueueColumns.some((column) => column.name === "queue_dungeon_id")) {
  db.exec("ALTER TABLE groups ADD COLUMN queue_dungeon_id TEXT");
}
if (!groupQueueColumns.some((column) => column.name === "queue_route_id")) {
  db.exec("ALTER TABLE groups ADD COLUMN queue_route_id TEXT");
}
if (!groupQueueColumns.some((column) => column.name === "queue_depth")) {
  db.exec("ALTER TABLE groups ADD COLUMN queue_depth INTEGER");
}
if (!groupQueueColumns.some((column) => column.name === "queue_created_at")) {
  db.exec("ALTER TABLE groups ADD COLUMN queue_created_at INTEGER");
}
if (!groupQueueColumns.some((column) => column.name === "queue_room_path_json")) {
  db.exec("ALTER TABLE groups ADD COLUMN queue_room_path_json TEXT");
}
if (!groupQueueColumns.some((column) => column.name === "visibility")) {
  db.exec(
    "ALTER TABLE groups ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
  );
}
// 旧“中排”并入后排；游走是新的主动越位站位。
db.exec("UPDATE hero_presets SET position = 'back' WHERE position = 'center'");
db.exec("UPDATE group_heroes SET position = 'back' WHERE position = 'center'");
const memberReadyColumns = db
  .prepare("PRAGMA table_info(group_members)")
  .all() as unknown as Array<{ name: string }>;
if (!memberReadyColumns.some((column) => column.name === "ready_state")) {
  db.exec("ALTER TABLE group_members ADD COLUMN ready_state INTEGER NOT NULL DEFAULT 0");
}
if (!expeditionColumns.some((column) => column.name === "depth")) {
  db.exec("ALTER TABLE expeditions ADD COLUMN depth INTEGER");
}
if (!expeditionColumns.some((column) => column.name === "maze_series_id")) {
  db.exec("ALTER TABLE expeditions ADD COLUMN maze_series_id TEXT");
}
if (!expeditionColumns.some((column) => column.name === "maze_depth")) {
  db.exec("ALTER TABLE expeditions ADD COLUMN maze_depth INTEGER");
}
if (!expeditionColumns.some((column) => column.name === "maze_generator_version")) {
  db.exec("ALTER TABLE expeditions ADD COLUMN maze_generator_version INTEGER");
}
if (!expeditionColumns.some((column) => column.name === "maze_snapshot_json")) {
  db.exec("ALTER TABLE expeditions ADD COLUMN maze_snapshot_json TEXT");
}
const itemColumns = db.prepare("PRAGMA table_info(inventory_items)").all() as unknown as Array<{
  name: string;
}>;
if (!heroColumns.some((column) => column.name === "died_at")) {
  db.exec("ALTER TABLE heroes ADD COLUMN died_at INTEGER");
}
if (!itemColumns.some((column) => column.name === "quantity")) {
  db.exec("ALTER TABLE inventory_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1");
}
const clanColumns = db.prepare("PRAGMA table_info(clans)").all() as unknown as Array<{
  name: string;
}>;
if (!clanColumns.some((column) => column.name === "gold")) {
  db.exec("ALTER TABLE clans ADD COLUMN gold INTEGER NOT NULL DEFAULT 0");
}

// 为旧英雄补一个默认战斗预设。
const heroesWithoutPresets = db
  .prepare(
    `SELECT h.id, h.user_id
       FROM heroes h
      WHERE NOT EXISTS (SELECT 1 FROM hero_presets p WHERE p.hero_id = h.id)`,
  )
  .all() as unknown as Array<{ id: string; user_id: string }>;
const presetNow = Date.now();
for (const hero of heroesWithoutPresets) {
  db.prepare(
    `INSERT INTO hero_presets
       (id, user_id, hero_id, name, position, settings_json, is_default, created_at, updated_at)
     VALUES (?, ?, ?, '默认', 'front', '{}', 1, ?, ?)`,
  ).run(randomUUID(), hero.user_id, hero.id, presetNow, presetNow);
}

// 极端情况下补一个默认标记，避免一个英雄有预设但没有默认项。
const heroesWithoutDefault = db
  .prepare(
    `SELECT h.id
       FROM heroes h
      WHERE EXISTS (SELECT 1 FROM hero_presets p WHERE p.hero_id = h.id)
        AND NOT EXISTS (
          SELECT 1 FROM hero_presets p WHERE p.hero_id = h.id AND p.is_default = 1
        )`,
  )
  .all() as unknown as Array<{ id: string }>;
for (const hero of heroesWithoutDefault) {
  db.prepare(
    `UPDATE hero_presets SET is_default = 1
      WHERE id = (
        SELECT id FROM hero_presets WHERE hero_id = ? ORDER BY created_at ASC LIMIT 1
      )`,
  ).run(hero.id);
}

// 第一次上线未读战报时，把历史已完成战报视为已读，避免旧存档突然出现大量未读。
const readBackfillKey = "expedition_reads_backfilled_v1";
const readBackfilled = db
  .prepare("SELECT value FROM app_meta WHERE key = ?")
  .get(readBackfillKey) as unknown as { value: string } | undefined;
if (!readBackfilled) {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const backfillSql = `
      INSERT OR IGNORE INTO expedition_reads (expedition_id, user_id, read_at)
      SELECT e.id, %USER%, COALESCE(e.settled_at, e.end_at, e.created_at)
        FROM expeditions e
        %JOIN%
       WHERE e.status = 'completed'
    `;
    db.exec(
      backfillSql
        .replace("%USER%", "e.user_id")
        .replace("%JOIN%", ""),
    );
    db.exec(
      backfillSql
        .replace("%USER%", "gm.user_id")
        .replace(
          "%JOIN%",
          "JOIN group_members gm ON gm.group_id = e.group_id",
        ),
    );
    db.exec(
      backfillSql
        .replace("%USER%", "h.user_id")
        .replace(
          "%JOIN%",
          `JOIN expedition_heroes eh ON eh.expedition_id = e.id
           JOIN heroes h ON h.id = eh.hero_id`,
        ),
    );
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
      readBackfillKey,
      String(now),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
