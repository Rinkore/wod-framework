import { randomUUID } from "node:crypto";
import { levelFromEp } from "@wod/engine";
import type {
  ArenaEntry,
  ArenaSeasonRewardView,
  ArenaSeasonStateView,
  ArenaSeasonView,
  AuthUser,
  WeaponType,
} from "@wod/shared";
import { weaponPath } from "@wod/shared";
import { SEASON_DURATION_MS } from "../config.js";
import { content } from "../content.js";
import { db } from "../db.js";
import { authUserView } from "../views.js";
import type { HeroRow, UserRow } from "../types.js";
import { awardFame } from "./quests.js";

interface SeasonRow {
  id: string;
  number: number;
  name: string;
  start_at: number;
  end_at: number;
  status: "active" | "ended";
  created_at: number;
}

interface SeasonScoreRow {
  season_id: string;
  hero_id: string;
  user_id: string;
  rating: number;
  wins: number;
  losses: number;
  updated_at: number;
}

interface RewardRow {
  season_id: string;
  hero_id: string;
  user_id: string;
  placement: number;
  gold: number;
  ep: number;
  fame: number;
  claimed_at: number | null;
  created_at: number;
}

function seasonToView(row: SeasonRow): ArenaSeasonView {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
  };
}

function rewardTier(placement: number): { gold: number; ep: number; fame: number } {
  if (placement === 1) return { gold: 500, ep: 500, fame: 10 };
  if (placement <= 3) return { gold: 300, ep: 300, fame: 6 };
  if (placement <= 10) return { gold: 150, ep: 150, fame: 3 };
  if (placement <= 25) return { gold: 80, ep: 80, fame: 1 };
  return { gold: 30, ep: 30, fame: 0 };
}

function entryOf(row: SeasonScoreRow, rank: number): ArenaEntry {
  const hero = db
    .prepare("SELECT name, weapon_type FROM heroes WHERE id = ?")
    .get(row.hero_id) as unknown as { name: string; weapon_type: string } | undefined;
  const user = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(row.user_id) as unknown as { username: string } | undefined;
  const path = hero ? weaponPath(content, hero.weapon_type as WeaponType) : undefined;
  return {
    rank,
    heroId: row.hero_id,
    heroName: hero?.name ?? "未知英雄",
    playerName: user?.username ?? "未知",
    weaponType: (hero?.weapon_type ?? "sword") as WeaponType,
    weaponName: path?.name ?? hero?.weapon_type ?? "未知",
    weaponColor: path?.color ?? "#c9a227",
    rating: row.rating,
    wins: row.wins,
    losses: row.losses,
  };
}

function leaderboardFor(seasonId: string, limit = 50): ArenaEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM arena_season_scores
        WHERE season_id = ?
        ORDER BY rating DESC, wins DESC, updated_at ASC
        LIMIT ?`,
    )
    .all(seasonId, limit) as unknown as SeasonScoreRow[];
  return rows.map((row, index) => entryOf(row, index + 1));
}

function finalizeSeason(season: SeasonRow, now: number): void {
  const scores = db
    .prepare(
      `SELECT * FROM arena_season_scores
        WHERE season_id = ? AND wins + losses > 0
        ORDER BY rating DESC, wins DESC, updated_at ASC`,
    )
    .all(season.id) as unknown as SeasonScoreRow[];
  scores.forEach((score, index) => {
    const tier = rewardTier(index + 1);
    db.prepare(
      `INSERT OR IGNORE INTO arena_season_rewards
         (season_id, hero_id, user_id, placement, gold, ep, fame, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      season.id,
      score.hero_id,
      score.user_id,
      index + 1,
      tier.gold,
      tier.ep,
      tier.fame,
      now,
    );
  });

  // Team arena rewards use the same season lifecycle but keep their own score table.
  const teamScores = db
    .prepare(
      `SELECT * FROM arena_season_team_scores
        WHERE season_id = ? AND wins + losses > 0
        ORDER BY rating DESC, wins DESC, updated_at ASC`,
    )
    .all(season.id) as unknown as Array<{
    team_id: string;
    user_id: string;
  }>;
  teamScores.forEach((score, index) => {
    const tier = rewardTier(index + 1);
    const team = db
      .prepare("SELECT member_ids_json FROM arena_teams WHERE id = ?")
      .get(score.team_id) as unknown as { member_ids_json: string } | undefined;
    db.prepare(
      `INSERT OR IGNORE INTO arena_season_team_rewards
         (season_id, team_id, user_id, placement, gold, ep, fame, member_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      season.id,
      score.team_id,
      score.user_id,
      index + 1,
      tier.gold,
      tier.ep,
      tier.fame,
      team?.member_ids_json ?? "[]",
      now,
    );
  });
  db.prepare(
    "UPDATE arena_seasons SET status = 'ended' WHERE id = ? AND status = 'active'",
  ).run(season.id);
}

export function ensureSeason(now = Date.now()): SeasonRow {
  const active = db
    .prepare(
      "SELECT * FROM arena_seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1",
    )
    .get() as unknown as SeasonRow | undefined;
  if (active && active.end_at > now) return active;

  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db
      .prepare(
        "SELECT * FROM arena_seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1",
      )
      .get() as unknown as SeasonRow | undefined;
    if (current && current.end_at > now) {
      db.exec("COMMIT");
      return current;
    }
    if (current) finalizeSeason(current, now);
    const max = db
      .prepare("SELECT COALESCE(MAX(number), 0) AS value FROM arena_seasons")
      .get() as unknown as { value: number };
    const number = max.value + 1;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO arena_seasons
         (id, number, name, start_at, end_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    ).run(id, number, `第 ${number} 赛季`, now, now + SEASON_DURATION_MS, now);
    db.exec("COMMIT");
    return db
      .prepare("SELECT * FROM arena_seasons WHERE id = ?")
      .get(id) as unknown as SeasonRow;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function scoreFor(seasonId: string, hero: HeroRow): SeasonScoreRow {
  const row = db
    .prepare(
      "SELECT * FROM arena_season_scores WHERE season_id = ? AND hero_id = ?",
    )
    .get(seasonId, hero.id) as unknown as SeasonScoreRow | undefined;
  if (row) return row;
  const now = Date.now();
  db.prepare(
    `INSERT INTO arena_season_scores
       (season_id, hero_id, user_id, rating, wins, losses, updated_at)
     VALUES (?, ?, ?, 1000, 0, 0, ?)`,
  ).run(seasonId, hero.id, hero.user_id, now);
  return {
    season_id: seasonId,
    hero_id: hero.id,
    user_id: hero.user_id,
    rating: 1000,
    wins: 0,
    losses: 0,
    updated_at: now,
  };
}

/** 在决斗事务内调用，不自行 BEGIN/COMMIT。 */
export function recordSeasonDuel(
  seasonId: string,
  attacker: HeroRow,
  defender: HeroRow & { user_id: string },
  attackerWon: boolean,
  now = Date.now(),
): void {
  const attackerScore = scoreFor(seasonId, attacker);
  const defenderScore = scoreFor(seasonId, defender);
  const expected =
    1 /
    (1 + 10 ** ((defenderScore.rating - attackerScore.rating) / 400));
  const attackerDelta = Math.round(32 * ((attackerWon ? 1 : 0) - expected));
  const defenderDelta = -attackerDelta;

  db.prepare(
    `UPDATE arena_season_scores
        SET rating = MAX(0, ?), wins = wins + ?, losses = losses + ?, updated_at = ?
      WHERE season_id = ? AND hero_id = ?`,
  ).run(
    Math.max(0, attackerScore.rating + attackerDelta),
    attackerWon ? 1 : 0,
    attackerWon ? 0 : 1,
    now,
    seasonId,
    attacker.id,
  );
  db.prepare(
    `UPDATE arena_season_scores
        SET rating = MAX(0, ?), wins = wins + ?, losses = losses + ?, updated_at = ?
      WHERE season_id = ? AND hero_id = ?`,
  ).run(
    Math.max(0, defenderScore.rating + defenderDelta),
    attackerWon ? 0 : 1,
    attackerWon ? 1 : 0,
    now,
    seasonId,
    defender.id,
  );
}

function rewardsForUser(userId: string): ArenaSeasonRewardView[] {
  const rows = db
    .prepare(
      `SELECT r.*, s.name AS season_name, h.name AS hero_name
         FROM arena_season_rewards r
         JOIN arena_seasons s ON s.id = r.season_id
         JOIN heroes h ON h.id = r.hero_id
        WHERE r.user_id = ? AND r.claimed_at IS NULL
        ORDER BY s.number DESC, r.placement ASC`,
    )
    .all(userId) as unknown as Array<
    RewardRow & { season_name: string; hero_name: string }
  >;
  return rows.map((row) => ({
    seasonId: row.season_id,
    seasonName: row.season_name,
    heroId: row.hero_id,
    heroName: row.hero_name,
    placement: row.placement,
    gold: row.gold,
    ep: row.ep,
    fame: row.fame,
    claimedAt: row.claimed_at,
  }));
}

export function arenaSeasonState(userId: string): ArenaSeasonStateView {
  const season = ensureSeason();
  const leaderboard = leaderboardFor(season.id);
  const myScore = db
    .prepare(
      `SELECT * FROM arena_season_scores
        WHERE season_id = ? AND user_id = ?
        ORDER BY rating DESC, wins DESC LIMIT 1`,
    )
    .get(season.id, userId) as unknown as SeasonScoreRow | undefined;
  let myBest: ArenaEntry | null = null;
  if (myScore) {
    const rankRow = db
      .prepare(
        `SELECT COUNT(*) + 1 AS value FROM arena_season_scores
          WHERE season_id = ?
            AND (rating > ? OR (rating = ? AND wins > ?))`,
      )
      .get(season.id, myScore.rating, myScore.rating, myScore.wins) as unknown as {
      value: number;
    };
    myBest = entryOf(myScore, rankRow.value);
  }
  return {
    season: seasonToView(season),
    leaderboard,
    myBest,
    rewards: rewardsForUser(userId),
  };
}

export function claimSeasonRewards(userId: string): {
  claimed: ArenaSeasonRewardView[];
  user: AuthUser;
} {
  ensureSeason();
  const rewards = rewardsForUser(userId);
  if (rewards.length === 0) {
    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as unknown as UserRow;
    return { claimed: [], user: authUserView(user) };
  }

  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const reward of rewards) {
      const updated = db
        .prepare(
          `UPDATE arena_season_rewards SET claimed_at = ?
            WHERE season_id = ? AND hero_id = ? AND user_id = ? AND claimed_at IS NULL`,
        )
        .run(now, reward.seasonId, reward.heroId, userId);
      if (updated.changes !== 1) continue;
      if (reward.gold > 0) {
        db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
          reward.gold,
          userId,
        );
      }
      if (reward.ep > 0) {
        const hero = db
          .prepare("SELECT * FROM heroes WHERE id = ? AND user_id = ?")
          .get(reward.heroId, userId) as unknown as HeroRow | undefined;
        if (hero) {
          const epEarned = hero.ep_earned + reward.ep;
          db.prepare(
            "UPDATE heroes SET xp = xp + ?, ep_earned = ?, level = ? WHERE id = ?",
          ).run(reward.ep, epEarned, levelFromEp(epEarned), hero.id);
        }
      }
      if (reward.fame > 0) awardFame(reward.heroId, reward.fame, now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as unknown as UserRow;
  return { claimed: rewards, user: authUserView(user) };
}
