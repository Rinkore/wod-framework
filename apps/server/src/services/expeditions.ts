import { randomUUID } from "node:crypto";
import {
  DUNGEON_LEVEL_TOLERANCE,
  canChallengeMonsterLevel,
  createSeed,
  defaultRoomPath,
  levelFromEp,
  resolveRoomPath,
  roomMonsterLevel,
  simulateExpedition,
  type HeroRunSpec,
} from "@wod/engine";
import {
  affinityPerkFor,
  isDungeonOpen,
  withExtraRoutes,
  type DispatchInput,
  type Dungeon,
  type DungeonRoom,
  type ExpeditionEngineResult,
  type HeroCombatSettings,
  type WeaponType,
} from "@wod/shared";
import { content } from "../content.js";
import { TIME_SCALE } from "../config.js";
import { db } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { ExpeditionRow, HeroRow } from "../types.js";
import { equipmentRefs, expeditionRowToView, parseJson } from "../views.js";
import { getHeroRow } from "./heroes.js";
import { assertDeathRosterResolved } from "./death.js";
import { resolvePresetForDungeon, validateSettings } from "./presets.js";
import { getOrInitRegion } from "./personal-maze.js";

/** 玩家已解锁的进阶深层：seriesId → 最高深度（0 表示只解锁基础层）。 */
export function listDungeonUnlocks(userId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.dungeon_id, e.result_json
         FROM expeditions e
         JOIN expedition_heroes eh ON eh.expedition_id = e.id
         JOIN heroes h ON h.id = eh.hero_id
        WHERE h.user_id = ? AND e.status = 'completed' AND e.result_json IS NOT NULL`,
    )
    .all(userId) as unknown as Array<{ dungeon_id: string; result_json: string }>;
  const unlocked: Record<string, number> = {};
  for (const row of rows) {
    const dungeon = content.dungeons.find((entry) => entry.id === row.dungeon_id);
    if (!dungeon?.seriesId || dungeon.depth === undefined) continue;
    let result: ExpeditionEngineResult;
    try {
      result = JSON.parse(row.result_json) as ExpeditionEngineResult;
    } catch {
      continue;
    }
    if (!result.routeCleared) continue;
    unlocked[dungeon.seriesId] = Math.max(
      unlocked[dungeon.seriesId] ?? 0,
      Math.min(4, dungeon.depth + 1),
    );
  }
  return unlocked;
}

/** 深层准入：必须已打通同系列上一层 boss。 */
export function assertDungeonUnlocked(userId: string, dungeon: Dungeon): void {
  if (!dungeon.seriesId || !dungeon.depth || dungeon.depth <= 0) return;
  const unlocked = listDungeonUnlocks(userId)[dungeon.seriesId] ?? 0;
  if (dungeon.depth > unlocked) {
    throw badRequest(
      `${dungeon.name} 尚未解锁：需要先击败同系列更深一层的 boss`,
      "dungeon_locked",
    );
  }
}

/** 进阶副本的统一准入等级。 */
export function assertPartyMeetsRequiredLevel(
  heroes: Array<{ level: number }>,
  dungeon: Dungeon,
): void {
  if (!dungeon.requiredLevel || heroes.length === 0) return;
  const averageLevel = Math.floor(
    heroes.reduce((sum, hero) => sum + hero.level, 0) / heroes.length,
  );
  if (averageLevel < dungeon.requiredLevel) {
    throw badRequest(
      `${dungeon.name} 需要队伍平均等级 ${dungeon.requiredLevel}，当前为 ${averageLevel}`,
      "level_requirement",
    );
  }
}

/** 玩家记住的迷宫路径（dungeonId → 房间 id 列表）。 */
export function listDungeonRoutePreferences(userId: string): Record<string, string[]> {
  const rows = db
    .prepare("SELECT dungeon_id, route_id FROM dungeon_route_preferences WHERE user_id = ?")
    .all(userId) as unknown as Array<{ dungeon_id: string; route_id: string }>;
  const preferences: Record<string, string[]> = {};
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.route_id) as unknown;
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
        preferences[row.dungeon_id] = parsed as string[];
      }
    } catch {
      // 旧线路偏好忽略。
    }
  }
  return preferences;
}

/** 解析本次远征的路径：显式传入 > 记忆路径 > 最短通路；非法路径直接拒绝。 */
export function resolvePathForUser(
  userId: string,
  dungeon: Dungeon,
  roomPath?: string[],
): string[] {
  const candidates: string[][] = [];
  if (roomPath && roomPath.length > 0) candidates.push(roomPath);
  const remembered = listDungeonRoutePreferences(userId)[dungeon.id];
  if (remembered) candidates.push(remembered);
  candidates.push(defaultRoomPath(dungeon));
  for (const candidate of candidates) {
    try {
      resolveRoomPath(dungeon, candidate);
      return candidate;
    } catch {
      // 尝试下一个候选；显式传入的非法路径最终会被下面的默认路径掩盖，所以显式路径单独校验。
      if (candidate === roomPath) {
        throw badRequest("路线不合法：必须从入口出发、沿相邻房间前进且不重复");
      }
    }
  }
  return defaultRoomPath(dungeon);
}

export function rememberDungeonPath(
  userId: string,
  dungeonId: string,
  roomPath: string[],
): void {
  db.prepare(
    `INSERT INTO dungeon_route_preferences (user_id, dungeon_id, route_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, dungeon_id)
     DO UPDATE SET route_id = excluded.route_id, updated_at = excluded.updated_at`,
  ).run(userId, dungeonId, JSON.stringify(roomPath), Date.now());
}

/** 校验路径上各房间怪物等级是否在队伍平均等级 +5 级以内。 */
export function assertPartyMeetsPath(
  heroes: HeroRunSpec[],
  rooms: DungeonRoom[],
): void {
  const averageLevel = Math.floor(
    heroes.reduce((sum, hero) => sum + hero.level, 0) / heroes.length,
  );
  rooms.forEach((room, index) => {
    if (room.monsters.length === 0) return;
    const monsterLevel = roomMonsterLevel(content, room);
    if (!canChallengeMonsterLevel(averageLevel, monsterLevel)) {
      throw badRequest(
        `第 ${index + 1} 站【${room.name}】怪物等级为 ${monsterLevel}，队伍平均等级为 ${averageLevel}；最多可挑战高于自身等级 ${DUNGEON_LEVEL_TOLERANCE} 级的迷宫`,
        "level_requirement",
      );
    }
  });
}

/** 返回匹配迷宫标签的亲和福利集合（用于时长等迷宫外围效果）。 */
export function partyAffinityPerks(
  heroes: Array<{ raceId: string }>,
  dungeon: Dungeon,
): Set<string> {
  const perks = new Set<string>();
  for (const hero of heroes) {
    const race = content.races.find((row) => row.id === hero.raceId);
    if (!race) continue;
    const perk = affinityPerkFor(race, dungeon.tags);
    if (perk) perks.add(perk);
  }
  return perks;
}

/** 路径总时长（秒）：入口不计时，其余房间按各自时长累加。 */
export function pathDurationSeconds(dungeon: Dungeon, roomPath: string[]): number {
  return roomPath.reduce((sum, roomId, index) => {
    if (index === 0) return sum;
    const room = dungeon.rooms.find((row) => row.id === roomId);
    return sum + (room?.durationSeconds ?? dungeon.roomSeconds);
  }, 0);
}

/** 解析个人迷宫区域 id（pm-<seriesId>-d<depth>）到该玩家的区域快照；首次派遣自动初始化第 0 区。 */
function personalMazeDungeon(
  userId: string,
  dungeonId: string,
): { dungeon: Dungeon; seriesId: string; depth: number; generatorVersion: number } | null {
  const match = /^pm-(.+)-d(\d+)$/.exec(dungeonId);
  if (!match) return null;
  const seriesId = match[1] ?? "";
  const depth = Number(match[2] ?? -1);
  if (!seriesId || !Number.isInteger(depth) || depth < 0) return null;
  const region = getOrInitRegion(userId, seriesId, depth);
  if (!region) throw notFound("个人迷宫区域不存在");
  return {
    dungeon: region.dungeon,
    seriesId,
    depth,
    generatorVersion: region.generatorVersion,
  };
}

export function startExpedition(userId: string, input: DispatchInput) {
  assertDeathRosterResolved(userId);
  const personal = personalMazeDungeon(userId, input.dungeonId);
  // 迷宫全部是个人区域：固定内容迷宫只作为生成模板，不再可直接派遣。
  if (!personal) throw notFound("迷宫不存在或不是个人迷宫区域");
  const dungeon = personal.dungeon;

  const heroes: HeroRow[] = input.heroIds.map((id) => getHeroRow(userId, id));
  if (heroes.length === 0) throw badRequest("至少需要派出一名英雄");
  assertPartyMeetsRequiredLevel(
    heroes.map((hero) => ({ level: levelFromEp(hero.ep_earned) })),
    dungeon,
  );

  const npcIds = [...new Set(input.npcIds ?? [])];
  if (npcIds.length !== (input.npcIds ?? []).length) {
    throw badRequest("NPC 支援不能重复");
  }
  if (heroes.length + npcIds.length > 6) {
    throw badRequest("英雄与 NPC 支援总数不能超过 6 人");
  }
  for (const npcId of npcIds) {
    if (!dungeon.npcAssistIds.includes(npcId)) {
      throw badRequest(`${dungeon.name} 不支持这名 NPC 支援`);
    }
    if (!content.npcs.some((npc) => npc.id === npcId)) {
      throw badRequest("NPC 支援不存在");
    }
  }

  for (const hero of heroes) {
    const busy = db
      .prepare(
        `SELECT e.id
           FROM expedition_heroes eh
           JOIN expeditions e ON e.id = eh.expedition_id
          WHERE eh.hero_id = ? AND e.status = 'running'
          LIMIT 1`,
      )
      .get(hero.id) as unknown as { id: string } | undefined;
    if (busy) throw conflict(`${hero.name} 已经在另一支远征队中`);
    if (hero.died_at) {
      throw conflict(`${hero.name} 已永久死亡，无法远征`, "hero_dead");
    }
  }

  const settingsByHero = new Map<string, HeroCombatSettings>();
  const presets = new Map(
    heroes.map((hero) => [
      hero.id,
      resolvePresetForDungeon(userId, hero.id, dungeon.id, input.presetIds?.[hero.id]),
    ]),
  );
  for (const hero of heroes) {
    const preset = presets.get(hero.id);
    const inline = input.settingsByHero?.[hero.id];
    if (inline !== undefined) validateSettings(hero, inline);
    settingsByHero.set(hero.id, inline ?? preset?.settings ?? {});
  }
  const specs: HeroRunSpec[] = heroes.map((hero) => ({
    id: hero.id,
    name: hero.name,
    level: levelFromEp(hero.ep_earned),
    epEarned: hero.ep_earned,
    raceId: hero.race_id,
    weaponType: hero.weapon_type as WeaponType,
    skillLevels: parseJson<Record<string, number>>(hero.skills_json || "{}"),
    position:
      input.positions?.[hero.id] ?? presets.get(hero.id)?.position ?? "front",
    equipment: equipmentRefs(hero.id),
    settings: settingsByHero.get(hero.id),
  }));

  const perks = partyAffinityPerks(specs, dungeon);
  const effectiveDungeon = perks.has("swift") ? withExtraRoutes(dungeon) : dungeon;
  const roomPath = resolvePathForUser(userId, effectiveDungeon, input.roomPath);
  const rooms = resolveRoomPath(effectiveDungeon, roomPath);

  const seed = createSeed();
  assertPartyMeetsPath(specs, rooms);
  const result = simulateExpedition(content, {
    dungeonId: dungeon.id,
    dungeon: personal ? dungeon : undefined,
    roomPath,
    heroes: specs,
    npcIds,
    edges: effectiveDungeon.edges,
    seed,
  });

  const now = Date.now();
  const durationSeconds = pathDurationSeconds(effectiveDungeon, roomPath);
  const endAt = now + Math.max(1000, Math.round(durationSeconds * 1000 * TIME_SCALE));
  const expeditionId = randomUUID();

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const hero of heroes) {
      const busy = db
        .prepare(
          `SELECT e.id
             FROM expedition_heroes eh
             JOIN expeditions e ON e.id = eh.expedition_id
            WHERE eh.hero_id = ? AND e.status = 'running'
            LIMIT 1`,
        )
        .get(hero.id) as unknown as { id: string } | undefined;
      if (busy) throw conflict(`${hero.name} 已经在另一支远征队中`);
    }

    db.prepare(
      `INSERT INTO expeditions
         (id, user_id, dungeon_id, room_path_json, hero_ids_json, seed, status, start_at, end_at, created_at, result_json,
          maze_series_id, maze_depth, maze_generator_version, maze_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      expeditionId,
      userId,
      dungeon.id,
      JSON.stringify(roomPath),
      JSON.stringify(heroes.map((hero) => hero.id)),
      seed,
      now,
      endAt,
      now,
      JSON.stringify(result),
      personal ? personal.seriesId : null,
      personal ? personal.depth : null,
      personal ? personal.generatorVersion : null,
      personal ? JSON.stringify(dungeon) : null,
    );

    const link = db.prepare(
      "INSERT INTO expedition_heroes (expedition_id, hero_id) VALUES (?, ?)",
    );
    for (const hero of heroes) link.run(expeditionId, hero.id);

    rememberDungeonPath(userId, dungeon.id, roomPath);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (String((error as Error).message).includes("UNIQUE")) {
      throw conflict("队伍中有英雄刚刚加入了其他远征");
    }
    throw error;
  }

  return getExpedition(userId, expeditionId);
}

function accessibleExpeditionRow(userId: string, id: string): ExpeditionRow {
  const row = db.prepare("SELECT * FROM expeditions WHERE id = ?").get(id) as unknown as
    | ExpeditionRow
    | undefined;
  if (!row) throw notFound("远征记录不存在");
  if (row.user_id === userId) return row;

  if (row.group_id) {
    const member = db
      .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
      .get(row.group_id, userId);
    if (member) return row;
  }

  const participant = db
    .prepare(
      `SELECT 1 FROM expedition_heroes eh
         JOIN heroes h ON h.id = eh.hero_id
        WHERE eh.expedition_id = ? AND h.user_id = ?
        LIMIT 1`,
    )
    .get(id, userId);
  if (participant) return row;
  throw notFound("远征记录不存在");
}

export function getExpedition(userId: string, id: string) {
  return expeditionRowToView(accessibleExpeditionRow(userId, id));
}

export function listExpeditions(userId: string, limit = 20) {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.*
         FROM expeditions e
         LEFT JOIN group_members gm
           ON gm.group_id = e.group_id AND gm.user_id = ?
         LEFT JOIN expedition_heroes eh ON eh.expedition_id = e.id
         LEFT JOIN heroes h ON h.id = eh.hero_id AND h.user_id = ?
        WHERE e.user_id = ? OR gm.user_id IS NOT NULL OR h.user_id IS NOT NULL
        ORDER BY e.start_at DESC
        LIMIT ?`,
    )
    .all(
      userId,
      userId,
      userId,
      Math.min(Math.max(limit, 1), 50),
    ) as unknown as ExpeditionRow[];
  return rows.map((row) => expeditionRowToView(row));
}

export function unreadExpeditions(userId: string, limit = 20) {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.*
         FROM expeditions e
         LEFT JOIN group_members gm
           ON gm.group_id = e.group_id AND gm.user_id = ?
         LEFT JOIN expedition_heroes eh ON eh.expedition_id = e.id
         LEFT JOIN heroes h ON h.id = eh.hero_id AND h.user_id = ?
        WHERE e.status = 'completed'
          AND (e.user_id = ? OR gm.user_id IS NOT NULL OR h.user_id IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM expedition_reads r
             WHERE r.expedition_id = e.id AND r.user_id = ?
          )
        ORDER BY COALESCE(e.settled_at, e.end_at) DESC
        LIMIT ?`,
    )
    .all(
      userId,
      userId,
      userId,
      userId,
      Math.min(Math.max(limit, 1), 50),
    ) as unknown as ExpeditionRow[];
  return rows.map((row) => expeditionRowToView(row));
}

export function markExpeditionRead(userId: string, expeditionId: string): void {
  const row = accessibleExpeditionRow(userId, expeditionId);
  if (row.status !== "completed") return;
  db.prepare(
    `INSERT INTO expedition_reads (expedition_id, user_id, read_at)
     VALUES (?, ?, ?)
     ON CONFLICT(expedition_id, user_id)
     DO UPDATE SET read_at = excluded.read_at`,
  ).run(expeditionId, userId, Date.now());
}

export function activeExpeditions(userId: string) {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.*
         FROM expeditions e
         LEFT JOIN group_members gm
           ON gm.group_id = e.group_id AND gm.user_id = ?
         LEFT JOIN expedition_heroes eh ON eh.expedition_id = e.id
         LEFT JOIN heroes h ON h.id = eh.hero_id AND h.user_id = ?
        WHERE e.status = 'running'
          AND (e.user_id = ? OR gm.user_id IS NOT NULL OR h.user_id IS NOT NULL)
        ORDER BY e.end_at ASC`,
    )
    .all(userId, userId, userId) as unknown as ExpeditionRow[];
  return rows.map((row) => expeditionRowToView(row));
}
