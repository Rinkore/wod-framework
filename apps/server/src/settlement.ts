import type {
  Dungeon,
  ExpeditionEngineResult,
  ExpeditionResultView,
  GroupShare,
  ItemRoll,
  ItemView,
} from "@wod/shared";

import { db } from "./db.js";
import type { ExpeditionRow, HeroRow } from "./types.js";
import { parseJson } from "./views.js";
import { content } from "./content.js";
import { roomMonsterLevel } from "@wod/engine";
import { addInventoryItem } from "./services/inventory.js";
import { killHero } from "./services/death.js";
import { dropLotteryTickets } from "./services/lottery.js";
import { applyExpeditionQuestRewards } from "./services/quests.js";
import {
  markPersonalMazeRegionCleared,
  recordPersonalMazeExploration,
} from "./services/personal-maze.js";

function insertItem(
  userId: string,
  roll: ItemRoll,
  now: number,
  ownerName?: string,
): ItemView {
  const view = addInventoryItem(userId, roll, now);
  return ownerName ? { ...view, ownerUserId: userId, ownerName } : view;
}

function groupParticipants(expeditionId: string): Array<{ user_id: string; username: string }> {
  return db
    .prepare(
      `SELECT DISTINCT h.user_id, u.username
         FROM expedition_heroes eh
         JOIN heroes h ON h.id = eh.hero_id
         JOIN users u ON u.id = h.user_id
        WHERE eh.expedition_id = ?
        ORDER BY h.user_id ASC`,
    )
    .all(expeditionId) as unknown as Array<{ user_id: string; username: string }>;
}

/** 同日重复派遣的金币衰减：全通轻微衰减，撤离衰减更重。 */
export const REPEAT_DECAY = {
  /** 当日同一迷宫第 N 次结算开始衰减（0 基：首次不衰减）。 */
  freeRepeats: 0,
  /** 全通每次衰减比例。 */
  victoryFactor: 0.9,
  /** 撤离每次衰减比例。 */
  evacuatedFactor: 0.7,
  /** 衰减下限（系数乘到这么低为止）。 */
  minFactor: 0.4,
} as const;

function dayStartOf(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 当日该账号在该迷宫已结算的远征数（不含本次）。 */
function repeatCountToday(userId: string, dungeonId: string, now: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM expeditions
        WHERE user_id = ? AND dungeon_id = ? AND status = 'completed'
          AND settled_at >= ? AND settled_at <= ?`,
    )
    .get(userId, dungeonId, dayStartOf(now), now) as unknown as { count: number };
  return row.count;
}

/** 重复衰减系数：第 N 次结算按 factor^N 递减，最低 minFactor。 */
function repeatFactor(outcome: ExpeditionEngineResult["outcome"], repeats: number): number {
  const factor =
    outcome === "victory"
      ? REPEAT_DECAY.victoryFactor
      : outcome === "evacuated"
        ? REPEAT_DECAY.evacuatedFactor
        : 1;
  const steps = Math.max(0, repeats - REPEAT_DECAY.freeRepeats);
  return Math.max(REPEAT_DECAY.minFactor, Math.pow(factor, steps));
}

function settleExpedition(row: ExpeditionRow, now: number): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const fresh = db
      .prepare("SELECT * FROM expeditions WHERE id = ? AND status = 'running'")
      .get(row.id) as unknown as ExpeditionRow | undefined;
    if (!fresh || !fresh.result_json) {
      db.exec("ROLLBACK");
      return false;
    }

    const engine = parseJson<ExpeditionEngineResult>(fresh.result_json);
    const participants = fresh.group_id ? groupParticipants(fresh.id) : [];

    // 同日重复探索衰减：按每个参战账号在该迷宫当日的已结算次数计算。
    const repeatOwners =
      participants.length > 0
        ? participants.map((p) => p.user_id)
        : [fresh.user_id];
    const factorByOwner = new Map<string, number>();
    for (const owner of repeatOwners) {
      const repeats = repeatCountToday(owner, fresh.dungeon_id, now);
      factorByOwner.set(owner, repeatFactor(engine.outcome, repeats));
    }
    const decayedGold = Math.round(
      engine.rewards.gold *
        Math.min(...factorByOwner.values(), 1),
    );

    let itemViews: ItemView[];
    let groupShares: GroupShare[] | undefined;

    if (participants.length > 0) {
      const total = decayedGold;
      const base = Math.floor(total / participants.length);
      const remainder = total - base * participants.length;
      groupShares = participants.map((participant, index) => ({
        userId: participant.user_id,
        username: participant.username,
        gold: base + (index === 0 ? remainder : 0),
        itemCount: 0,
      }));

      itemViews = engine.rewards.items.map((item, index) => {
        const participant = participants[index % participants.length]!;
        const share = groupShares?.find((row) => row.userId === participant.user_id);
        if (share) share.itemCount += 1;
        return insertItem(participant.user_id, item, now, participant.username);
      });

      for (const share of groupShares) {
        db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
          share.gold,
          share.userId,
        );
      }
    } else {
      itemViews = engine.rewards.items.map((item) => insertItem(fresh.user_id, item, now));
      db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
        decayedGold,
        fresh.user_id,
      );
    }

    const result: ExpeditionResultView = {
      ...engine,
      rewards: { ...engine.rewards, gold: decayedGold, items: itemViews },
      ...(groupShares ? { groupShares } : {}),
    };

    // 永久死亡：只有战败会夺走角色；胜利/成功撤离时全员生还。
    const fatal = engine.outcome === "defeat";
    for (const hero of engine.perHero) {
      const fresh = db
        .prepare("SELECT * FROM heroes WHERE id = ?")
        .get(hero.heroId) as unknown as HeroRow | undefined;
      if (!fresh) continue;
      if (fatal && hero.downed) {
        killHero(fresh, now);
        continue;
      }
      db.prepare(
        `UPDATE heroes
            SET level = ?, xp = xp + ?, ep_earned = ?
          WHERE id = ?`,
      ).run(hero.toLevel, hero.epGained, hero.epEarnedAfter, hero.heroId);
    }
    if (fatal) {
      // 死亡角色自动移出所有组队 staged。
      db.prepare(
        "DELETE FROM group_heroes WHERE hero_id IN (SELECT id FROM heroes WHERE died_at IS NOT NULL)",
      ).run();
    }

    const updated = db
      .prepare(
        "UPDATE expeditions SET status = 'completed', settled_at = ?, result_json = ? WHERE id = ? AND status = 'running'",
      )
      .run(now, JSON.stringify(result), fresh.id);
    if (updated.changes === 0) {
      db.exec("ROLLBACK");
      return false;
    }

    // 彩票掉落：按路径最高怪物等级判定概率与位数；成功撤离同样有掉落。
    // 个人区域（pm-*）按快照房间计算怪物等级。
    if (engine.outcome === "victory" || engine.outcome === "evacuated") {
      const personalMaze = fresh.maze_series_id !== null && fresh.maze_snapshot_json
        ? (JSON.parse(fresh.maze_snapshot_json) as Dungeon)
        : null;
      const dungeon =
        personalMaze ?? content.dungeons.find((d) => d.id === fresh.dungeon_id);
      const roomIds = parseJson<string[]>(fresh.room_path_json ?? "[]");
      let maxLevel = 0;
      const visitedIds = roomIds.filter((id) => dungeon?.rooms.find((r) => r.id === id)?.kind !== "start")
        .slice(0, engine.summary.floorsCleared ?? engine.encounters.filter((e) => e.victory).length);
      for (const roomId of visitedIds) {
        const room = dungeon?.rooms.find((r) => r.id === roomId);
        if (room) maxLevel = Math.max(maxLevel, roomMonsterLevel(content, room));
      }
      for (const participant of participants.length > 0
        ? participants.map((p) => p.user_id)
        : [fresh.user_id]) {
        const dropped = visitedIds.length > 0 ? dropLotteryTickets(participant, maxLevel, now) : null;
        if (dropped) (result.lotteryDrops ??= []).push({ userId: participant, ticketId: dropped.ticketId });
      }
    }

    // 个人迷宫进度：成功/撤离记录探索房间；全通标记清理（幂等，不重复发奖）。
    // 区域属于派遣者（组队时即队长），探索与清理只记给队长。
    if (fresh.maze_series_id) {
      const owner = fresh.user_id;
      const roomIds = parseJson<string[]>(fresh.room_path_json ?? "[]");
      recordPersonalMazeExploration(owner, fresh.maze_series_id, fresh.maze_depth ?? 0, roomIds);
      if (engine.routeCleared) {
        markPersonalMazeRegionCleared(owner, fresh.maze_series_id, fresh.maze_depth ?? 0, now);
      }
    }

    db.prepare("UPDATE expeditions SET result_json = ? WHERE id = ?").run(JSON.stringify(result), fresh.id);

    applyExpeditionQuestRewards(
      {
        dungeonId: fresh.dungeon_id,
        victory: engine.outcome === "victory",
        routeCleared: engine.routeCleared ?? engine.outcome === "victory",
        monstersSlain: engine.summary.monstersSlain,
        famePerHero: engine.rewards.fame ?? 0,
        heroIds: engine.perHero.map((hero) => hero.heroId),
      },
      now,
    );

    if (fresh.group_id) {
      // 队伍保留：回到待命状态，队长可直接通知下一场迷宫；清空通知与响应状态
      db.prepare(
        `UPDATE groups
            SET status = 'recruiting',
                dungeon_id = NULL,
                expedition_id = NULL,
                queue_dungeon_id = NULL,
                queue_route_id = NULL,
                queue_depth = NULL,
                queue_created_at = NULL
          WHERE id = ? AND status = 'running'`,
      ).run(fresh.group_id);
      db.prepare(
        "UPDATE group_members SET ready_state = 0 WHERE group_id = ?",
      ).run(fresh.group_id);
    }

    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function settleDueForUser(userId: string): number {
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT * FROM expeditions
        WHERE status = 'running' AND end_at <= ?
          AND (user_id = ? OR group_id IN (
            SELECT group_id FROM group_members WHERE user_id = ?
          ))`,
    )
    .all(now, userId, userId) as unknown as ExpeditionRow[];
  let settled = 0;
  for (const row of rows) {
    if (settleExpedition(row, now)) settled += 1;
  }
  return settled;
}

export function settleAllDue(): number {
  const now = Date.now();
  const rows = db
    .prepare("SELECT * FROM expeditions WHERE status = 'running' AND end_at <= ?")
    .all(now) as unknown as ExpeditionRow[];
  let settled = 0;
  for (const row of rows) {
    if (settleExpedition(row, now)) settled += 1;
  }
  return settled;
}
