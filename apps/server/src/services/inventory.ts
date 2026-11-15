import { randomUUID } from "node:crypto";
import type { ItemRoll, ItemView } from "@wod/shared";
import { db } from "../db.js";
import { conflict } from "../errors.js";
import type { ItemRow } from "../types.js";
import { itemRowToView, parseJson } from "../views.js";

/**
 * 把掉落得到的装备加入账号背包；返回物品视图。
 */
export function addInventoryItem(
  userId: string,
  rollInput: ItemRoll,
  now: number,
): ItemView {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO inventory_items (id, user_id, template_id, data_json, acquired_at, quantity) VALUES (?, ?, ?, ?, ?, 1)",
  ).run(id, userId, rollInput.templateId, JSON.stringify(rollInput), now);
  const row = db
    .prepare("SELECT * FROM inventory_items WHERE id = ?")
    .get(id) as unknown as ItemRow;
  return itemRowToView(row);
}

/**
 * 从背包移除一件装备（市场/拍卖/公会仓库存入时使用）。
 * 必须校验删除行数：影响 0 行说明物品已被并发操作取走，调用方据此回滚，防止复制。
 */
export function takeInventoryUnit(row: ItemRow, ownerId?: string): ItemRoll {
  const deleted =
    ownerId !== undefined
      ? db
          .prepare("DELETE FROM inventory_items WHERE id = ? AND user_id = ?")
          .run(row.id, ownerId)
      : db.prepare("DELETE FROM inventory_items WHERE id = ?").run(row.id);
  if (deleted.changes !== 1) {
    throw conflict("物品已不存在或已被转移，请刷新后重试");
  }
  return parseJson<ItemRoll>(row.data_json);
}
