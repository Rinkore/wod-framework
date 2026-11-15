import { levelFromEp } from "@wod/engine";
import type {
  ArenaSeasonView,
  ArenaTeamEntry,
  ArenaTeamSeasonRewardView,
  ArenaTeamSeasonStateView,
  AuthUser,
} from "@wod/shared";
import { db } from "../db.js";
import { authUserView } from "../views.js";
import { awardFame } from "./quests.js";
import type { UserRow } from "../types.js";
import { ensureSeason } from "./seasons.js";

interface TeamScoreRow {
  season_id: string;
  team_id: string;
  user_id: string;
  rating: number;
  wins: number;
  losses: number;
  updated_at: number;
}

interface TeamRewardRow {
  season_id: string;
  team_id: string;
  user_id: string;
  placement: number;
  gold: number;
  ep: number;
  fame: number;
  member_ids_json: string;
  claimed_at: number | null;
  created_at: number;
}

function seasonView(row: { id: string; number: number; name: string; start_at: number; end_at: number; status: "active" | "ended" }): ArenaSeasonView {
  return { id: row.id, number: row.number, name: row.name, startAt: row.start_at, endAt: row.end_at, status: row.status };
}

function rewardTier(placement: number): { gold: number; ep: number; fame: number } {
  if (placement === 1) return { gold: 500, ep: 500, fame: 10 };
  if (placement <= 3) return { gold: 300, ep: 300, fame: 6 };
  if (placement <= 10) return { gold: 150, ep: 150, fame: 3 };
  if (placement <= 25) return { gold: 80, ep: 80, fame: 1 };
  return { gold: 30, ep: 30, fame: 0 };
}

function scoreFor(seasonId: string, teamId: string, userId: string): TeamScoreRow {
  const existing = db.prepare("SELECT * FROM arena_season_team_scores WHERE season_id = ? AND team_id = ?").get(seasonId, teamId) as unknown as TeamScoreRow | undefined;
  if (existing) return existing;
  const team = db.prepare("SELECT rating FROM arena_teams WHERE id = ?").get(teamId) as unknown as { rating: number } | undefined;
  const rating = team?.rating ?? 1000;
  const now = Date.now();
  db.prepare(`INSERT INTO arena_season_team_scores (season_id, team_id, user_id, rating, wins, losses, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?)`).run(seasonId, teamId, userId, rating, now);
  return { season_id: seasonId, team_id: teamId, user_id: userId, rating, wins: 0, losses: 0, updated_at: now };
}

/** The persistent team deltas are authoritative; the season table resets only W/L counters. */
export function recordArenaTeamMatch(
  seasonId: string,
  attackerTeamId: string,
  attackerUserId: string,
  defenderTeamId: string,
  defenderUserId: string,
  attackerWon: boolean,
  attackerDelta: number,
  defenderDelta: number,
  now = Date.now(),
): void {
  const attackerExisted = Boolean(db.prepare("SELECT 1 FROM arena_season_team_scores WHERE season_id = ? AND team_id = ?").get(seasonId, attackerTeamId));
  const defenderExisted = Boolean(db.prepare("SELECT 1 FROM arena_season_team_scores WHERE season_id = ? AND team_id = ?").get(seasonId, defenderTeamId));
  const attacker = scoreFor(seasonId, attackerTeamId, attackerUserId);
  const defender = scoreFor(seasonId, defenderTeamId, defenderUserId);
  // The persistent team row has already been updated by fightArena. A first
  // seasonal row starts at the post-match persistent rating; existing rows
  // receive only this match's delta.
  const attackerBase = attackerExisted ? attacker.rating + attackerDelta : attacker.rating;
  const defenderBase = defenderExisted ? defender.rating + defenderDelta : defender.rating;
  db.prepare(`UPDATE arena_season_team_scores SET rating = MAX(0, ?), wins = wins + ?, losses = losses + ?, updated_at = ? WHERE season_id = ? AND team_id = ?`).run(Math.max(0, attackerBase), attackerWon ? 1 : 0, attackerWon ? 0 : 1, now, seasonId, attackerTeamId);
  db.prepare(`UPDATE arena_season_team_scores SET rating = MAX(0, ?), wins = wins + ?, losses = losses + ?, updated_at = ? WHERE season_id = ? AND team_id = ?`).run(Math.max(0, defenderBase), attackerWon ? 0 : 1, attackerWon ? 1 : 0, now, seasonId, defenderTeamId);
}

function entryFor(row: TeamScoreRow, rank: number): ArenaTeamEntry {
  const team = db.prepare("SELECT power, rating, wins, losses FROM arena_teams WHERE id = ?").get(row.team_id) as unknown as { power: number; rating: number; wins: number; losses: number } | undefined;
  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(row.user_id) as unknown as { username: string } | undefined;
  const memberIds = db.prepare("SELECT member_ids_json FROM arena_teams WHERE id = ?").get(row.team_id) as unknown as { member_ids_json: string } | undefined;
  const names = memberIds ? (JSON.parse(memberIds.member_ids_json) as string[]).map((id) => (db.prepare("SELECT name FROM heroes WHERE id = ?").get(id) as unknown as { name: string } | undefined)?.name ?? "未知英雄") : [];
  return { rank, teamId: row.team_id, playerName: user?.username ?? "未知", memberNames: names, power: team?.power ?? 0, rating: row.rating, wins: row.wins, losses: row.losses };
}

function ensureTeamSeason() {
  // Team scores share the existing season lifecycle and are initialized lazily on match.
  return ensureSeason();
}

function rewardsForUser(userId: string): ArenaTeamSeasonRewardView[] {
  const rows = db.prepare(`SELECT r.*, s.name AS season_name FROM arena_season_team_rewards r JOIN arena_seasons s ON s.id = r.season_id WHERE r.user_id = ? AND r.claimed_at IS NULL ORDER BY s.number DESC, r.placement ASC`).all(userId) as unknown as Array<TeamRewardRow & { season_name: string }>;
  return rows.map((row) => ({ seasonId: row.season_id, seasonName: row.season_name, teamId: row.team_id, placement: row.placement, gold: row.gold, ep: row.ep, fame: row.fame, memberIds: JSON.parse(row.member_ids_json) as string[], claimedAt: row.claimed_at }));
}

export function arenaTeamSeasonState(userId: string): ArenaTeamSeasonStateView {
  const season = ensureTeamSeason();
  const rows = db.prepare("SELECT * FROM arena_season_team_scores WHERE season_id = ? ORDER BY rating DESC, wins DESC, updated_at ASC LIMIT 50").all(season.id) as unknown as TeamScoreRow[];
  const leaderboard = rows.map((row, index) => entryFor(row, index + 1));
  const mine = db.prepare("SELECT * FROM arena_season_team_scores WHERE season_id = ? AND user_id = ? ORDER BY rating DESC, wins DESC LIMIT 1").get(season.id, userId) as unknown as TeamScoreRow | undefined;
  const myBest = mine ? entryFor(mine, 1) : null;
  return { season: seasonView(season), leaderboard, myBest, rewards: rewardsForUser(userId) };
}

export function claimArenaTeamSeasonRewards(userId: string): { claimed: ArenaTeamSeasonRewardView[]; user: AuthUser } {
  ensureTeamSeason();
  const rewards = rewardsForUser(userId);
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const reward of rewards) {
      const updated = db.prepare("UPDATE arena_season_team_rewards SET claimed_at = ? WHERE season_id = ? AND team_id = ? AND user_id = ? AND claimed_at IS NULL").run(now, reward.seasonId, reward.teamId, userId);
      if (updated.changes !== 1) continue;
      db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(reward.gold, userId);
      const memberIds = reward.memberIds;
      const memberCount = memberIds.length;
      const epEach = memberCount > 0 ? Math.floor(reward.ep / memberCount) : 0;
      const epRemainder = memberCount > 0 ? reward.ep % memberCount : 0;
      const fameEach = memberCount > 0 ? Math.floor(reward.fame / memberCount) : 0;
      const fameRemainder = memberCount > 0 ? reward.fame % memberCount : 0;
      for (const [index, heroId] of memberIds.entries()) {
        const hero = db.prepare("SELECT ep_earned FROM heroes WHERE id = ? AND user_id = ?").get(heroId, userId) as unknown as { ep_earned: number } | undefined;
        if (!hero) continue;
        const epReward = epEach + (index < epRemainder ? 1 : 0);
        const ep = hero.ep_earned + epReward;
        db.prepare("UPDATE heroes SET xp = xp + ?, ep_earned = ?, level = ? WHERE id = ?").run(epReward, ep, levelFromEp(ep), heroId);
        const fameReward = fameEach + (index < fameRemainder ? 1 : 0);
        if (fameReward > 0) awardFame(heroId, fameReward, now);
      }
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
  return { claimed: rewards, user: authUserView(user) };
}
