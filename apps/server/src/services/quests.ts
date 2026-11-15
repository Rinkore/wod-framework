import { levelFromEp } from "@wod/engine";
import type {
  HeroTitleView,
  HeroTitlesView,
  QuestStatus,
  QuestView,
} from "@wod/shared";
import { content } from "../content.js";
import { db } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { HeroRow, QuestProgressRow, UserRow } from "../types.js";
import { authUserView, heroRowToView } from "../views.js";
import { getHeroRow } from "./heroes.js";

function progressRow(userId: string, questId: string): QuestProgressRow | undefined {
  return db
    .prepare("SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ?")
    .get(userId, questId) as unknown as QuestProgressRow | undefined;
}

function parseProgress(raw: string): number[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? value.map((entry) => Math.max(0, Number(entry) || 0))
      : [];
  } catch {
    return [];
  }
}

function prerequisitesClaimed(
  userId: string,
  quest: (typeof content.quests)[number],
): boolean {
  return quest.prerequisiteQuestIds.every(
    (id) => progressRow(userId, id)?.status === "claimed",
  );
}

function statusFor(
  userId: string,
  quest: (typeof content.quests)[number],
): QuestStatus {
  const row = progressRow(userId, quest.id);
  if (row) return row.status;
  return prerequisitesClaimed(userId, quest) ? "active" : "locked";
}

export function listQuests(userId: string): QuestView[] {
  return content.quests.map((quest) => {
    const row = progressRow(userId, quest.id);
    const progress = row ? parseProgress(row.progress_json) : [];
    return {
      id: quest.id,
      name: quest.name,
      description: quest.description,
      category: quest.category,
      objectives: quest.objectives.map((objective, index) => ({
        ...objective,
        current: progress[index] ?? 0,
      })),
      rewards: quest.rewards,
      prerequisiteQuestIds: quest.prerequisiteQuestIds,
      status: statusFor(userId, quest),
      completedAt: row?.completed_at ?? null,
      claimedAt: row?.claimed_at ?? null,
    };
  });
}

type ProgressDelta = (
  objective: (typeof content.quests)[number]["objectives"][number],
) => number;

/**
 * 在现有事务内记录任务进度；不自行 BEGIN/COMMIT。
 * 只有已解锁（前置已领取）且未完成/未领取的任务会推进。
 */
function recordProgress(userId: string, deltaFor: ProgressDelta, now: number): void {
  for (const quest of content.quests) {
    const row = progressRow(userId, quest.id);
    if (row && (row.status === "completed" || row.status === "claimed")) continue;
    if (!row && !prerequisitesClaimed(userId, quest)) continue;

    const progress = row ? parseProgress(row.progress_json) : [];
    let changed = false;
    quest.objectives.forEach((objective, index) => {
      const delta = deltaFor(objective);
      if (delta <= 0) return;
      progress[index] = (progress[index] ?? 0) + delta;
      changed = true;
    });
    if (!changed) continue;

    const complete = quest.objectives.every(
      (objective, index) => (progress[index] ?? 0) >= objective.count,
    );
    const status: QuestStatus = complete ? "completed" : "active";
    if (row) {
      db.prepare(
        `UPDATE quest_progress
            SET status = ?, progress_json = ?, updated_at = ?, completed_at = ?
          WHERE user_id = ? AND quest_id = ?`,
      ).run(
        status,
        JSON.stringify(progress),
        now,
        complete ? row.completed_at ?? now : row.completed_at,
        userId,
        quest.id,
      );
    } else {
      db.prepare(
        `INSERT INTO quest_progress
           (user_id, quest_id, status, progress_json, started_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        quest.id,
        status,
        JSON.stringify(progress),
        now,
        now,
        complete ? now : null,
      );
    }
  }
}

export function recordExpeditionQuestProgress(
  userId: string,
  event: {
    dungeonId: string;
    victory: boolean;
    /** 是否打通整条线路；提前收队为 false。 */
    routeCleared: boolean;
    monstersSlain: number;
    fame: number;
  },
  now = Date.now(),
): void {
  // complete-dungeon 目标按迷宫系列匹配：个人区域 id（pm-<系列>-d<深度>）解析出系列后比较。
  const personalSeries = /^pm-(.+)-d\d+$/.exec(event.dungeonId)?.[1] ?? null;
  recordProgress(
    userId,
    (objective) => {
      switch (objective.type) {
        case "complete-dungeon":
          return event.routeCleared && objective.targetId != null
            ? (objective.targetId === event.dungeonId ||
                (personalSeries !== null && objective.targetId === personalSeries))
              ? 1
              : 0
            : 0;
        case "win-expedition":
          return event.victory ? 1 : 0;
        case "defeat-monsters":
          return event.monstersSlain;
        case "earn-fame":
          return event.fame;
        default:
          return 0;
      }
    },
    now,
  );
}

export function recordDuelQuestProgress(
  userId: string,
  event: { victory: boolean; fame: number },
  now = Date.now(),
): void {
  recordProgress(
    userId,
    (objective) => {
      if (objective.type === "win-duel") return event.victory ? 1 : 0;
      if (objective.type === "earn-fame") return event.fame;
      return 0;
    },
    now,
  );
}

function autoSelectTitle(heroId: string, now: number): void {
  const hero = db
    .prepare("SELECT active_title_id FROM heroes WHERE id = ?")
    .get(heroId) as unknown as { active_title_id: string | null } | undefined;
  if (!hero || hero.active_title_id) return;

  const unlocked = db
    .prepare("SELECT title_id FROM hero_titles WHERE hero_id = ?")
    .all(heroId) as unknown as Array<{ title_id: string }>;
  const order = new Map(content.titles.map((title, index) => [title.id, index]));
  const best = unlocked
    .map((row) => content.titles.find((title) => title.id === row.title_id))
    .filter((title): title is NonNullable<typeof title> => Boolean(title))
    .sort((a, b) => b.fameThreshold - a.fameThreshold || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))[0];
  if (best) {
    db.prepare("UPDATE heroes SET active_title_id = ? WHERE id = ?").run(best.id, heroId);
  }
}

/** 增加声望并解锁达到阈值的称号；不自行 BEGIN/COMMIT。 */
export function awardFame(heroId: string, amount: number, now = Date.now()): number {
  if (amount > 0) {
    db.prepare("UPDATE heroes SET fame = fame + ? WHERE id = ?").run(amount, heroId);
  }
  const hero = db
    .prepare("SELECT fame FROM heroes WHERE id = ?")
    .get(heroId) as unknown as { fame: number } | undefined;
  if (!hero) return 0;

  for (const title of content.titles) {
    if (title.fameThreshold <= 0 || title.fameThreshold >= 9999) continue;
    if (title.fameThreshold > hero.fame) continue;
    db.prepare(
      `INSERT OR IGNORE INTO hero_titles (hero_id, title_id, source, unlocked_at)
       VALUES (?, ?, 'fame', ?)`,
    ).run(heroId, title.id, now);
  }
  autoSelectTitle(heroId, now);
  return hero.fame;
}

/** 直接授予称号（任务奖励）；不自行 BEGIN/COMMIT。 */
export function unlockTitle(
  heroId: string,
  titleId: string,
  source: "fame" | "quest",
  now = Date.now(),
): void {
  const title = content.titles.find((row) => row.id === titleId);
  if (!title) throw badRequest("称号不存在");
  db.prepare(
    `INSERT OR IGNORE INTO hero_titles (hero_id, title_id, source, unlocked_at)
     VALUES (?, ?, ?, ?)`,
  ).run(heroId, titleId, source, now);
  autoSelectTitle(heroId, now);
}

export function heroTitlesView(userId: string, heroId: string): HeroTitlesView {
  const hero = getHeroRow(userId, heroId);
  const rows = db
    .prepare(
      "SELECT title_id, source, unlocked_at FROM hero_titles WHERE hero_id = ?",
    )
    .all(heroId) as unknown as Array<{
    title_id: string;
    source: "fame" | "quest";
    unlocked_at: number;
  }>;
  const titles: HeroTitleView[] = rows
    .flatMap((row) => {
      const title = content.titles.find((entry) => entry.id === row.title_id);
      if (!title) return [];
      return [{
        id: title.id,
        name: title.name,
        description: title.description,
        color: title.color,
        fameThreshold: title.fameThreshold,
        source: row.source,
        unlockedAt: row.unlocked_at,
      }];
    })
    .sort(
      (a, b) =>
        a.fameThreshold - b.fameThreshold || a.name.localeCompare(b.name),
    );
  return {
    fame: hero.fame,
    activeTitleId: hero.active_title_id,
    titles,
  };
}

export function setActiveTitle(
  userId: string,
  heroId: string,
  titleId: string | null,
) {
  getHeroRow(userId, heroId);
  if (titleId) {
    const owned = db
      .prepare("SELECT 1 FROM hero_titles WHERE hero_id = ? AND title_id = ?")
      .get(heroId, titleId);
    if (!owned) throw badRequest("这个称号尚未解锁");
  }
  db.prepare("UPDATE heroes SET active_title_id = ? WHERE id = ?").run(
    titleId,
    heroId,
  );
  return heroRowToView(getHeroRow(userId, heroId));
}

export function claimQuest(
  userId: string,
  questId: string,
  heroId?: string,
) {
  const quest = content.quests.find((row) => row.id === questId);
  if (!quest) throw notFound("任务不存在");
  const row = progressRow(userId, questId);
  if (!row || row.status !== "completed") {
    throw badRequest("任务尚未完成");
  }

  const hero = heroId
    ? getHeroRow(userId, heroId)
    : (db
        .prepare(
          `SELECT * FROM heroes WHERE user_id = ? AND died_at IS NULL
            ORDER BY ep_earned DESC, level DESC LIMIT 1`,
        )
        .get(userId) as unknown as HeroRow | undefined);
  if (!hero) throw badRequest("需要至少一名存活英雄领取奖励");
  if (hero.died_at) {
    throw badRequest(`${hero.name} 已永久死亡，无法领取任务奖励`, "hero_dead");
  }

  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const fresh = progressRow(userId, questId);
    if (fresh?.status !== "completed") {
      throw conflict("任务奖励已经领取");
    }
    const updated = db
      .prepare(
        `UPDATE quest_progress
            SET status = 'claimed', claimed_at = ?, updated_at = ?
          WHERE user_id = ? AND quest_id = ? AND status = 'completed'`,
      )
      .run(now, now, userId, questId);
    if (updated.changes !== 1) throw conflict("任务奖励已经领取");

    if (quest.rewards.gold > 0) {
      db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
        quest.rewards.gold,
        userId,
      );
    }
    if (quest.rewards.ep > 0) {
      const epEarned = hero.ep_earned + quest.rewards.ep;
      db.prepare(
        `UPDATE heroes
            SET xp = xp + ?, ep_earned = ?, level = ?
          WHERE id = ? AND user_id = ?`,
      ).run(quest.rewards.ep, epEarned, levelFromEp(epEarned), hero.id, userId);
    }
    if (quest.rewards.fame > 0) {
      awardFame(hero.id, quest.rewards.fame, now);
    }
    if (quest.rewards.titleId) {
      unlockTitle(hero.id, quest.rewards.titleId, "quest", now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
  return {
    quest: listQuests(userId).find((view) => view.id === questId),
    user: authUserView(user),
    hero: heroRowToView(getHeroRow(userId, hero.id)),
  };
}

/** 远征结算钩子：按参战英雄发声望，并按账号记录任务进度。 */
export function applyExpeditionQuestRewards(
  params: {
    dungeonId: string;
    victory: boolean;
    routeCleared: boolean;
    monstersSlain: number;
    famePerHero: number;
    heroIds: string[];
  },
  now = Date.now(),
): void {
  const fameByUser = new Map<string, number>();
  for (const heroId of params.heroIds) {
    const row = db
      .prepare("SELECT user_id, died_at FROM heroes WHERE id = ?")
      .get(heroId) as unknown as { user_id: string; died_at: number | null } | undefined;
    if (!row) continue;
    // 永久死亡的英雄冻结：不再获得声望或推进称号/任务。
    if (row.died_at) continue;
    awardFame(heroId, params.famePerHero, now);
    fameByUser.set(
      row.user_id,
      (fameByUser.get(row.user_id) ?? 0) + params.famePerHero,
    );
  }
  for (const [userId, fame] of fameByUser) {
    recordExpeditionQuestProgress(
      userId,
      {
        dungeonId: params.dungeonId,
        victory: params.victory,
        routeCleared: params.routeCleared,
        monstersSlain: params.monstersSlain,
        fame,
      },
      now,
    );
  }
}

/** 决斗钩子：给胜者发声望并记录双方任务进度。 */
export function applyDuelQuestRewards(
  params: {
    userId: string;
    heroId: string;
    victory: boolean;
    fame: number;
  },
  now = Date.now(),
): void {
  awardFame(params.heroId, params.fame, now);
  recordDuelQuestProgress(
    params.userId,
    { victory: params.victory, fame: params.fame },
    now,
  );
}
