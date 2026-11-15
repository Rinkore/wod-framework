import { randomUUID } from "node:crypto";
import type { ChatMessageView } from "@wod/shared";
import { db } from "../db.js";
import { badRequest, conflict, forbidden } from "../errors.js";
import { currentClanRow } from "./clans.js";

type ChatChannel = ChatMessageView["channel"];

function requireChannel(
  userId: string,
  channel: ChatChannel,
  groupId?: string,
): void {
  if (channel === "global") return;
  if (channel === "clan") {
    if (!currentClanRow(userId)) {
      throw forbidden("需要先加入公会才能使用公会频道");
    }
    return;
  }
  if (!groupId) throw badRequest("队伍频道缺少 groupId");
  const member = db
    .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, userId);
  if (!member) throw forbidden("你不在这个队伍中");
}

export function listChat(
  userId: string,
  channel: ChatChannel,
  groupId?: string,
): ChatMessageView[] {
  requireChannel(userId, channel, groupId);
  const rows = (
    channel === "group"
      ? db
          .prepare(
            `SELECT id, user_id, username, channel, group_id, message, created_at
               FROM chat_messages
              WHERE channel = 'group' AND group_id = ?
              ORDER BY created_at DESC
              LIMIT 50`,
          )
          .all(groupId ?? "")
      : db
          .prepare(
            `SELECT id, user_id, username, channel, group_id, message, created_at
               FROM chat_messages
              WHERE channel = ?
              ORDER BY created_at DESC
              LIMIT 50`,
          )
          .all(channel)
  ) as unknown as Array<{
    id: string;
    user_id: string;
    username: string;
    channel: ChatChannel;
    group_id: string | null;
    message: string;
    created_at: number;
  }>;
  return rows
    .reverse()
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      channel: row.channel,
      groupId: row.group_id,
      message: row.message,
      createdAt: row.created_at,
    }));
}

export function sendChat(
  userId: string,
  channel: ChatChannel,
  message: string,
  groupId?: string,
): ChatMessageView {
  requireChannel(userId, channel, groupId);
  const text = message.trim();
  if (!text) throw badRequest("消息不能为空");
  if (text.length > 200) throw badRequest("消息最多 200 字");

  const last = db
    .prepare(
      "SELECT created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId) as unknown as { created_at: number } | undefined;
  if (last && Date.now() - last.created_at < 2000) {
    throw conflict("发言太快了，稍等两秒");
  }

  const user = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId) as unknown as { username: string } | undefined;
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO chat_messages (id, user_id, username, channel, group_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    userId,
    user?.username ?? "未知",
    channel,
    channel === "group" ? groupId ?? null : null,
    text,
    now,
  );

  return {
    id,
    userId,
    username: user?.username ?? "未知",
    channel,
    groupId: channel === "group" ? groupId ?? null : null,
    message: text,
    createdAt: now,
  };
}
