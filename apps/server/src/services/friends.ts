import { randomUUID } from "node:crypto";
import type {
  FriendRequestView,
  FriendSearchResult,
  FriendsView,
  FriendView,
} from "@wod/shared";
import { db } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";

interface UserLookupRow {
  id: string;
  username: string;
}

interface FriendRequestRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: number;
  responded_at: number | null;
}

function userByName(username: string): UserLookupRow | null {
  const row = db
    .prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
    .get(username.trim()) as unknown as UserLookupRow | undefined;
  return row ?? null;
}

function userById(userId: string): UserLookupRow | null {
  const row = db
    .prepare("SELECT id, username FROM users WHERE id = ?")
    .get(userId) as unknown as UserLookupRow | undefined;
  return row ?? null;
}

function pairRow(a: string, b: string, status: "pending" | "accepted") {
  return db
    .prepare(
      `SELECT * FROM friend_requests
        WHERE status = ?
          AND ((requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?))
        LIMIT 1`,
    )
    .get(status, a, b, b, a) as unknown as FriendRequestRow | undefined;
}

export function areFriends(a: string, b: string): boolean {
  if (a === b) return false;
  return Boolean(pairRow(a, b, "accepted"));
}

export function friendsView(userId: string): FriendsView {
  const friends = db
    .prepare(
      `SELECT CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END AS user_id,
              u.username,
              COALESCE(f.responded_at, f.created_at) AS since
         FROM friend_requests f
         JOIN users u ON u.id = CASE
           WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
        WHERE f.status = 'accepted'
          AND (f.requester_id = ? OR f.addressee_id = ?)
        ORDER BY u.username COLLATE NOCASE`,
    )
    .all(userId, userId, userId, userId) as unknown as Array<{
    user_id: string;
    username: string;
    since: number;
  }>;

  const incoming = db
    .prepare(
      `SELECT f.id, f.requester_id AS user_id, u.username, f.created_at
         FROM friend_requests f
         JOIN users u ON u.id = f.requester_id
        WHERE f.status = 'pending' AND f.addressee_id = ?
        ORDER BY f.created_at DESC`,
    )
    .all(userId) as unknown as Array<{
    id: string;
    user_id: string;
    username: string;
    created_at: number;
  }>;

  const outgoing = db
    .prepare(
      `SELECT f.id, f.addressee_id AS user_id, u.username, f.created_at
         FROM friend_requests f
         JOIN users u ON u.id = f.addressee_id
        WHERE f.status = 'pending' AND f.requester_id = ?
        ORDER BY f.created_at DESC`,
    )
    .all(userId) as unknown as Array<{
    id: string;
    user_id: string;
    username: string;
    created_at: number;
  }>;

  return {
    friends: friends.map(
      (row): FriendView => ({
        userId: row.user_id,
        username: row.username,
        since: row.since,
      }),
    ),
    incoming: incoming.map(
      (row): FriendRequestView => ({
        id: row.id,
        userId: row.user_id,
        username: row.username,
        createdAt: row.created_at,
      }),
    ),
    outgoing: outgoing.map(
      (row): FriendRequestView => ({
        id: row.id,
        userId: row.user_id,
        username: row.username,
        createdAt: row.created_at,
      }),
    ),
  };
}

export function searchUsers(userId: string, query: string): FriendSearchResult[] {
  const term = query.trim();
  if (!term) return [];
  const escaped = term.replace(/[\\%_]/g, "\\$&");
  const rows = db
    .prepare(
      `SELECT id, username FROM users
        WHERE id <> ? AND username LIKE ? ESCAPE '\\' COLLATE NOCASE
        ORDER BY username COLLATE NOCASE
        LIMIT 20`,
    )
    .all(userId, `%${escaped}%`) as unknown as UserLookupRow[];

  return rows.map((row) => {
    let relation: FriendSearchResult["relation"] = "none";
    if (areFriends(userId, row.id)) {
      relation = "friend";
    } else if (pendingFrom(userId, row.id)) {
      relation = "outgoing";
    } else if (pendingFrom(row.id, userId)) {
      relation = "incoming";
    }
    return { userId: row.id, username: row.username, relation };
  });
}

function pendingFrom(requesterId: string, addresseeId: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM friend_requests
          WHERE status = 'pending' AND requester_id = ? AND addressee_id = ?`,
      )
      .get(requesterId, addresseeId),
  );
}

export function sendFriendRequest(userId: string, username: string): FriendsView {
  const target = userByName(username);
  if (!target) throw notFound("找不到这个账号");
  if (target.id === userId) throw badRequest("不能添加自己为好友");
  if (areFriends(userId, target.id)) throw conflict("你们已经是好友");

  // 对方已经申请过你：直接接受，避免两条相反的待处理申请。
  const reverse = db
    .prepare(
      `SELECT * FROM friend_requests
        WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
    )
    .get(target.id, userId) as unknown as FriendRequestRow | undefined;
  if (reverse) {
    db.prepare(
      "UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?",
    ).run(Date.now(), reverse.id);
    return friendsView(userId);
  }

  if (pendingFrom(userId, target.id)) throw conflict("好友申请已发送，等待对方处理");
  if (pendingFrom(target.id, userId)) throw conflict("对方已经向你发送了好友申请");

  db.prepare(
    `INSERT INTO friend_requests (id, requester_id, addressee_id, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`,
  ).run(randomUUID(), userId, target.id, Date.now());
  return friendsView(userId);
}

export function respondFriendRequest(
  userId: string,
  requestId: string,
  accept: boolean,
): FriendsView {
  const row = db
    .prepare(
      `SELECT * FROM friend_requests
        WHERE id = ? AND addressee_id = ? AND status = 'pending'`,
    )
    .get(requestId, userId) as unknown as FriendRequestRow | undefined;
  if (!row) throw notFound("好友申请不存在或已处理");
  if (accept) {
    db.prepare(
      "UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?",
    ).run(Date.now(), requestId);
  } else {
    db.prepare("DELETE FROM friend_requests WHERE id = ?").run(requestId);
  }
  return friendsView(userId);
}

export function cancelFriendRequest(userId: string, requestId: string): FriendsView {
  const row = db
    .prepare(
      `SELECT 1 FROM friend_requests
        WHERE id = ? AND requester_id = ? AND status = 'pending'`,
    )
    .get(requestId, userId);
  if (!row) throw notFound("好友申请不存在或已处理");
  db.prepare("DELETE FROM friend_requests WHERE id = ?").run(requestId);
  return friendsView(userId);
}

export function removeFriend(userId: string, friendUserId: string): FriendsView {
  const target = userById(friendUserId);
  if (!target) throw notFound("找不到这个账号");
  const row = pairRow(userId, friendUserId, "accepted");
  if (!row) throw notFound("你们还不是好友");
  db.prepare("DELETE FROM friend_requests WHERE id = ?").run(row.id);
  return friendsView(userId);
}
