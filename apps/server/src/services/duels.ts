import { randomUUID } from "node:crypto";
import {
  buildHeroCombatant,
  createSeed,
  levelFromEp,
  Rng,
  simulateEncounter,
  type HeroRunSpec,
} from "@wod/engine";
import type { ArenaEntry, DuelResultView, DuelSide, WeaponType } from "@wod/shared";
import { weaponPath } from "@wod/shared";
import { FAME_DUEL_WIN } from "../config.js";
import { content } from "../content.js";
import { db } from "../db.js";
import { conflict, notFound } from "../errors.js";
import type { HeroRow } from "../types.js";
import { busyExpeditionId, equipmentRefs, parseJson } from "../views.js";
import { applyDuelQuestRewards } from "./quests.js";
import { ensureSeason, recordSeasonDuel } from "./seasons.js";

function heroSpec(hero: HeroRow): HeroRunSpec {
  return {
    id: hero.id,
    name: hero.name,
    level: levelFromEp(hero.ep_earned),
    epEarned: hero.ep_earned,
    raceId: hero.race_id,
    weaponType: hero.weapon_type as WeaponType,
    skillLevels: parseJson<Record<string, number>>(hero.skills_json || "{}"),
    position: "front",
    equipment: equipmentRefs(hero.id),
  };
}

function duelSide(hero: HeroRow, playerName: string): DuelSide {
  const path = weaponPath(content, hero.weapon_type as WeaponType);
  return {
    heroId: hero.id,
    heroName: hero.name,
    playerName,
    weaponType: hero.weapon_type as WeaponType,
    weaponName: path?.name ?? hero.weapon_type,
    weaponColor: path?.color ?? "#c9a227",
    level: levelFromEp(hero.ep_earned),
  };
}

function heroPlayerName(userId: string): string {
  const row = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId) as unknown as { username: string } | undefined;
  return row?.username ?? "未知";
}

export function listOpponents(userId: string): DuelSide[] {
  const rows = db
    .prepare(
      `SELECT h.*, u.username
         FROM heroes h JOIN users u ON u.id = h.user_id
        WHERE h.user_id != ?
        ORDER BY h.duel_rating DESC, h.level DESC, h.ep_earned DESC
        LIMIT 60`,
    )
    .all(userId) as unknown as Array<HeroRow & { username: string }>;
  return rows
    .filter(
      (hero) =>
        !busyExpeditionId(hero.id) && !hero.died_at,
    )
    .slice(0, 24)
    .map((hero) => duelSide(hero, hero.username));
}

export function fightDuel(
  userId: string,
  heroId: string,
  opponentHeroId: string,
): DuelResultView {
  if (heroId === opponentHeroId) throw conflict("不能挑战自己");
  const attacker = db
    .prepare("SELECT * FROM heroes WHERE id = ? AND user_id = ?")
    .get(heroId, userId) as unknown as HeroRow | undefined;
  if (!attacker) throw notFound("你的英雄不存在");
  const defender = db
    .prepare("SELECT * FROM heroes WHERE id = ?")
    .get(opponentHeroId) as unknown as (HeroRow & { user_id: string }) | undefined;
  if (!defender) throw notFound("对手不存在");
  if (defender.user_id === userId) throw conflict("不能挑战自己的英雄");
  if (busyExpeditionId(attacker.id)) throw conflict(`${attacker.name} 正在远征中`);
  if (busyExpeditionId(defender.id)) throw conflict(`${defender.name} 正在远征中`);
  if (attacker.died_at) throw conflict(`${attacker.name} 已永久死亡`, "hero_dead");
  if (defender.died_at) throw conflict(`${defender.name} 已永久死亡`, "hero_dead");

  const seed = createSeed();
  const attackerCombatant = buildHeroCombatant(content, heroSpec(attacker));
  const defenderCombatant = buildHeroCombatant(content, heroSpec(defender));
  defenderCombatant.side = "enemy";

  const encounter = simulateEncounter([attackerCombatant], [defenderCombatant], new Rng(seed), {
    name: `决斗：${attacker.name} 对 ${defender.name}`,
    maxRounds: 20,
  });
  const victory = encounter.victory;

  const expected = 1 / (1 + 10 ** ((defender.duel_rating - attacker.duel_rating) / 400));
  const attackerDelta = Math.round(32 * ((victory ? 1 : 0) - expected));
  const defenderDelta = -attackerDelta;

  const now = Date.now();
  const season = ensureSeason(now);
  const result: DuelResultView = {
    id: randomUUID(),
    attacker: duelSide(attacker, heroPlayerName(userId)),
    defender: duelSide(defender, heroPlayerName(defender.user_id)),
    outcome: victory ? "victory" : "defeat",
    rounds: encounter.rounds,
    log: encounter.log,
    combatants: encounter.combatants,
    energyRegen: encounter.energyRegen,
    damageDealt: encounter.damageDealt,
    damageTaken: encounter.damageTaken,
    ratingChanges: { attacker: attackerDelta, defender: defenderDelta },
    createdAt: now,
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [hero, wins, losses, rating] of [
      [
        attacker,
        victory ? 1 : 0,
        victory ? 0 : 1,
        Math.max(0, attacker.duel_rating + attackerDelta),
      ],
      [
        defender,
        victory ? 0 : 1,
        victory ? 1 : 0,
        Math.max(0, defender.duel_rating + defenderDelta),
      ],
    ] as const) {
      db.prepare(
        `UPDATE heroes
            SET duel_wins = duel_wins + ?, duel_losses = duel_losses + ?, duel_rating = ?
          WHERE id = ?`,
      ).run(wins, losses, rating, hero.id);
    }
    recordSeasonDuel(season.id, attacker, defender, victory, now);
    applyDuelQuestRewards(
      {
        userId,
        heroId: attacker.id,
        victory,
        fame: victory ? FAME_DUEL_WIN : 0,
      },
      now,
    );
    applyDuelQuestRewards(
      {
        userId: defender.user_id,
        heroId: defender.id,
        victory: !victory,
        fame: victory ? 0 : FAME_DUEL_WIN,
      },
      now,
    );
    db.prepare(
      "INSERT INTO duels (id, attacker_user_id, defender_user_id, seed, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(result.id, userId, defender.user_id, seed, JSON.stringify(result), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return result;
}

export function arenaLeaderboard(): ArenaEntry[] {
  const rows = db
    .prepare(
      `SELECT h.id, h.name, h.weapon_type, h.duel_rating, h.duel_wins, h.duel_losses, u.username
         FROM heroes h JOIN users u ON u.id = h.user_id
        WHERE h.duel_wins + h.duel_losses > 0
        ORDER BY h.duel_rating DESC, h.duel_wins DESC
        LIMIT 50`,
    )
    .all() as unknown as Array<{
    id: string;
    name: string;
    weapon_type: string;
    duel_rating: number;
    duel_wins: number;
    duel_losses: number;
    username: string;
  }>;
  return rows.map((row, index) => {
    const path = weaponPath(content, row.weapon_type as WeaponType);
    return {
      rank: index + 1,
      heroId: row.id,
      heroName: row.name,
      playerName: row.username,
      weaponType: row.weapon_type as WeaponType,
      weaponName: path?.name ?? row.weapon_type,
      weaponColor: path?.color ?? "#c9a227",
      rating: row.duel_rating,
      wins: row.duel_wins,
      losses: row.duel_losses,
    };
  });
}

export function duelHistory(userId: string): DuelResultView[] {
  const rows = db
    .prepare(
      `SELECT result_json FROM duels
        WHERE attacker_user_id = ? OR defender_user_id = ?
        ORDER BY created_at DESC LIMIT 20`,
    )
    .all(userId, userId) as unknown as Array<{ result_json: string }>;
  return rows.map((row) => parseJson<DuelResultView>(row.result_json));
}
