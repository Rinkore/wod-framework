import { randomUUID } from "node:crypto";
import {
  buildHeroCombatant,
  computeHeroPower,
  createSeed,
  levelFromEp,
  Rng,
  simulateEncounter,
  type HeroRunSpec,
} from "@wod/engine";
import type {
  ArenaChallengeView,
  ArenaOpponentView,
  ArenaTeamBattleResultView,
  ArenaTeamEntry,
  ArenaTeamInput,
  ArenaTeamMemberView,
  ArenaTeamResultView,
  ArenaTeamView,
  DuelSide,
  WeaponType,
} from "@wod/shared";
import { weaponPath } from "@wod/shared";
import { content } from "../content.js";
import { db } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { HeroRow } from "../types.js";
import { busyExpeditionId, equipmentRefs, parseJson } from "../views.js";
import { ensureSeason } from "./seasons.js";
import { recordArenaTeamMatch } from "./arena-seasons.js";

const DAILY_LIMIT = 5;
const COOLDOWN_MS = 48 * 60 * 60 * 1000;
const K_FACTOR = 24;
const POWER_EXCEPTION = 0.01;

type ArenaTeamRow = {
  id: string;
  user_id: string;
  member_ids_json: string;
  positions_json: string;
  power: number;
  rating: number;
  wins: number;
  losses: number;
  phantom_json: string;
  phantom_updated_at: number;
  created_at: number;
  updated_at: number;
};

type ArenaSnapshotMember = {
  spec: HeroRunSpec;
  power: number;
  weaponName: string;
  weaponColor: string;
};

type ArenaSnapshot = {
  members: ArenaSnapshotMember[];
  power: number;
  updatedAt: number;
};

type StoredTeamMember = { heroId: string; position: HeroRunSpec["position"] };

function localDayStart(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function heroPlayerName(userId: string): string {
  const row = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as unknown as
    | { username: string }
    | undefined;
  return row?.username ?? "未知";
}

function heroSpec(hero: HeroRow, position: HeroRunSpec["position"]): HeroRunSpec {
  return {
    id: hero.id,
    name: hero.name,
    level: levelFromEp(hero.ep_earned),
    epEarned: hero.ep_earned,
    raceId: hero.race_id,
    weaponType: hero.weapon_type as WeaponType,
    skillLevels: parseJson<Record<string, number>>(hero.skills_json || "{}"),
    position,
    equipment: equipmentRefs(hero.id),
  };
}

function weaponInfo(weaponType: string): { name: string; color: string } {
  const path = weaponPath(content, weaponType as WeaponType);
  return { name: path?.name ?? weaponType, color: path?.color ?? "#c9a227" };
}

function memberSide(member: ArenaSnapshotMember, playerName: string): ArenaTeamMemberView {
  const info = weaponInfo(member.spec.weaponType);
  return {
    heroId: member.spec.id,
    heroName: member.spec.name,
    playerName,
    weaponType: member.spec.weaponType,
    weaponName: member.weaponName || info.name,
    weaponColor: member.weaponColor || info.color,
    level: member.spec.level,
    position: member.spec.position ?? "front",
    power: member.power,
  };
}

function toSnapshot(members: ArenaSnapshotMember[], now: number): ArenaSnapshot {
  return {
    members,
    power: members.reduce((sum, member) => sum + member.power, 0),
    updatedAt: now,
  };
}

function rowForUser(userId: string): ArenaTeamRow | undefined {
  return db.prepare("SELECT * FROM arena_teams WHERE user_id = ?").get(userId) as unknown as
    | ArenaTeamRow
    | undefined;
}

function rowById(teamId: string): ArenaTeamRow | undefined {
  return db.prepare("SELECT * FROM arena_teams WHERE id = ?").get(teamId) as unknown as
    | ArenaTeamRow
    | undefined;
}

function storedMembers(team: ArenaTeamRow): StoredTeamMember[] {
  const ids = parseJson<string[]>(team.member_ids_json);
  const positions = parseJson<Record<string, HeroRunSpec["position"]>>(team.positions_json);
  return ids.map((heroId) => ({ heroId, position: positions[heroId] ?? "front" }));
}

function currentMembers(userId: string, team: ArenaTeamRow, requireAvailable = false): ArenaSnapshotMember[] {
  const members = storedMembers(team);
  if (members.length !== 4 || new Set(members.map((member) => member.heroId)).size !== 4) {
    throw conflict("竞技场队伍配置已损坏，请重新保存队伍", "arena_team_invalid");
  }
  const result: ArenaSnapshotMember[] = [];
  for (const member of members) {
    const hero = db
      .prepare("SELECT * FROM heroes WHERE id = ? AND user_id = ?")
      .get(member.heroId, userId) as unknown as HeroRow | undefined;
    if (!hero) throw conflict("竞技场队伍包含不存在的英雄，请重新保存队伍", "arena_team_invalid");
    if (hero.died_at) throw conflict(`${hero.name} 已永久死亡`, "hero_dead");
    if (requireAvailable && busyExpeditionId(hero.id)) {
      throw conflict(`${hero.name} 正在远征中`);
    }
    const spec = heroSpec(hero, member.position);
    const info = weaponInfo(hero.weapon_type);
    result.push({
      spec,
      power: computeHeroPower(content, spec),
      weaponName: info.name,
      weaponColor: info.color,
    });
  }
  return result;
}

function snapshotForTeam(team: ArenaTeamRow): ArenaSnapshot {
  try {
    const snapshot = parseJson<ArenaSnapshot>(team.phantom_json);
    if (snapshot.members?.length === 4) return snapshot;
  } catch {
    // fall through to the explicit error below
  }
  throw conflict("对手的竞技场幻影无效", "arena_phantom_invalid");
}

function resultTeam(teamId: string, userId: string, members: ArenaSnapshotMember[]): ArenaTeamResultView {
  return {
    teamId,
    playerName: heroPlayerName(userId),
    members: members.map((member) => memberSide(member, heroPlayerName(userId))),
  };
}

function teamView(
  team: ArenaTeamRow,
  members: ArenaSnapshotMember[],
  playerName = heroPlayerName(team.user_id),
): ArenaTeamView {
  const snapshot = toSnapshot(members, team.phantom_updated_at);
  return {
    id: team.id,
    userId: team.user_id,
    playerName,
    members: members.map((member) => memberSide(member, playerName)),
    power: snapshot.power,
    rating: team.rating,
    wins: team.wins,
    losses: team.losses,
    phantomUpdatedAt: team.phantom_updated_at,
    createdAt: team.created_at,
  };
}

function dailyChallenges(userId: string, now: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS value FROM arena_matches WHERE attacker_user_id = ? AND created_at >= ?")
    .get(userId, localDayStart(now)) as unknown as { value: number };
  return row.value;
}

function latestPairMatch(attackerTeamId: string, defenderTeamId: string): { created_at: number } | undefined {
  return db
    .prepare(
      `SELECT created_at FROM arena_matches
        WHERE attacker_team_id = ? AND defender_team_id = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(attackerTeamId, defenderTeamId) as unknown as { created_at: number } | undefined;
}

function defenderMultiplier(teamId: string, now: number): number {
  const row = db
    .prepare(
        `SELECT COUNT(*) AS value FROM arena_matches
        WHERE defender_team_id = ? AND attacker_won = 1 AND created_at >= ?`,
    )
    .get(teamId, localDayStart(now)) as unknown as { value: number };
  if (row.value === 0) return 1;
  if (row.value === 1) return 0.25;
  return 0;
}

function challengeFor(attacker: ArenaTeamRow, defender: ArenaTeamRow, now: number): ArenaChallengeView {
  const used = dailyChallenges(attacker.user_id, now);
  const latest = latestPairMatch(attacker.id, defender.id);
  const cooldownUntil = latest && latest.created_at + COOLDOWN_MS > now
    ? latest.created_at + COOLDOWN_MS
    : null;
  const powerGap = Math.abs(attacker.power - defender.power) / Math.max(1, defender.power);
  const powerException = powerGap < POWER_EXCEPTION;
  let reason: string | null = null;
  if (used >= DAILY_LIMIT) reason = "今日主动挑战次数已用尽";
  else if (cooldownUntil) reason = "同一攻防队伍仍在 48 小时冷却中";
  else if (defender.rating <= attacker.rating && !powerException) reason = "只能挑战更高积分的队伍";
  return {
    allowed: reason === null,
    reason,
    dailyUsed: used,
    dailyLimit: DAILY_LIMIT,
    cooldownUntil,
    powerException,
    defenderMultiplier: defenderMultiplier(defender.id, now),
  };
}

export function getArenaTeam(userId: string): ArenaTeamView | null {
  const team = rowForUser(userId);
  if (!team) return null;
  return teamView(team, currentMembers(userId, team));
}

export function saveArenaTeam(userId: string, input: ArenaTeamInput): ArenaTeamView {
  const ids = input.members.map((member) => member.heroId);
  if (new Set(ids).size !== 4) throw badRequest("竞技场英雄不能重复");
  const existing = rowForUser(userId);
  const pseudoTeam = existing ?? ({ id: randomUUID(), user_id: userId } as ArenaTeamRow);
  const members = currentMembers(
    userId,
    {
      ...pseudoTeam,
      member_ids_json: JSON.stringify(ids),
      positions_json: JSON.stringify(Object.fromEntries(input.members.map((member) => [member.heroId, member.position]))),
    },
    true,
  );
  const now = Date.now();
  const snapshot = toSnapshot(members, now);
  const teamId = existing?.id ?? pseudoTeam.id;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (existing) {
      // 阵容编辑不会刷新幻影；幻影只在主动挑战获胜后更新。
      db.prepare(
        `UPDATE arena_teams SET member_ids_json = ?, positions_json = ?, power = ?,
          updated_at = ? WHERE id = ? AND user_id = ?`,
      ).run(
        JSON.stringify(ids),
        JSON.stringify(Object.fromEntries(input.members.map((member) => [member.heroId, member.position]))),
        snapshot.power,
        now,
        teamId,
        userId,
      );
    } else {
      db.prepare(
        `INSERT INTO arena_teams
          (id, user_id, member_ids_json, positions_json, power, rating, wins, losses,
           phantom_json, phantom_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1000, 0, 0, ?, ?, ?, ?)`,
      ).run(
        teamId,
        userId,
        JSON.stringify(ids),
        JSON.stringify(Object.fromEntries(input.members.map((member) => [member.heroId, member.position]))),
        snapshot.power,
        JSON.stringify(snapshot),
        now,
        now,
        now,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const saved = rowById(teamId);
  if (!saved) throw new Error("竞技场队伍保存失败");
  return teamView(saved, members);
}

export function listArenaOpponents(userId: string): ArenaOpponentView[] {
  const own = rowForUser(userId);
  if (!own) return [];
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT t.*, u.username FROM arena_teams t JOIN users u ON u.id = t.user_id
        WHERE t.user_id != ? ORDER BY t.rating DESC, t.wins DESC, t.updated_at ASC LIMIT 100`,
    )
    .all(userId) as unknown as Array<ArenaTeamRow & { username: string }>;
  return rows.map((row) => {
    const phantom = snapshotForTeam(row);
    const view = teamView(row, phantom.members, row.username);
    return { ...view, challenge: challengeFor(own, row, now) };
  });
}

export function fightArena(userId: string, opponentTeamId: string): ArenaTeamBattleResultView {
  const attackerTeam = rowForUser(userId);
  if (!attackerTeam) throw conflict("请先保存竞技场队伍", "arena_team_required");
  const defenderTeam = rowById(opponentTeamId);
  if (!defenderTeam) throw notFound("对手竞技场队伍不存在");
  if (defenderTeam.id === attackerTeam.id || defenderTeam.user_id === userId) {
    throw conflict("不能挑战自己的竞技场队伍");
  }
  const now = Date.now();
  const challenge = challengeFor(attackerTeam, defenderTeam, now);
  if (!challenge.allowed) throw conflict(challenge.reason ?? "当前不可挑战", "arena_challenge_blocked");

  const attackers = currentMembers(userId, attackerTeam, true);
  const defenders = snapshotForTeam(defenderTeam).members;
  const seed = createSeed();
  const attackerCombatants = attackers.map((member) => buildHeroCombatant(content, member.spec));
  const defenderCombatants = defenders.map((member) => {
    const combatant = buildHeroCombatant(content, member.spec);
    combatant.side = "enemy";
    return combatant;
  });
  const encounter = simulateEncounter(
    attackerCombatants,
    defenderCombatants,
    new Rng(seed),
    { name: `竞技场：${heroPlayerName(userId)} 对 ${heroPlayerName(defenderTeam.user_id)}`, maxRounds: 30 },
  );
  const victory = encounter.victory;
  const expected = 1 / (1 + 10 ** ((defenderTeam.rating - attackerTeam.rating) / 400));
  const theoreticalAttacker = Math.round(K_FACTOR * ((victory ? 1 : 0) - expected));
  const theoreticalDefender = -theoreticalAttacker;
  const scaled = Math.round(theoreticalAttacker * challenge.defenderMultiplier);
  // Zero-sum transfer: a winner can never gain more points than the loser's balance.
  let actualAttacker = scaled >= 0
    ? Math.min(scaled, defenderTeam.rating)
    : -Math.min(-scaled, attackerTeam.rating);
  let actualDefender = -actualAttacker;
  const id = randomUUID();
  const attackerResult = resultTeam(attackerTeam.id, userId, attackers);
  const defenderResult = resultTeam(defenderTeam.id, defenderTeam.user_id, defenders);
  const result: ArenaTeamBattleResultView = {
    id,
    attacker: attackerResult,
    defender: defenderResult,
    outcome: victory ? "victory" : "defeat",
    rounds: encounter.rounds,
    log: encounter.log,
    combatants: encounter.combatants,
    energyRegen: encounter.energyRegen,
    damageDealt: encounter.damageDealt,
    damageTaken: encounter.damageTaken,
    ratingChanges: { attacker: actualAttacker, defender: actualDefender },
    theoreticalRatingChanges: { attacker: theoreticalAttacker, defender: theoreticalDefender },
    defenderMultiplier: challenge.defenderMultiplier,
    createdAt: now,
  };

  const season = ensureSeason(now);
  db.exec("BEGIN IMMEDIATE");
  try {
    // Re-check rate limits under the write lock so concurrent requests cannot both consume a slot.
    const usedNow = dailyChallenges(userId, now);
    if (usedNow >= DAILY_LIMIT) throw conflict("今日主动挑战次数已用尽", "arena_challenge_blocked");
    const latestNow = latestPairMatch(attackerTeam.id, defenderTeam.id);
    if (latestNow && latestNow.created_at + COOLDOWN_MS > now) {
      throw conflict("同一攻防队伍仍在 48 小时冷却中", "arena_challenge_blocked");
    }
    const lockedMultiplier = defenderMultiplier(defenderTeam.id, now);
    if (lockedMultiplier !== challenge.defenderMultiplier) {
      const lockedScaled = Math.round(theoreticalAttacker * lockedMultiplier);
      actualAttacker = lockedScaled >= 0
        ? Math.min(lockedScaled, defenderTeam.rating)
        : -Math.min(-lockedScaled, attackerTeam.rating);
      actualDefender = -actualAttacker;
      result.ratingChanges = { attacker: actualAttacker, defender: actualDefender };
      result.defenderMultiplier = lockedMultiplier;
    }
    db.prepare(
      `UPDATE arena_teams SET rating = MAX(0, rating + ?), wins = wins + ?, losses = losses + ?,
        power = ?, updated_at = ?,
        phantom_json = CASE WHEN ? = 1 THEN ? ELSE phantom_json END,
        phantom_updated_at = CASE WHEN ? = 1 THEN ? ELSE phantom_updated_at END
       WHERE id = ?`,
    ).run(
      actualAttacker,
      victory ? 1 : 0,
      victory ? 0 : 1,
      attackers.reduce((sum, member) => sum + member.power, 0),
      now,
      victory ? 1 : 0,
      JSON.stringify(toSnapshot(attackers, now)),
      victory ? 1 : 0,
      now,
      attackerTeam.id,
    );
    db.prepare(
      `UPDATE arena_teams SET rating = MAX(0, rating + ?), wins = wins + ?, losses = losses + ?, updated_at = ?
       WHERE id = ?`,
    ).run(actualDefender, victory ? 0 : 1, victory ? 1 : 0, now, defenderTeam.id);
    recordArenaTeamMatch(
      season.id,
      attackerTeam.id,
      userId,
      defenderTeam.id,
      defenderTeam.user_id,
      victory,
      actualAttacker,
      actualDefender,
      now,
    );
    db.prepare(
      `INSERT INTO arena_matches
       (id, attacker_team_id, defender_team_id, attacker_user_id, defender_user_id, seed, result_json,
        attacker_snapshot_json, defender_snapshot_json, theoretical_attacker_delta, theoretical_defender_delta,
        actual_attacker_delta, actual_defender_delta, defender_multiplier, attacker_won, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
    ).run(
      id,
      attackerTeam.id,
      defenderTeam.id,
      userId,
      defenderTeam.user_id,
      seed,
      JSON.stringify(result),
      JSON.stringify(toSnapshot(attackers, now)),
      JSON.stringify(toSnapshot(defenders, defenderTeam.phantom_updated_at)),
      theoreticalAttacker,
      theoreticalDefender,
      actualAttacker,
      actualDefender,
      challenge.defenderMultiplier,
      victory ? 1 : 0,
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return result;
}

export function arenaTeamLeaderboard(limit = 50): ArenaTeamEntry[] {
  const rows = db
    .prepare(
      `SELECT t.*, u.username FROM arena_teams t JOIN users u ON u.id = t.user_id
       WHERE t.wins + t.losses > 0 ORDER BY t.rating DESC, t.wins DESC, t.updated_at ASC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(100, limit))) as unknown as Array<ArenaTeamRow & { username: string }>;
  return rows.map((row, index) => {
    const phantom = snapshotForTeam(row);
    return {
      rank: index + 1,
      teamId: row.id,
      playerName: row.username,
      memberNames: phantom.members.map((member) => member.spec.name),
      power: row.power,
      rating: row.rating,
      wins: row.wins,
      losses: row.losses,
    };
  });
}

export function arenaTeamHistory(userId: string): ArenaTeamBattleResultView[] {
  const rows = db
    .prepare(
      `SELECT result_json FROM arena_matches
       WHERE attacker_user_id = ? OR defender_user_id = ?
       ORDER BY created_at DESC LIMIT 20`,
    )
    .all(userId, userId) as unknown as Array<{ result_json: string }>;
  return rows.map((row) => parseJson<ArenaTeamBattleResultView>(row.result_json));
}

export function arenaTeamChallengeInfo(userId: string, teamId: string): ArenaChallengeView {
  const own = rowForUser(userId);
  const opponent = rowById(teamId);
  if (!own) throw conflict("请先保存竞技场队伍", "arena_team_required");
  if (!opponent) throw notFound("对手竞技场队伍不存在");
  return challengeFor(own, opponent, Date.now());
}
