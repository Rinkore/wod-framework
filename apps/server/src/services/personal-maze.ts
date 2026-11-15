import { createSeed, generatePersonalMazeRegion } from "@wod/engine";
import type { PersonalMazeRegionView } from "@wod/shared";
import { db } from "../db.js";
import { badRequest, notFound } from "../errors.js";
import { content } from "../content.js";

interface RegionRow {
  user_id: string;
  series_id: string;
  depth: number;
  seed: number;
  generator_version: number;
  source_dungeon_id: string;
  status: "frontier" | "cleared";
  explored_rooms_json: string;
  dungeon_snapshot_json: string;
}

function seriesTemplates(seriesId: string) {
  return content.dungeons
    .filter((dungeon) => dungeon.seriesId === seriesId)
    .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
}

function baseTemplates() {
  return content.dungeons.filter((dungeon) => dungeon.seriesId && dungeon.depth === 0);
}

function templateForDepth(seriesId: string, depth: number) {
  const rows = seriesTemplates(seriesId);
  if (rows.length === 0) return undefined;
  const maxDepth = rows[rows.length - 1]!.depth ?? 0;
  const target = Math.min(depth, maxDepth);
  return rows.find((dungeon) => (dungeon.depth ?? 0) === target);
}

function createRegion(userId: string, seriesId: string, depth: number, now = Date.now()): void {
  const template = templateForDepth(seriesId, depth);
  if (!template) throw notFound("迷宫系列不存在");
  const seed = createSeed();
  const region = generatePersonalMazeRegion(template, userId, depth, seed);
  db.prepare(
    `INSERT INTO personal_maze_regions
       (user_id, series_id, depth, seed, generator_version, source_dungeon_id,
        status, explored_rooms_json, dungeon_snapshot_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'frontier', '[]', ?, ?)
     ON CONFLICT(user_id, series_id, depth) DO NOTHING`,
  ).run(
    userId,
    seriesId,
    depth,
    region.seed,
    region.generatorVersion,
    region.sourceDungeonId,
    JSON.stringify(region.dungeon),
    now,
  );
}

function mapRegion(row: RegionRow): PersonalMazeRegionView {
  return {
    seriesId: row.series_id,
    depth: row.depth,
    seed: row.seed,
    generatorVersion: row.generator_version,
    sourceDungeonId: row.source_dungeon_id,
    status: row.status,
    exploredRoomIds: JSON.parse(row.explored_rooms_json) as string[],
    dungeon: JSON.parse(row.dungeon_snapshot_json) as PersonalMazeRegionView["dungeon"],
  };
}

/** Lazily initialize each personal maze from its balanced depth-zero template. */
export function listPersonalMazeRegions(userId: string): PersonalMazeRegionView[] {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const template of baseTemplates()) createRegion(userId, template.seriesId!, 0, now);
    const rows = db
      .prepare(
        `SELECT * FROM personal_maze_regions
          WHERE user_id = ? ORDER BY series_id ASC, depth ASC`,
      )
      .all(userId) as unknown as RegionRow[];
    db.exec("COMMIT");
    return rows.map(mapRegion);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 惰性初始化后返回指定区域；派遣与组队首次进入时自动生成第 0 区。 */
export function getOrInitRegion(
  userId: string,
  seriesId: string,
  depth: number,
): PersonalMazeRegionView | null {
  listPersonalMazeRegions(userId);
  const row = db
    .prepare(
      `SELECT * FROM personal_maze_regions
        WHERE user_id = ? AND series_id = ? AND depth = ?`,
    )
    .get(userId, seriesId, depth) as unknown as RegionRow | undefined;
  return row ? mapRegion(row) : null;
}

/** Generate the next region only after the current frontier has been cleared. */
export function expandPersonalMaze(userId: string, seriesId: string): PersonalMazeRegionView {
  if (seriesTemplates(seriesId).length === 0) {
    throw notFound("迷宫系列不存在");
  }
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `SELECT * FROM personal_maze_regions
          WHERE user_id = ? AND series_id = ? ORDER BY depth DESC LIMIT 1`,
      )
      .get(userId, seriesId) as unknown as RegionRow | undefined;
    if (!row) {
      createRegion(userId, seriesId, 0, now);
      const initial = db
        .prepare(
          "SELECT * FROM personal_maze_regions WHERE user_id = ? AND series_id = ? AND depth = 0",
        )
        .get(userId, seriesId) as unknown as RegionRow;
      db.exec("COMMIT");
      return mapRegion(initial);
    }
    if (row.status !== "cleared") {
      throw badRequest("必须先清理当前区域，才能继续拓展迷宫", "maze_frontier_not_cleared");
    }
    const nextDepth = row.depth + 1;
    createRegion(userId, seriesId, nextDepth, now);
    const next = db
      .prepare(
        "SELECT * FROM personal_maze_regions WHERE user_id = ? AND series_id = ? AND depth = ?",
      )
      .get(userId, seriesId, nextDepth) as unknown as RegionRow;
    db.exec("COMMIT");
    return mapRegion(next);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Save visited rooms against the persisted map snapshot; duplicate visits are idempotent. */
export function recordPersonalMazeExploration(
  userId: string,
  seriesId: string,
  depth: number,
  roomIds: string[],
): void {
  const row = db
    .prepare(
      `SELECT explored_rooms_json, dungeon_snapshot_json
         FROM personal_maze_regions
        WHERE user_id = ? AND series_id = ? AND depth = ?`,
    )
    .get(userId, seriesId, depth) as unknown as
    | { explored_rooms_json: string; dungeon_snapshot_json: string }
    | undefined;
  if (!row) throw notFound("个人迷宫区域不存在");
  const dungeon = JSON.parse(row.dungeon_snapshot_json) as PersonalMazeRegionView["dungeon"];
  const valid = new Set(dungeon.rooms.map((room) => room.id));
  if (roomIds.some((roomId) => !valid.has(roomId))) {
    throw badRequest("探索记录包含不属于该区域的房间");
  }
  const explored = new Set(JSON.parse(row.explored_rooms_json) as string[]);
  for (const roomId of roomIds) explored.add(roomId);
  db.prepare(
    `UPDATE personal_maze_regions SET explored_rooms_json = ?
      WHERE user_id = ? AND series_id = ? AND depth = ?`,
  ).run(JSON.stringify([...explored]), userId, seriesId, depth);
}

/** Persist a full-clear checkpoint; safe to call more than once after settlement retries.
 * 调用方负责事务（远征结算已在事务内），本函数自身不再开事务。 */
export function markPersonalMazeRegionCleared(
  userId: string,
  seriesId: string,
  depth: number,
  now = Date.now(),
): void {
  const updated = db
    .prepare(
      `UPDATE personal_maze_regions
          SET status = 'cleared', cleared_at = COALESCE(cleared_at, ?)
        WHERE user_id = ? AND series_id = ? AND depth = ?`,
    )
    .run(now, userId, seriesId, depth);
  if (updated.changes !== 1) throw notFound("个人迷宫区域不存在");
  db.prepare(
    `INSERT INTO personal_maze_progress (user_id, series_id, highest_cleared_depth, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, series_id) DO UPDATE SET
       highest_cleared_depth = MAX(highest_cleared_depth, excluded.highest_cleared_depth),
       updated_at = excluded.updated_at`,
  ).run(userId, seriesId, depth, now);
}
