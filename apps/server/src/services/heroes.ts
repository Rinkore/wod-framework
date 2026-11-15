import { randomUUID } from "node:crypto";
import {
  createSeed,
  getSkill,
  levelFromEp,
  MAX_SKILL_LEVEL,
  Rng,
  rollItem,
  sellValue,
  skillTrainCost,
  skillTrainCostForTier,
} from "@wod/engine";
import {
  MAX_HEROES_PER_ACCOUNT,
  WEAPON_TYPES,
  WEAPON_TYPE_LABELS,
  checkSkillNodeUnlock,
  containsSensitiveWord,
  findSkillTreeNode,
  heroCanUseItem,
  isEquipmentSlot,
  skillPointsSpent,
  skillPointsTotal,
  unlockedWeaponRoots,
  weaponPath,
  type CreateHeroInput,
  type DeathRosterView,
  type HeroDraftView,
  type EquipResultView,
  type ItemRoll,
  type ItemView,
  type Slot as SlotType,
  type TrainBatchInput,
  type TrainInput,
  type UnequipResultView,
  type WeaponType,
} from "@wod/shared";
import { content } from "../content.js";
import { STARTING_EP } from "../config.js";
import { db } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { ensureDefaultPreset } from "./presets.js";
import { addInventoryItem } from "./inventory.js";
import {
  createTombstone,
  deathRosterView,
  livingHeroCount,
  reviveWithPardon,
  reviveWithRedemption,
  HERO_DELETE_COST,
} from "./death.js";
import type { HeroRow, ItemRow, UserRow } from "../types.js";
import {
  authUserView,
  busyExpeditionId,
  heroRowToView,
  itemRowToView,
  parseJson,
} from "../views.js";

export const MAX_HEROES = MAX_HEROES_PER_ACCOUNT;

// ---------------------------------------------------------------------------
// 建号抽选：每次从全部过往中抽 2 个、武器路径中抽 3 个，玩家只能从中选择。
// ---------------------------------------------------------------------------

interface HeroDraftRow {
  id: string;
  user_id: string;
  race_ids_json: string;
  weapon_types_json: string;
  expires_at: number;
  rerolls_used: number;
}

const DRAFT_TTL_MS = 30 * 60 * 1000;

function draftView(row: HeroDraftRow): HeroDraftView {
  return {
    draftId: row.id,
    raceIds: parseJson<string[]>(row.race_ids_json),
    weaponTypes: parseJson<WeaponType[]>(row.weapon_types_json),
    expiresAt: row.expires_at,
    rerollsRemaining: Math.max(0, 1 - row.rerolls_used),
  };
}

function assertCreationCapacity(userId: string): void {
  if (livingHeroCount(userId) >= MAX_HEROES) {
    throw conflict(`英雄名册已满（${MAX_HEROES} 名）`, "roster_full");
  }
}

function sampleDistinct<T>(pool: T[], count: number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, count);
}

/** 在抽选事务中读取或生成唯一草稿；过期只续期，保留候选和重抽次数。 */
function getOrCreateDraft(userId: string, now: number): HeroDraftRow {
  let row = db.prepare("SELECT * FROM hero_drafts WHERE user_id = ?")
    .get(userId) as unknown as HeroDraftRow | undefined;
  if (!row) {
    db.prepare(
      `INSERT INTO hero_drafts
         (id, user_id, race_ids_json, weapon_types_json, expires_at, rerolls_used, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      randomUUID(), userId,
      JSON.stringify(sampleDistinct(content.races.map((race) => race.id), 2)),
      JSON.stringify(sampleDistinct([...WEAPON_TYPES], 3)),
      now + DRAFT_TTL_MS, now,
    );
    row = db.prepare("SELECT * FROM hero_drafts WHERE user_id = ?")
      .get(userId) as unknown as HeroDraftRow;
  } else if (row.expires_at <= now) {
    db.prepare("UPDATE hero_drafts SET expires_at = ? WHERE id = ?")
      .run(now + DRAFT_TTL_MS, row.id);
    row = { ...row, expires_at: now + DRAFT_TTL_MS };
  }
  return row;
}

function draftTransaction(userId: string, reroll: boolean): HeroDraftView {
  db.exec("BEGIN IMMEDIATE");
  try {
    const now = Date.now();
    let row = getOrCreateDraft(userId, now);
    if (reroll) {
      if (row.rerolls_used >= 1) {
        throw badRequest("本次招募的重抽机会已用完", "draft_reroll_used");
      }
      // 换发标识，避免另一个页面用重抽前的选择提交。
      db.prepare(
        `UPDATE hero_drafts SET id = ?, race_ids_json = ?, weapon_types_json = ?,
         expires_at = ?, rerolls_used = rerolls_used + 1 WHERE user_id = ?`,
      ).run(
        randomUUID(),
        JSON.stringify(sampleDistinct(content.races.map((race) => race.id), 2)),
        JSON.stringify(sampleDistinct([...WEAPON_TYPES], 3)),
        now + DRAFT_TTL_MS, userId,
      );
      row = db.prepare("SELECT * FROM hero_drafts WHERE user_id = ?")
        .get(userId) as unknown as HeroDraftRow;
    }
    const view = draftView(row);
    db.exec("COMMIT");
    return view;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createHeroDraft(userId: string): HeroDraftView {
  return draftTransaction(userId, false);
}

export function rerollHeroDraft(userId: string): HeroDraftView {
  return draftTransaction(userId, true);
}

/** 仅校验和续期；草稿在创建事务成功之前不能删除。 */
function requireHeroDraft(userId: string, draftId: string): HeroDraftView {
  const row = db.prepare("SELECT * FROM hero_drafts WHERE id = ? AND user_id = ?")
    .get(draftId, userId) as unknown as HeroDraftRow | undefined;
  if (!row) {
    throw badRequest("招募草稿已变更，请刷新后继续", "draft_invalid");
  }
  return draftView(row.expires_at <= Date.now() ? getOrCreateDraft(userId, Date.now()) : row);
}

export function listHeroRows(userId: string): HeroRow[] {
  return db
    .prepare("SELECT * FROM heroes WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as unknown as HeroRow[];
}

export function listHeroes(userId: string) {
  return listHeroRows(userId).map((row) => heroRowToView(row));
}

export function getHeroRow(userId: string, heroId: string): HeroRow {
  const row = db
    .prepare("SELECT * FROM heroes WHERE id = ? AND user_id = ?")
    .get(heroId, userId) as unknown as HeroRow | undefined;
  if (!row) throw notFound("英雄不存在");
  return row;
}

function ensureNotBusy(hero: HeroRow): void {
  if (busyExpeditionId(hero.id)) throw conflict("英雄正在远征中，无法进行此操作");
  if (hero.died_at) throw conflict("已永久死亡的英雄无法操作，请先复活或保留档案", "hero_dead");
}

function insertOwnedItem(
  userId: string,
  heroId: string,
  roll: ItemRoll,
  slot: SlotType | null,
  now: number,
): ItemView {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO inventory_items
       (id, user_id, template_id, data_json, acquired_at, equipped_by, equipped_slot)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    roll.templateId,
    JSON.stringify(roll),
    now,
    slot ? heroId : null,
    slot,
  );
  return {
    ...roll,
    id,
    equippedBy: slot ? heroId : null,
    equippedSlot: slot,
    acquiredAt: now,
  };
}

export function createHero(userId: string, input: CreateHeroInput) {
  const heroId = randomUUID();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    assertCreationCapacity(userId);
    const draft = requireHeroDraft(userId, input.draftId);
    if (!draft.raceIds.includes(input.raceId)) {
      throw badRequest("所选过往不在本次抽选中", "draft_invalid");
    }
    if (!draft.weaponTypes.includes(input.weaponType)) {
      throw badRequest("所选武器不在本次抽选中", "draft_invalid");
    }

    const race = content.races.find((row) => row.id === input.raceId);
    if (!race) throw badRequest("所选过往不存在");
    const path = weaponPath(content, input.weaponType);
    if (!path) throw badRequest("所选武器类型不存在");

    if (!input.name.trim() || input.name.length > 12 || /[\u0000-\u001f<>]/u.test(input.name)) {
      throw badRequest("英雄名须为 1 至 12 个字符，且不能包含非法字符");
    }
    if (containsSensitiveWord(input.name)) {
      throw badRequest("英雄名包含敏感词，请换一个名字", "sensitive_word");
    }

    const duplicate = db
      .prepare("SELECT id FROM heroes WHERE user_id = ? AND name = ?")
      .get(userId, input.name) as unknown as { id: string } | undefined;
    if (duplicate) throw conflict("这个英雄名已经被使用了", "duplicate_name");

    const skillLevels: Record<string, number> = {
      "basic-attack": 1,
      "power-attack": 1,
    };
    skillLevels[path.rootSkillId] = 1;

    db.prepare(
      `INSERT INTO heroes
         (id, user_id, name, race_id, weapon_type, level, xp, ep_earned, skills_json, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).run(
      heroId,
      userId,
      input.name,
      input.raceId,
      input.weaponType,
      STARTING_EP,
      STARTING_EP,
      JSON.stringify(skillLevels),
      now,
    );

    const rng = new Rng(createSeed());
    const equippedSlots = new Set<SlotType>();
    for (const templateId of path.startingItemIds) {
      const template = content.items.find((row) => row.id === templateId);
      if (!template) continue;
      const roll = rollItem(content, template, rng);
      if (!isEquipmentSlot(template.slot)) {
        addInventoryItem(userId, roll, now);
        continue;
      }
      const shouldEquip = !equippedSlots.has(template.slot);
      insertOwnedItem(userId, heroId, roll, shouldEquip ? template.slot : null, now);
      equippedSlots.add(template.slot);
    }
    ensureDefaultPreset(userId, heroId);
    db.prepare("DELETE FROM hero_drafts WHERE id = ? AND user_id = ?").run(input.draftId, userId);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (String((error as Error).message).includes("UNIQUE")) {
      throw conflict("这个英雄名已经被使用了");
    }
    throw error;
  }

  return heroRowToView(getHeroRow(userId, heroId));
}

function isBasicSkill(skillId: string): boolean {
  return skillId === "basic-attack" || skillId === "power-attack";
}

function skillTrainCostForHero(
  heroLevel: number,
  skillId: string,
): { ep: number; gold: number } {
  if (skillId === "basic-attack") return skillTrainCost(heroLevel, "basic");
  if (skillId === "power-attack") return skillTrainCost(heroLevel, "secondary");
  const found = findSkillTreeNode(content, skillId);
  if (!found) throw badRequest(`该英雄没有技能 ${skillId}`);
  return skillTrainCostForTier(heroLevel, found.node.tier);
}

function skillMaxLevel(skillId: string): number {
  if (isBasicSkill(skillId)) return MAX_SKILL_LEVEL;
  return Math.min(getSkill(content, skillId).maxLevel || MAX_SKILL_LEVEL, MAX_SKILL_LEVEL);
}

export function trainHero(userId: string, heroId: string, input: TrainInput) {
  const hero = getHeroRow(userId, heroId);
  ensureNotBusy(hero);
  const heroLevel = levelFromEp(hero.ep_earned);
  const levels = parseJson<Record<string, number>>(hero.skills_json);

  const skillDef = content.skills.find((row) => row.id === input.key);
  if (skillDef?.kind === "trait") throw badRequest("特质不能升级");
  if (!isBasicSkill(input.key) && (levels[input.key] ?? 0) <= 0) {
    throw badRequest("技能尚未解锁");
  }
  const current = Math.max(0, levels[input.key] ?? 0);
  const maxLevel = skillMaxLevel(input.key);
  if (current >= maxLevel) throw badRequest(`该技能已达到 ${maxLevel} 级`);

  const cost = skillTrainCostForHero(heroLevel, input.key);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
  if (hero.xp < cost.ep) throw badRequest(`需要 ${cost.ep} EP，当前不足`);
  if (user.gold < cost.gold) throw badRequest(`需要 ${cost.gold} 金币，当前不足`);

  levels[input.key] = current + 1;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE heroes SET skills_json = ?, xp = xp - ? WHERE id = ?").run(
      JSON.stringify(levels),
      cost.ep,
      hero.id,
    );
    db.prepare("UPDATE users SET gold = gold - ? WHERE id = ?").run(cost.gold, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const freshUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
  return {
    hero: heroRowToView(getHeroRow(userId, heroId)),
    user: authUserView(freshUser),
    cost,
  };
}

/** 预览后一次性提交技能训练与技能树解锁。 */
export function trainHeroBatch(userId: string, heroId: string, input: TrainBatchInput) {
  const hero = getHeroRow(userId, heroId);
  ensureNotBusy(hero);
  const heroLevel = levelFromEp(hero.ep_earned);
  const levels = parseJson<Record<string, number>>(hero.skills_json);
  const unlockIds = [...new Set(input.unlocks ?? [])];
  const skillIncs = Object.entries(input.skills ?? {});
  if (unlockIds.length === 0 && skillIncs.length === 0) {
    throw badRequest("没有要保存的训练改动");
  }

  const nextLevels = { ...levels };
  const unlocked = new Set(
    Object.entries(levels)
      .filter(([, level]) => level > 0)
      .map(([id]) => id),
  );
  let pointsAvailable =
    skillPointsTotal(heroLevel) -
    skillPointsSpent(content, unlocked, hero.weapon_type as WeaponType);
  let skillPointCost = 0;

  // 音叉树是无向图：同批解锁可能从连接点向内走，不能只按 tier 升序。
  // 反复扫描，直到没有新的可解锁节点；同时支持同批前置链。
  const pending = unlockIds
    .filter((skillId) => !unlocked.has(skillId))
    .map((skillId) => ({ skillId, found: findSkillTreeNode(content, skillId) }))
    .sort((a, b) => (a.found?.node.tier ?? 99) - (b.found?.node.tier ?? 99));
  for (const { skillId, found } of pending) {
    if (!found) throw badRequest(`技能 ${skillId} 不在技能树中`);
  }
  let firstBlocked: string | null = null;
  while (pending.length > 0) {
    const index = pending.findIndex(({ skillId }) =>
      checkSkillNodeUnlock(content, unlocked, skillId, heroLevel, pointsAvailable).canUnlock,
    );
    if (index < 0) {
      const blocked = pending[0]!;
      const check = checkSkillNodeUnlock(
        content,
        unlocked,
        blocked.skillId,
        heroLevel,
        pointsAvailable,
      );
      firstBlocked = check.reason ?? `无法解锁 ${blocked.skillId}`;
      break;
    }
    const [entry] = pending.splice(index, 1);
    if (!entry?.found) continue;
    unlocked.add(entry.skillId);
    nextLevels[entry.skillId] = 1;
    pointsAvailable -= entry.found.node.cost;
    skillPointCost += entry.found.node.cost;
  }
  if (pending.length > 0) {
    throw badRequest(firstBlocked ?? "有技能节点无法解锁");
  }

  let epCost = 0;
  let goldCost = 0;
  for (const [skillId, rawInc] of skillIncs) {
    const inc = Math.max(1, Math.floor(rawInc));
    if (!isBasicSkill(skillId) && !unlocked.has(skillId)) {
      throw badRequest(`技能 ${skillId} 尚未解锁`);
    }
    const found = findSkillTreeNode(content, skillId);
    const skillDef = content.skills.find((row) => row.id === skillId);
    if (skillDef?.kind === "trait") throw badRequest("特质不能升级");
    if (found && getSkill(content, skillId).kind === "passive") {
      throw badRequest("被动节点不能训练等级");
    }
    const current = Math.max(0, nextLevels[skillId] ?? 0);
    const maxLevel = skillMaxLevel(skillId);
    if (current + inc > maxLevel) {
      throw badRequest(`${skillId} 最多只能练到 ${maxLevel} 级`);
    }
    nextLevels[skillId] = current + inc;
    const cost = skillTrainCostForHero(heroLevel, skillId);
    epCost += cost.ep * inc;
    goldCost += cost.gold * inc;
  }

  const userBefore = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
  if (hero.xp < epCost) {
    throw badRequest(`需要 ${epCost} 经验点，当前不足`);
  }
  if (userBefore.gold < goldCost) {
    throw badRequest(`需要 ${goldCost} 金币，当前不足`);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE heroes SET skills_json = ?, xp = xp - ? WHERE id = ?").run(
      JSON.stringify(nextLevels),
      epCost,
      hero.id,
    );
    db.prepare("UPDATE users SET gold = gold - ? WHERE id = ?").run(goldCost, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const freshUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
  return {
    hero: heroRowToView(getHeroRow(userId, heroId)),
    user: authUserView(freshUser),
    cost: { ep: epCost, gold: goldCost, freePoints: 0, skillPoints: skillPointCost },
  };
}

/** 死亡名册视图：死者、归档墓碑与已有复活券。 */
export function deathRoster(userId: string): DeathRosterView {
  return deathRosterView(userId);
}

/** 死者免费归档并保留墓碑；存活英雄支付金币删除，均须确认全名。 */
export function deleteHero(userId: string, heroId: string, confirmName: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const hero = getHeroRow(userId, heroId);
    const dead = hero.died_at != null;
    if (!dead) {
      if (busyExpeditionId(hero.id)) throw conflict("英雄正在远征中，无法删除");
      const staged = db
        .prepare("SELECT 1 FROM group_heroes WHERE hero_id = ?")
        .get(hero.id);
      if (staged) throw conflict("英雄在队伍中，请先移出队伍");
    }
    if (confirmName !== hero.name) {
      throw badRequest("英雄名不匹配：请输入完整的英雄名以确认删除");
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
    // 死亡角色免费归档；存活角色按既有价格删除。
    const charge = dead ? 0 : HERO_DELETE_COST;
    if (!dead && user.gold < HERO_DELETE_COST) {
      throw badRequest(`删除角色需要 ${HERO_DELETE_COST} 金币，金币不足`);
    }

    if (dead) createTombstone(hero, Date.now());
    if (charge > 0) {
      db.prepare("UPDATE users SET gold = gold - ? WHERE id = ?").run(charge, userId);
    }
    db.prepare(
      "UPDATE inventory_items SET equipped_by = NULL, equipped_slot = NULL WHERE equipped_by = ?",
    ).run(hero.id);
    db.prepare("DELETE FROM heroes WHERE id = ?").run(hero.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as UserRow;
  return { user: authUserView(updatedUser) };
}

/** 使用死亡赦免/赎回券复活角色。 */
export function reviveHero(userId: string, heroId: string, token: "pardon" | "redemption") {
  const hero =
    token === "pardon"
      ? reviveWithPardon(userId, heroId)
      : reviveWithRedemption(userId, heroId);
  return { hero: heroRowToView(hero) };
}

function heroWeaponProficiencies(hero: HeroRow): WeaponType[] {
  const levels = parseJson<Record<string, number>>(hero.skills_json);
  const unlocked = new Set(
    Object.entries(levels)
      .filter(([, level]) => level > 0)
      .map(([id]) => id),
  );
  const starting = hero.weapon_type as WeaponType;
  const roots = unlockedWeaponRoots(content, unlocked);
  const proficiencies = new Set<WeaponType>([starting, ...roots]);
  for (const id of unlocked) {
    const skill = content.skills.find((row) => row.id === id);
    if (skill?.kind === "passive" && skill.passive) {
      for (const weapon of skill.passive.weaponProficiencies) proficiencies.add(weapon);
    }
  }
  return [...proficiencies];
}

export function equipItem(userId: string, heroId: string, itemId: string): EquipResultView {
  const hero = getHeroRow(userId, heroId);
  ensureNotBusy(hero);

  const item = db
    .prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?")
    .get(itemId, userId) as unknown as ItemRow | undefined;
  if (!item) throw notFound("物品不存在");
  if (item.equipped_by === hero.id) {
    return { hero: heroRowToView(hero), replacedItem: null, fromHero: null };
  }

  const roll = parseJson<ItemRoll>(item.data_json);
  const slot = roll.slot;
  if (!isEquipmentSlot(slot)) {
    throw badRequest("这件物品不能装备");
  }
  const template = content.items.find((row) => row.id === item.template_id);
  const weaponType = template?.weaponType ?? roll.weaponType;
  if (weaponType && !heroWeaponProficiencies(hero).includes(weaponType)) {
    throw badRequest(
      `${hero.name} 无法装备这件物品：尚未掌握${WEAPON_TYPE_LABELS[weaponType]}`,
      "weapon_requirement",
    );
  }
  const heroLevel = levelFromEp(hero.ep_earned);
  if (roll.level > heroLevel) {
    throw badRequest(
      `${hero.name} 等级不足，需要 ${roll.level} 级才能装备「${roll.name}」`,
      "level_requirement",
    );
  }

  let fromHero: EquipResultView["fromHero"] = null;
  if (item.equipped_by) {
    const previousOwner = db
      .prepare("SELECT * FROM heroes WHERE id = ?")
      .get(item.equipped_by) as unknown as HeroRow | undefined;
    if (previousOwner) {
      if (busyExpeditionId(previousOwner.id)) {
        throw conflict(`${previousOwner.name} 正在远征中，无法转移「${roll.name}」`);
      }
      fromHero = { id: previousOwner.id, name: previousOwner.name };
    }
  }

  const replacedRow = db
    .prepare("SELECT * FROM inventory_items WHERE equipped_by = ? AND equipped_slot = ?")
    .get(hero.id, slot) as unknown as ItemRow | undefined;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE inventory_items SET equipped_by = NULL, equipped_slot = NULL WHERE equipped_by = ? AND equipped_slot = ?",
    ).run(hero.id, slot);
    db.prepare(
      "UPDATE inventory_items SET equipped_by = ?, equipped_slot = ? WHERE id = ? AND user_id = ?",
    ).run(hero.id, slot, itemId, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    hero: heroRowToView(getHeroRow(userId, heroId)),
    replacedItem: replacedRow
      ? itemRowToView({ ...replacedRow, equipped_by: null, equipped_slot: null })
      : null,
    fromHero,
  };
}

export function unequipItem(userId: string, heroId: string, slot: SlotType): UnequipResultView {
  const hero = getHeroRow(userId, heroId);
  ensureNotBusy(hero);
  const item = db
    .prepare("SELECT * FROM inventory_items WHERE equipped_by = ? AND equipped_slot = ?")
    .get(hero.id, slot) as unknown as ItemRow | undefined;
  if (!item) throw badRequest("该部位没有装备");

  db.prepare(
    "UPDATE inventory_items SET equipped_by = NULL, equipped_slot = NULL WHERE id = ?",
  ).run(item.id);

  return {
    hero: heroRowToView(getHeroRow(userId, heroId)),
    item: itemRowToView({ ...item, equipped_by: null, equipped_slot: null }),
  };
}

export function listInventory(userId: string) {
  const rows = db
    .prepare("SELECT * FROM inventory_items WHERE user_id = ? ORDER BY acquired_at DESC")
    .all(userId) as unknown as ItemRow[];
  return rows.map((row) => itemRowToView(row));
}

export function sellItem(userId: string, itemId: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    // 所有权检查与删除在同一事务内，删除必须命中一行，防止并发双卖。
    const item = db
      .prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?")
      .get(itemId, userId) as unknown as ItemRow | undefined;
    if (!item) throw notFound("物品不存在");
    if (item.equipped_by) throw badRequest("请先卸下正在使用的装备");

    const roll = parseJson<ItemRoll>(item.data_json);
    const price = sellValue(roll);
    const deleted = db
      .prepare("DELETE FROM inventory_items WHERE id = ? AND user_id = ?")
      .run(item.id, userId);
    if (deleted.changes !== 1) throw conflict("物品已不存在，请刷新后重试");
    db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(price, userId);
    db.exec("COMMIT");

    const user = db.prepare("SELECT gold FROM users WHERE id = ?").get(userId) as unknown as {
      gold: number;
    };
    return {
      gold: user.gold,
      price,
      item: itemRowToView({ ...item, equipped_by: null, equipped_slot: null }),
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
