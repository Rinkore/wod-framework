import { randomInt, randomUUID } from "node:crypto";
import type { Dungeon } from "@wod/shared";
import {
  computeHeroPower,
  createSeed,
  levelFromEp,
  resolveRoomPath,
  simulateExpedition,
  type HeroRunSpec,
} from "@wod/engine";
import {
  isDungeonOpen,
  weaponPath,
  type GroupHeroView,
  type GroupMemberView,
  type GroupSummary,
  type GroupView,
  type GroupVisibility,
  type HeroCombatSettings,
  type Position,
  type GroupQueueView,
  type WeaponType,
  withExtraRoutes,
} from "@wod/shared";
import { content } from "../content.js";
import { TIME_SCALE } from "../config.js";
import { db } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import type { ExpeditionRow, HeroRow, UserRow } from "../types.js";
import { equipmentRefs, expeditionRowToView, parseJson } from "../views.js";
import { busyExpeditionId } from "../views.js";
import { resolvePresetForDungeon, parseSettings, validateSettings } from "./presets.js";
import { getOrInitRegion } from "./personal-maze.js";
import { areFriends } from "./friends.js";
import { currentClanRow } from "./clans.js";
import {
  assertDungeonUnlocked,
  assertPartyMeetsPath,
  assertPartyMeetsRequiredLevel,
  listDungeonUnlocks,
  partyAffinityPerks,
  pathDurationSeconds,
  rememberDungeonPath,
  resolvePathForUser,
} from "./expeditions.js";

export const GROUP_CAPACITY = 4;
/** 队伍成员（账号）数量上限；防止公开队伍被大量零英雄账号灌入。 */
export const MAX_GROUP_MEMBERS = 10;

interface GroupRow {
  id: string;
  name: string;
  join_code: string;
  leader_user_id: string;
  status: "recruiting" | "running" | "completed";
  visibility: GroupVisibility;
  dungeon_id: string | null;
  expedition_id: string | null;
  created_at: number;
  queue_dungeon_id: string | null;
  queue_route_id: string | null;
  queue_depth: number | null;
  queue_created_at: number | null;
  queue_room_path_json: string | null;
}

function getUserRow(userId: string): UserRow {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as
    | UserRow
    | undefined;
  if (!row) throw notFound("账号不存在");
  return row;
}

function getGroupRow(groupId: string): GroupRow {
  const row = db.prepare("SELECT * FROM groups WHERE id = ?").get(groupId) as unknown as
    | GroupRow
    | undefined;
  if (!row) throw notFound("队伍不存在");
  return row;
}

export function currentGroupRow(userId: string): GroupRow | null {
  const row = db
    .prepare(
      `SELECT g.* FROM groups g
         JOIN group_members m ON m.group_id = g.id
        WHERE m.user_id = ?
        LIMIT 1`,
    )
    .get(userId) as unknown as GroupRow | undefined;
  return row ?? null;
}

function requireMember(userId: string, groupId: string): GroupRow {
  const group = getGroupRow(groupId);
  const member = db
    .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, userId);
  if (!member) throw forbidden("你不在这个队伍中");
  return group;
}

function requireLeader(userId: string, group: GroupRow): void {
  if (group.leader_user_id !== userId) throw forbidden("只有队长可以执行此操作");
}

function sameClan(a: string, b: string): boolean {
  const clan = currentClanRow(a);
  return Boolean(clan && currentClanRow(b)?.id === clan.id);
}

function canJoinVisibleGroup(
  userId: string,
  visibility: GroupVisibility,
  leaderUserId: string,
): boolean {
  switch (visibility) {
    case "public":
      return true;
    case "invite":
      return false;
    case "friends":
      return areFriends(userId, leaderUserId);
    case "guild":
      return sameClan(userId, leaderUserId);
    case "guild-friends":
      return areFriends(userId, leaderUserId) || sameClan(userId, leaderUserId);
  }
}

function joinDeniedMessage(visibility: GroupVisibility): string {
  switch (visibility) {
    case "invite":
      return "这个队伍仅限邀请，请使用邀请码加入";
    case "friends":
      return "这个队伍仅限队长的好友加入";
    case "guild":
      return "这个队伍仅限队长同公会的成员加入";
    case "guild-friends":
      return "这个队伍仅限队长的好友或同公会成员加入";
    default:
      return "你无法加入这个队伍";
  }
}

function makeJoinCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) code += alphabet[randomInt(0, alphabet.length)];
    const exists = db.prepare("SELECT 1 FROM groups WHERE join_code = ?").get(code);
    if (!exists) return code;
  }
  throw new Error("无法生成唯一的队伍邀请码");
}

export function groupView(groupId: string): GroupView {
  const group = getGroupRow(groupId);
  const memberRows = db
    .prepare(
      `SELECT m.user_id, m.role, m.joined_at, m.ready_state, u.username,
              (SELECT COUNT(*) FROM group_heroes gh
                WHERE gh.group_id = m.group_id AND gh.user_id = m.user_id) AS hero_count
         FROM group_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.group_id = ?
        ORDER BY CASE m.role WHEN 'leader' THEN 0 ELSE 1 END, m.joined_at ASC`,
    )
    .all(groupId) as unknown as Array<{
    user_id: string;
    role: "leader" | "member";
    username: string;
    hero_count: number;
    ready_state: 0 | 1 | 2;
  }>;

  const nowMs = Date.now();
  const members: GroupMemberView[] = memberRows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    role: row.role,
    heroCount: row.hero_count,
    readyState: row.ready_state,
    deadHeroes: [],
  }));

  const heroRows = db
    .prepare(
      `SELECT gh.hero_id, gh.user_id, gh.position, gh.preset_id, gh.settings_json,
              h.name AS hero_name, h.race_id, h.weapon_type,
              h.level, h.ep_earned, h.died_at, u.username
         FROM group_heroes gh
         JOIN heroes h ON h.id = gh.hero_id
         JOIN users u ON u.id = gh.user_id
        WHERE gh.group_id = ?
        ORDER BY gh.rowid ASC`,
    )
    .all(groupId) as unknown as Array<{
    hero_id: string;
    user_id: string;
    position: Position;
    preset_id: string | null;
    settings_json: string;
    hero_name: string;
    race_id: string;
    weapon_type: string;
    level: number;
    ep_earned: number;
    died_at: number | null;
    username: string;
  }>;

  const heroes: GroupHeroView[] = heroRows.map((row) => {
    const path = weaponPath(content, row.weapon_type as WeaponType);
    const hero = db
      .prepare("SELECT * FROM heroes WHERE id = ?")
      .get(row.hero_id) as unknown as HeroRow;
    const level = levelFromEp(row.ep_earned);
    const power = computeHeroPower(content, {
      id: hero.id,
      name: hero.name,
      level,
      epEarned: hero.ep_earned,
      raceId: hero.race_id,
      weaponType: hero.weapon_type as WeaponType,
      skillLevels: parseJson<Record<string, number>>(hero.skills_json || "{}"),
      equipment: equipmentRefs(hero.id),
    });
    return {
      heroId: row.hero_id,
      heroName: row.hero_name,
      raceId: row.race_id,
      userId: row.user_id,
      playerName: row.username,
      weaponType: row.weapon_type as WeaponType,
      weaponName: path?.name ?? row.weapon_type,
      weaponColor: path?.color ?? "#c9a227",
      level,
      power,
      position: row.position,
      presetId: row.preset_id,
      settings: parseSettings(row.settings_json),
      diedAt: row.died_at ?? null,
    };
  });

  // 成员 staged 的死亡英雄
  for (const member of members) {
    member.deadHeroes = heroes
      .filter((hero) => hero.userId === member.userId && hero.diedAt)
      .map((hero) => hero.heroName);
  }

  const dungeon = group.dungeon_id
    ? content.dungeons.find((entry) => entry.id === group.dungeon_id)
    : null;

  let queue: GroupQueueView | null = null;
  if (group.queue_dungeon_id && group.queue_created_at) {
    const queueDungeon = content.dungeons.find(
      (entry) => entry.id === group.queue_dungeon_id,
    );
    let queuePath: string[] = [];
    if (group.queue_room_path_json) {
      try {
        queuePath = parseJson<string[]>(group.queue_room_path_json);
      } catch {
        queuePath = [];
      }
    }
    if (!queuePath.length && group.queue_route_id) {
      queuePath = [group.queue_route_id];
    }
    if (queueDungeon && queuePath.length > 0) {
      queue = {
        dungeonId: queueDungeon.id,
        dungeonName: queueDungeon.name,
        roomPath: queuePath,
        roomNames: queuePath.map(
          (roomId) => queueDungeon.rooms.find((room) => room.id === roomId)?.name ?? roomId,
        ),
        createdAt: group.queue_created_at,
      };
    }
  }

  return {
    id: group.id,
    name: group.name,
    joinCode: group.join_code,
    leaderUserId: group.leader_user_id,
    status: group.status,
    visibility: group.visibility,
    dungeonId: group.dungeon_id,
    dungeonName: dungeon?.name ?? null,
    expeditionId: group.expedition_id,
    members,
    heroes,
    createdAt: group.created_at,
    queue,
  };
}

export function getMyGroup(userId: string): GroupView | null {
  const group = currentGroupRow(userId);
  return group ? groupView(group.id) : null;
}

export function createGroup(
  userId: string,
  name: string,
  visibility: GroupVisibility = "public",
): GroupView {
  if (currentGroupRow(userId)) throw conflict("你已经在一个队伍中");
  const id = randomUUID();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO groups (id, name, join_code, leader_user_id, status, visibility, created_at) VALUES (?, ?, ?, ?, 'recruiting', ?, ?)",
    ).run(id, name, makeJoinCode(), userId, visibility, now);
    db.prepare(
      "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'leader', ?)",
    ).run(id, userId, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return groupView(id);
}

export function joinGroup(userId: string, code: string): GroupView {
  if (currentGroupRow(userId)) throw conflict("你已经在一个队伍中");
  const group = db
    .prepare("SELECT * FROM groups WHERE join_code = ?")
    .get(code.trim().toUpperCase()) as unknown as GroupRow | undefined;
  if (!group) throw notFound("邀请码无效");
  if (group.status !== "recruiting") throw conflict("这个队伍已经不在招募中");
  assertMemberCapacity(group.id);
  const now = Date.now();
  try {
    db.prepare(
      "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    ).run(group.id, userId, now);
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw conflict("你已经在队伍中");
    }
    throw error;
  }
  return groupView(group.id);
}

export function joinGroupById(userId: string, groupId: string): GroupView {
  if (currentGroupRow(userId)) throw conflict("你已经在一个队伍中");
  const group = getGroupRow(groupId);
  if (group.status !== "recruiting") throw conflict("这个队伍已经不在招募中");
  if (!canJoinVisibleGroup(userId, group.visibility, group.leader_user_id)) {
    throw forbidden(joinDeniedMessage(group.visibility));
  }
  assertMemberCapacity(group.id);
  const now = Date.now();
  try {
    db.prepare(
      "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    ).run(group.id, userId, now);
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw conflict("你已经在队伍中");
    }
    throw error;
  }
  return groupView(group.id);
}

/** 队伍成员数上限检查（队长自身计入）。 */
function assertMemberCapacity(groupId: string): void {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id = ?")
    .get(groupId) as unknown as { count: number };
  if (row.count >= MAX_GROUP_MEMBERS) {
    throw conflict(`队伍最多 ${MAX_GROUP_MEMBERS} 名成员`, "group_full");
  }
}

export function leaveGroup(userId: string): void {
  const group = currentGroupRow(userId);
  if (!group) throw notFound("你不在任何队伍中");
  if (group.status === "running") throw conflict("队伍正在远征，无法离开");

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM group_heroes WHERE group_id = ? AND user_id = ?").run(
      group.id,
      userId,
    );
    db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(
      group.id,
      userId,
    );

    if (group.leader_user_id === userId) {
      const next = db
        .prepare(
          "SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at ASC LIMIT 1",
        )
        .get(group.id) as unknown as { user_id: string } | undefined;
      if (next) {
        db.prepare("UPDATE groups SET leader_user_id = ? WHERE id = ?").run(
          next.user_id,
          group.id,
        );
        db.prepare(
          "UPDATE group_members SET role = 'leader' WHERE group_id = ? AND user_id = ?",
        ).run(group.id, next.user_id);
      } else {
        db.prepare("DELETE FROM chat_messages WHERE group_id = ?").run(group.id);
        db.prepare("DELETE FROM groups WHERE id = ?").run(group.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function addGroupHero(
  userId: string,
  groupId: string,
  heroId: string,
  position: Position,
): GroupView {
  const group = requireMember(userId, groupId);
  if (group.status !== "recruiting") throw conflict("队伍已经开始远征");
  const hero = db
    .prepare("SELECT * FROM heroes WHERE id = ? AND user_id = ?")
    .get(heroId, userId) as unknown as HeroRow | undefined;
  if (!hero) throw notFound("英雄不存在");
  if (busyExpeditionId(hero.id)) throw conflict(`${hero.name} 正在远征中`);
  if (hero.died_at) {
    throw conflict(`${hero.name} 已永久死亡`, "hero_dead");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    // 容量检查与插入在同一事务内，避免并发请求都读到旧计数而超限。
    const total = db
      .prepare("SELECT COUNT(*) AS count FROM group_heroes WHERE group_id = ?")
      .get(groupId) as unknown as { count: number };
    if (total.count >= GROUP_CAPACITY) throw conflict(`队伍最多 ${GROUP_CAPACITY} 名英雄`);
    try {
      db.prepare(
        "INSERT INTO group_heroes (group_id, hero_id, user_id, position) VALUES (?, ?, ?, ?)",
      ).run(groupId, heroId, userId, position);
    } catch (error) {
      if (String((error as Error).message).includes("UNIQUE")) {
        throw conflict("这个英雄已经在队伍中");
      }
      throw error;
    }
    // 英雄变化后旧的准备状态不再可靠：重置该成员准备状态。
    db.prepare(
      "UPDATE group_members SET ready_state = 0 WHERE group_id = ? AND user_id = ?",
    ).run(groupId, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return groupView(groupId);
}

export function removeGroupHero(userId: string, groupId: string, heroId: string): GroupView {
  const group = requireMember(userId, groupId);
  if (group.status !== "recruiting") throw conflict("队伍已经开始远征");
  const hero = db
    .prepare("SELECT * FROM group_heroes WHERE group_id = ? AND hero_id = ?")
    .get(groupId, heroId) as unknown as { user_id: string } | undefined;
  if (!hero) throw notFound("队伍中没有这个英雄");
  if (hero.user_id !== userId && group.leader_user_id !== userId) {
    throw forbidden("只能移除自己的英雄");
  }
  db.prepare("DELETE FROM group_heroes WHERE group_id = ? AND hero_id = ?").run(
    groupId,
    heroId,
  );
  // 英雄变化后旧的准备状态不再可靠：重置该成员准备状态。
  db.prepare(
    "UPDATE group_members SET ready_state = 0 WHERE group_id = ? AND user_id = ?",
  ).run(groupId, hero.user_id);
  return groupView(groupId);
}

/** 队长移除一名成员：连同其 staged 英雄一起移出队伍。 */
export function removeGroupMember(
  userId: string,
  groupId: string,
  targetUserId: string,
): GroupView {
  const group = requireMember(userId, groupId);
  requireLeader(userId, group);
  if (group.status !== "recruiting") throw conflict("队伍已经开始远征");
  if (targetUserId === group.leader_user_id) {
    throw badRequest("队长不能移除自己，请使用解散或退出");
  }
  const target = db
    .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, targetUserId);
  if (!target) throw notFound("这名玩家不在队伍中");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "DELETE FROM group_heroes WHERE group_id = ? AND user_id = ?",
    ).run(groupId, targetUserId);
    db.prepare(
      "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
    ).run(groupId, targetUserId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return groupView(groupId);
}

export function setGroupHeroPosition(
  userId: string,
  groupId: string,
  heroId: string,
  position: Position,
  presetId?: string | null,
): GroupView {
  const group = requireMember(userId, groupId);
  if (group.status !== "recruiting") throw conflict("队伍已经开始远征");
  const hero = db
    .prepare(
      "SELECT user_id, preset_id FROM group_heroes WHERE group_id = ? AND hero_id = ?",
    )
    .get(groupId, heroId) as unknown as
    | { user_id: string; preset_id: string | null }
    | undefined;
  if (!hero) throw notFound("队伍中没有这个英雄");
  if (hero.user_id !== userId && group.leader_user_id !== userId) {
    throw forbidden("只能调整自己的英雄");
  }
  if (presetId) {
    // 校验预设确实属于该英雄；队长可以替队员选择。
    resolvePresetForDungeon(hero.user_id, heroId, "", presetId);
  }
  db.prepare(
    "UPDATE group_heroes SET position = ?, preset_id = ? WHERE group_id = ? AND hero_id = ?",
  ).run(position, presetId === undefined ? hero.preset_id : presetId, groupId, heroId);
  return groupView(groupId);
}

export function setGroupHeroSettings(
  userId: string,
  groupId: string,
  heroId: string,
  settings: HeroCombatSettings,
): GroupView {
  const group = requireMember(userId, groupId);
  if (group.status !== "recruiting") throw conflict("队伍已经开始远征");
  const hero = db
    .prepare(
      `SELECT h.*, gh.user_id AS group_user_id
         FROM group_heroes gh
         JOIN heroes h ON h.id = gh.hero_id
        WHERE gh.group_id = ? AND gh.hero_id = ?`,
    )
    .get(groupId, heroId) as unknown as
    | (HeroRow & { group_user_id: string })
    | undefined;
  if (!hero) throw notFound("队伍中没有这个英雄");
  if (hero.group_user_id !== userId) throw forbidden("只能调整自己的英雄");
  validateSettings(hero, settings);
  db.prepare(
    "UPDATE group_heroes SET settings_json = ? WHERE group_id = ? AND hero_id = ?",
  ).run(JSON.stringify(settings), groupId, heroId);
  return groupView(groupId);
}

/** 队长发起组队通知：写入队列并重置成员响应状态。 */
function groupRaceIds(groupId: string): string[] {
  return (
    db
      .prepare(
        `SELECT h.race_id
           FROM group_heroes gh
           JOIN heroes h ON h.id = gh.hero_id
          WHERE gh.group_id = ?`,
      )
      .all(groupId) as unknown as Array<{ race_id: string }>
  ).map((row) => row.race_id);
}

function groupDungeonForAffinity(groupId: string, dungeon: Parameters<typeof partyAffinityPerks>[1]) {
  const perks = partyAffinityPerks(
    groupRaceIds(groupId).map((raceId) => ({ raceId })),
    dungeon,
  );
  return perks.has("swift") ? withExtraRoutes(dungeon) : dungeon;
}

/** 加载队长的个人迷宫区域快照；不存在时惰性初始化第 0 区。 */
function leaderPersonalMazeDungeon(
  leaderUserId: string,
  dungeonId: string,
): { dungeon: Dungeon; seriesId: string; depth: number; generatorVersion: number } {
  const match = /^pm-(.+)-d(\d+)$/.exec(dungeonId);
  if (!match) throw notFound("组队只能进入队长的个人迷宫区域");
  const seriesId = match[1] ?? "";
  const depth = Number(match[2] ?? -1);
  if (!seriesId || !Number.isInteger(depth) || depth < 0) {
    throw notFound("组队只能进入队长的个人迷宫区域");
  }
  const region = getOrInitRegion(leaderUserId, seriesId, depth);
  if (!region) throw notFound("队长的个人迷宫区域不存在");
  return {
    dungeon: region.dungeon,
    seriesId,
    depth,
    generatorVersion: region.generatorVersion,
  };
}

export function queueGroupExpedition(
  userId: string,
  groupId: string,
  input: { dungeonId: string; roomPath?: string[] },
): GroupView {
  const group = requireMember(userId, groupId);
  requireLeader(userId, group);
  if (group.status !== "recruiting") throw conflict("队伍已经开始远征");

  // 组队使用队长的个人迷宫区域快照。
  const dungeon = leaderPersonalMazeDungeon(group.leader_user_id, input.dungeonId).dungeon;

  const effectiveDungeon = groupDungeonForAffinity(groupId, dungeon);
  const roomPath = resolvePathForUser(group.leader_user_id, effectiveDungeon, input.roomPath);

  db.prepare(
    `UPDATE groups
        SET queue_dungeon_id = ?, queue_route_id = NULL, queue_depth = NULL,
            queue_room_path_json = ?, queue_created_at = ?
      WHERE id = ?`,
  ).run(dungeon.id, JSON.stringify(roomPath), Date.now(), groupId);
  db.prepare(
    "UPDATE group_members SET ready_state = 0 WHERE group_id = ?",
  ).run(groupId);
  rememberDungeonPath(group.leader_user_id, dungeon.id, roomPath);
  return groupView(groupId);
}

/** 队长取消本次组队通知。 */
export function cancelGroupQueue(userId: string, groupId: string): GroupView {
  const group = requireMember(userId, groupId);
  requireLeader(userId, group);
  db.prepare(
    `UPDATE groups
        SET queue_dungeon_id = NULL, queue_route_id = NULL, queue_depth = NULL,
            queue_room_path_json = NULL, queue_created_at = NULL
      WHERE id = ?`,
  ).run(groupId);
  db.prepare(
    "UPDATE group_members SET ready_state = 0 WHERE group_id = ?",
  ).run(groupId);
  return groupView(groupId);
}

/** 队员准备：staged 英雄里有重伤时拒绝，需先治疗或移出队伍。 */
export function setMemberReady(userId: string, groupId: string): GroupView {
  const group = requireMember(userId, groupId);
  if (group.status !== "recruiting") throw conflict("队伍已经开始远征");
  if (!group.queue_dungeon_id) throw badRequest("队长还没有发起组队通知");
  if (userId === group.leader_user_id) {
    throw badRequest("队长无需准备，直接点击出发即可");
  }
  const dead = db
    .prepare(
      `SELECT h.name
         FROM group_heroes gh
         JOIN heroes h ON h.id = gh.hero_id
        WHERE gh.group_id = ? AND gh.user_id = ? AND h.died_at IS NOT NULL`,
    )
    .all(groupId, userId) as unknown as Array<{ name: string }>;
  if (dead.length > 0) {
    throw conflict(
      `死亡英雄无法参加本次迷宫：${dead.map((row) => row.name).join("、")}。请先将其移出队伍`,
      "hero_dead",
    );
  }
  db.prepare(
    "UPDATE group_members SET ready_state = 1 WHERE group_id = ? AND user_id = ?",
  ).run(groupId, userId);
  return groupView(groupId);
}

/** 队员拒绝本次组队邀请（留在队伍）。 */
export function declineQueue(userId: string, groupId: string): GroupView {
  const group = requireMember(userId, groupId);
  if (!group.queue_dungeon_id) throw badRequest("没有待响应的组队通知");
  if (userId === group.leader_user_id) {
    throw badRequest("队长无需响应组队通知");
  }
  db.prepare(
    "UPDATE group_members SET ready_state = 2 WHERE group_id = ? AND user_id = ?",
  ).run(groupId, userId);
  return groupView(groupId);
}

export function startGroupExpedition(userId: string, groupId: string): { expeditionId: string } {
  const group = requireMember(userId, groupId);
  requireLeader(userId, group);
  if (group.status !== "recruiting") throw conflict("队伍已经开始远征");
  if (!group.queue_dungeon_id) {
    throw badRequest("请先选择迷宫并通知队友，全员准备后才能出发");
  }

  // 组队进入队长的个人迷宫区域；用通知时保存的快照重载。
  const leaderMaze = leaderPersonalMazeDungeon(group.leader_user_id, group.queue_dungeon_id);
  const dungeon = leaderMaze.dungeon;
  const queuedPath = group.queue_room_path_json
    ? parseJson<string[]>(group.queue_room_path_json)
    : undefined;
  const effectiveDungeon = groupDungeonForAffinity(groupId, dungeon);
  const roomPath = resolvePathForUser(group.leader_user_id, effectiveDungeon, queuedPath);
  const rooms = resolveRoomPath(effectiveDungeon, roomPath);

  // 只有实际派出英雄的成员需要准备；零英雄成员不参与本次远征，也不会阻塞出发。
  const memberStates = db
    .prepare(
      `SELECT m.user_id, m.ready_state,
              (SELECT COUNT(*) FROM group_heroes gh WHERE gh.group_id = m.group_id AND gh.user_id = m.user_id) AS hero_count
         FROM group_members m
        WHERE m.group_id = ?`,
    )
    .all(groupId) as unknown as Array<{ user_id: string; ready_state: number; hero_count: number }>;
  const notReady = memberStates.filter(
    (row) =>
      row.user_id !== group.leader_user_id &&
      row.hero_count > 0 &&
      row.ready_state !== 1,
  );
  if (notReady.length > 0) {
    const names = notReady
      .map((row) => {
        const member = db
          .prepare("SELECT username FROM users WHERE id = ?")
          .get(row.user_id) as unknown as { username: string } | undefined;
        return `${member?.username ?? row.user_id}${row.ready_state === 2 ? "（已拒绝）" : ""}`;
      })
      .join("、");
    throw conflict(`还有成员未准备：${names}`);
  }

  const heroRows = db
    .prepare(
      `SELECT gh.position, gh.preset_id, gh.settings_json, h.*
         FROM group_heroes gh
         JOIN heroes h ON h.id = gh.hero_id
        WHERE gh.group_id = ?
        ORDER BY gh.rowid ASC`,
    )
    .all(groupId) as unknown as Array<
    HeroRow & {
      position: Position;
      preset_id: string | null;
      settings_json: string;
    }
  >;
  if (heroRows.length === 0) throw badRequest("队伍中还没有英雄");
  if (heroRows.length > GROUP_CAPACITY) throw badRequest("队伍人数超过上限");

  // 区域属于队长个人：成员无需重复解锁，但仍需满足模板准入等级。
  assertPartyMeetsRequiredLevel(
    heroRows.map((hero) => ({ level: levelFromEp(hero.ep_earned) })),
    dungeon,
  );

  if (heroRows.length < 3) {
    throw badRequest("队伍至少需要 3 名英雄才能进入迷宫");
  }
  for (const hero of heroRows) {
    if (busyExpeditionId(hero.id)) throw conflict(`${hero.name} 正在远征中`);
    if (hero.died_at) {
      throw conflict(`${hero.name} 已永久死亡`, "hero_dead");
    }
  }

  const owner = getUserRow(group.leader_user_id);
  const settingsByHero = new Map<string, HeroCombatSettings>();
  for (const hero of heroRows) {
    const inline = parseSettings(hero.settings_json);
    if (Object.keys(inline).length > 0) {
      settingsByHero.set(hero.id, inline);
      continue;
    }
    const preset = resolvePresetForDungeon(
      hero.user_id,
      hero.id,
      dungeon.id,
      hero.preset_id ?? undefined,
    );
    settingsByHero.set(hero.id, preset.settings);
  }
  const specs: HeroRunSpec[] = heroRows.map((hero) => ({
    id: hero.id,
    name: hero.name,
    level: levelFromEp(hero.ep_earned),
    epEarned: hero.ep_earned,
    raceId: hero.race_id,
    weaponType: hero.weapon_type as WeaponType,
    skillLevels: parseJson<Record<string, number>>(hero.skills_json || "{}"),
    position: hero.position,
    equipment: equipmentRefs(hero.id),
    settings: settingsByHero.get(hero.id),
  }));

  const seed = createSeed();
  assertPartyMeetsPath(specs, rooms);
  const result = simulateExpedition(content, {
    dungeonId: dungeon.id,
    dungeon,
    roomPath,
    heroes: specs,
    edges: effectiveDungeon.edges,
    seed,
  });

  const now = Date.now();
  const durationSeconds = pathDurationSeconds(effectiveDungeon, roomPath);
  const endAt = now + Math.max(1000, Math.round(durationSeconds * 1000 * TIME_SCALE));
  const expeditionId = randomUUID();

  db.exec("BEGIN IMMEDIATE");
  try {
    const fresh = db
      .prepare("SELECT * FROM groups WHERE id = ? AND status = 'recruiting'")
      .get(groupId) as unknown as GroupRow | undefined;
    if (!fresh) throw conflict("队伍状态已经变化");
    if (fresh.leader_user_id !== owner.id) throw forbidden("只有队长可以开始远征");

    db.prepare(
      `INSERT INTO expeditions
         (id, user_id, dungeon_id, room_path_json, hero_ids_json, seed, group_id, status, start_at, end_at, created_at, result_json,
          maze_series_id, maze_depth, maze_generator_version, maze_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      expeditionId,
      owner.id,
      dungeon.id,
      JSON.stringify(roomPath),
      JSON.stringify(heroRows.map((hero) => hero.id)),
      seed,
      groupId,
      now,
      endAt,
      now,
      JSON.stringify(result),
      leaderMaze.seriesId,
      leaderMaze.depth,
      leaderMaze.generatorVersion,
      JSON.stringify(dungeon),
    );
    const link = db.prepare(
      "INSERT INTO expedition_heroes (expedition_id, hero_id) VALUES (?, ?)",
    );
    for (const hero of heroRows) link.run(expeditionId, hero.id);
    db.prepare(
      "UPDATE groups SET status = 'running', dungeon_id = ?, expedition_id = ? WHERE id = ?",
    ).run(dungeon.id, expeditionId, groupId);
    rememberDungeonPath(group.leader_user_id, dungeon.id, roomPath);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { expeditionId };
}

export function disbandGroup(userId: string, groupId: string): void {
  const group = requireMember(userId, groupId);
  requireLeader(userId, group);
  if (group.status === "running") throw conflict("队伍正在远征，无法解散");
  db.prepare("DELETE FROM chat_messages WHERE group_id = ?").run(groupId);
  db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
}

export function listOpenGroups(viewerUserId: string): GroupSummary[] {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.visibility, g.leader_user_id, g.created_at,
              u.username AS leader_name,
              (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count,
              (SELECT COUNT(*) FROM group_heroes gh WHERE gh.group_id = g.id) AS hero_count
         FROM groups g
         JOIN users u ON u.id = g.leader_user_id
        WHERE g.status = 'recruiting'
        ORDER BY g.created_at DESC
        LIMIT 50`,
    )
    .all() as unknown as Array<{
    id: string;
    name: string;
    visibility: GroupVisibility;
    leader_user_id: string;
    created_at: number;
    leader_name: string;
    member_count: number;
    hero_count: number;
  }>;
  return rows
    .filter((row) =>
      canJoinVisibleGroup(viewerUserId, row.visibility, row.leader_user_id),
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      visibility: row.visibility,
      leaderName: row.leader_name,
      memberCount: row.member_count,
      heroCount: row.hero_count,
      createdAt: row.created_at,
    }));
}

export function groupExpeditionView(userId: string, groupId: string) {
  const group = requireMember(userId, groupId);
  if (!group.expedition_id) throw notFound("队伍还没有远征");
  const row = db
    .prepare("SELECT * FROM expeditions WHERE id = ?")
    .get(group.expedition_id) as unknown as ExpeditionRow | undefined;
  if (!row) throw notFound("远征记录不存在");
  return expeditionRowToView(row);
}
