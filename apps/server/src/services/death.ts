import { randomUUID } from "node:crypto";
import { levelFromEp } from "@wod/engine";
import {
  MAX_HEROES_PER_ACCOUNT,
  HERO_DELETE_COST,
  type DeathRosterView,
  type WeaponType,
} from "@wod/shared";
import { db } from "../db.js";
import { badRequest } from "../errors.js";
import type { HeroRow } from "../types.js";
import { parseJson } from "../views.js";
import { ensureDefaultPreset } from "./presets.js";

interface TombstoneRow {
  id: string;
  user_id: string;
  hero_id: string;
  name: string;
  race_id: string;
  weapon_type: string;
  ep_earned: number;
  available_ep: number | null;
  skills_json: string;
  duel_wins: number;
  duel_losses: number;
  duel_rating: number;
  fame: number;
  active_title_id: string | null;
  titles_json: string;
  died_at: number;
  deleted_at: number;
}

export function deadHeroesOf(userId: string): HeroRow[] {
  return db
    .prepare(
      "SELECT * FROM heroes WHERE user_id = ? AND died_at IS NOT NULL ORDER BY died_at ASC",
    )
    .all(userId) as unknown as HeroRow[];
}

export function livingHeroCount(userId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM heroes WHERE user_id = ? AND died_at IS NULL",
    )
    .get(userId) as unknown as { count: number };
  return row.count;
}

export function tokenCount(userId: string, type: "pardon" | "redemption"): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM death_tokens WHERE user_id = ? AND type = ?",
    )
    .get(userId, type) as unknown as { count: number };
  return row.count;
}

export function grantToken(userId: string, type: "pardon" | "redemption", now: number): void {
  db.prepare(
    "INSERT INTO death_tokens (id, user_id, type, created_at) VALUES (?, ?, ?, ?)",
  ).run(randomUUID(), userId, type, now);
}

/** 保留死亡英雄及其装备；死亡人数不影响创建和派遣。 */
export function killHero(hero: HeroRow, now: number): { deleted: boolean } {
  db.prepare("UPDATE heroes SET died_at = COALESCE(died_at, ?) WHERE id = ?").run(now, hero.id);
  return { deleted: false };
}

/** 在调用者的归档事务内保存墓碑，必须在删除英雄及其称号之前调用。 */
export function createTombstone(hero: HeroRow, now: number): void {
  const titles = db
    .prepare("SELECT title_id FROM hero_titles WHERE hero_id = ?")
    .all(hero.id) as unknown as Array<{ title_id: string }>;
  db.prepare(
    `INSERT INTO hero_tombstones
       (id, user_id, hero_id, name, race_id, weapon_type, ep_earned, available_ep, skills_json,
        duel_wins, duel_losses, duel_rating, fame, active_title_id, titles_json, died_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    hero.user_id,
    hero.id,
    hero.name,
    hero.race_id,
    hero.weapon_type,
    hero.ep_earned,
    hero.xp,
    hero.skills_json,
    hero.duel_wins,
    hero.duel_losses,
    hero.duel_rating,
    hero.fame,
    hero.active_title_id,
    JSON.stringify(titles.map((row) => row.title_id)),
    hero.died_at ?? now,
    now,
  );
}

/** 死亡名册视图：死者、归档墓碑与已有复活券。 */
export function deathRosterView(userId: string): DeathRosterView {
  const dead = deadHeroesOf(userId).map((row) => ({
    heroId: row.id,
    name: row.name,
    raceId: row.race_id,
    weaponType: row.weapon_type as WeaponType,
    level: Math.floor(Math.sqrt(row.ep_earned / 1000)) + 1,
    epEarned: row.ep_earned,
    fame: row.fame,
    diedAt: row.died_at ?? 0,
  }));
  const tombstones = (
    db
      .prepare(
        "SELECT * FROM hero_tombstones WHERE user_id = ? ORDER BY deleted_at DESC",
      )
      .all(userId) as unknown as TombstoneRow[]
  ).map((row) => ({
    tombstoneId: row.id,
    name: row.name,
    raceId: row.race_id,
    weaponType: row.weapon_type as WeaponType,
    level: Math.floor(Math.sqrt(row.ep_earned / 1000)) + 1,
    epEarned: row.ep_earned,
    diedAt: row.died_at,
    deletedAt: row.deleted_at,
  }));
  const tokens = [
    { type: "pardon" as const, count: tokenCount(userId, "pardon") },
    { type: "redemption" as const, count: tokenCount(userId, "redemption") },
  ];
  return {
    dead,
    tombstones,
    tokens,
    needsResolution: false,
  };
}

/** 保留旧调用接口；死亡名册不再阻断创建与派遣。 */
export function assertDeathRosterResolved(_userId: string): void {}

function assertRevivalCapacity(userId: string): void {
  if (livingHeroCount(userId) >= MAX_HEROES_PER_ACCOUNT) {
    throw badRequest(`英雄名册已满（${MAX_HEROES_PER_ACCOUNT} 名），无法复活`, "roster_full");
  }
}

/** 旧复活券的消耗与角色恢复必须一起提交或回滚。 */
function revivalTransaction(action: () => HeroRow): HeroRow {
  db.exec("BEGIN IMMEDIATE");
  try {
    const hero = action();
    db.exec("COMMIT");
    return hero;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 使用已有赦免券复活死亡角色，保留装备、可用 EP 和技能。 */
export function reviveWithPardon(userId: string, heroId: string): HeroRow {
  return revivalTransaction(() => {
    const hero = db
      .prepare("SELECT * FROM heroes WHERE id = ? AND user_id = ? AND died_at IS NOT NULL")
      .get(heroId, userId) as unknown as HeroRow | undefined;
    if (!hero) throw badRequest("死亡名册中没有这名角色");
    assertRevivalCapacity(userId);
    consumeToken(userId, "pardon", "死亡赦免券");
    db.prepare("UPDATE heroes SET died_at = NULL WHERE id = ?").run(hero.id);
    ensureDefaultPreset(userId, hero.id);
    return db.prepare("SELECT * FROM heroes WHERE id = ?").get(hero.id) as unknown as HeroRow;
  });
}

/** 使用已有赎回券从墓碑恢复角色；装备保留在背包中。 */
export function reviveWithRedemption(userId: string, tombstoneId: string): HeroRow {
  return revivalTransaction(() => {
    const tomb = db
      .prepare("SELECT * FROM hero_tombstones WHERE id = ? AND user_id = ?")
      .get(tombstoneId, userId) as unknown as TombstoneRow | undefined;
    if (!tomb) throw badRequest("墓碑中不存在这名角色");
    assertRevivalCapacity(userId);
    consumeToken(userId, "redemption", "死亡赎回券");
    db.prepare("DELETE FROM hero_tombstones WHERE id = ?").run(tomb.id);
    const id = randomUUID();
    const now = Date.now();
    const restoredLevel = levelFromEp(tomb.ep_earned);
    db.prepare(
      `INSERT INTO heroes
         (id, user_id, name, race_id, weapon_type, level, xp, ep_earned, skills_json,
          duel_wins, duel_losses, duel_rating, fame, active_title_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      tomb.name,
      tomb.race_id,
      tomb.weapon_type,
      restoredLevel,
      tomb.available_ep ?? 0,
      tomb.ep_earned,
      tomb.skills_json,
      tomb.duel_wins,
      tomb.duel_losses,
      tomb.duel_rating,
      tomb.fame,
      tomb.active_title_id,
      now,
    );
    for (const titleId of parseJson<string[]>(tomb.titles_json)) {
      db.prepare(
        `INSERT OR IGNORE INTO hero_titles (hero_id, title_id, source, unlocked_at)
         VALUES (?, ?, 'fame', ?)`,
      ).run(id, titleId, now);
    }
    ensureDefaultPreset(userId, id);
    return db.prepare("SELECT * FROM heroes WHERE id = ?").get(id) as unknown as HeroRow;
  });
}

function consumeToken(userId: string, type: "pardon" | "redemption", label: string): void {
  const count = tokenCount(userId, type);
  if (count < 1) throw badRequest(`没有可用的${label}`);
  const row = db
    .prepare(
      "SELECT id FROM death_tokens WHERE user_id = ? AND type = ? ORDER BY created_at ASC LIMIT 1",
    )
    .get(userId, type) as unknown as { id: string } | undefined;
  if (!row) throw badRequest(`没有可用的${label}`);
  db.prepare("DELETE FROM death_tokens WHERE id = ?").run(row.id);
}

export { HERO_DELETE_COST };
