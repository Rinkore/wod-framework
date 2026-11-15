import { randomUUID } from "node:crypto";
import {
  MAX_HERO_PRESETS,
  allSkillTreeNodes,
  defaultPositionForWeapon,
  heroCombatSettingsSchema,
  type HeroCombatSettings,
  type HeroPresetInput,
  type HeroPresetUpdateInput,
  type HeroPresetView,
  type Position,
  type WeaponType,
} from "@wod/shared";
import { content } from "../content.js";
import { db } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";

interface PresetRow {
  id: string;
  user_id: string;
  hero_id: string;
  name: string;
  position: Position;
  settings_json: string;
  bound_dungeon_id: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

interface HeroNameRow {
  id: string;
  name: string;
  weapon_type: string;
  skills_json?: string;
}

export function parseSettings(text: string): HeroCombatSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text || "{}");
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const parsed = heroCombatSettingsSchema.safeParse(record);
  return parsed.success ? parsed.data : {};
}

export function validateSettings(hero: HeroNameRow, settings: HeroCombatSettings): void {
  const unlocked = hero.skills_json
    ? new Set(
        Object.entries(JSON.parse(hero.skills_json || "{}") as Record<string, number>)
          .filter(([, level]) => level > 0)
          .map(([id]) => id),
      )
    : null;
  const skillIds = new Set<string>();
  for (const node of allSkillTreeNodes(content)) {
    const skill = content.skills.find((row) => row.id === node.id);
    if (!skill || skill.kind === "passive") continue;
    if (unlocked && !unlocked.has(node.id)) continue;
    skillIds.add(node.id);
  }
  const checkSkill = (id: string | undefined, label: string) => {
    if (id && !skillIds.has(id)) throw badRequest(`${label}不是该英雄已解锁的技能`);
  };
  for (const [phase, value] of Object.entries(settings.phases ?? {})) {
    for (const skillId of value?.skillIds ?? []) {
      checkSkill(skillId, `${phase} 阶段技能`);
    }
  }
  for (const [floor, value] of Object.entries(settings.floors ?? {})) {
    const floorNumber = Number(floor);
    if (!Number.isInteger(floorNumber) || floorNumber < 1 || floorNumber > 10) {
      throw badRequest("层设置只能填写 1–10 层");
    }
    for (const [phase, phaseValue] of Object.entries(value.phases ?? {})) {
      for (const skillId of phaseValue?.skillIds ?? []) {
        checkSkill(skillId, `${floor} 层 ${phase} 阶段技能`);
      }
    }
  }
  if (settings.evacuation) {
    const { type, value } = settings.evacuation;
    if (type === "hp" && (value < 1 || value > 99)) {
      throw badRequest("撤离条件：生命百分比应在 1–99 之间");
    }
    if (type === "downed" && (value < 1 || value > 3)) {
      throw badRequest("撤离条件：倒地人数应在 1–3 之间");
    }
    if (type === "rooms" && (value < 1 || value > 23)) {
      throw badRequest("撤离条件：推进房间数应在 1–23 之间");
    }
  }
  if (settings.boundDungeonId) {
    const personal = /^pm-(.+)-d(\d+)$/.exec(settings.boundDungeonId);
    const dungeon = content.dungeons.find((row) => row.id === settings.boundDungeonId);
    // 绑定可以是固定内容迷宫（模板）或个人迷宫区域；个人区域只校验系列存在。
    if (!dungeon && !(personal && content.dungeons.some((row) => row.seriesId === personal[1]))) {
      throw badRequest("绑定的迷宫不存在");
    }
  }
}

function presetView(row: PresetRow): HeroPresetView {
  return {
    id: row.id,
    heroId: row.hero_id,
    name: row.name,
    position: row.position,
    settings: parseSettings(row.settings_json),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getHero(userId: string, heroId: string): HeroNameRow {
  const hero = db
    .prepare("SELECT id, name, weapon_type, skills_json FROM heroes WHERE id = ? AND user_id = ?")
    .get(heroId, userId) as unknown as HeroNameRow | undefined;
  if (!hero) throw notFound("英雄不存在");
  return hero;
}

function getPreset(userId: string, heroId: string, presetId: string): PresetRow {
  const row = db
    .prepare(
      "SELECT * FROM hero_presets WHERE id = ? AND hero_id = ? AND user_id = ?",
    )
    .get(presetId, heroId, userId) as unknown as PresetRow | undefined;
  if (!row) throw notFound("战斗预设不存在");
  return row;
}

export function listPresets(userId: string): HeroPresetView[] {
  const rows = db
    .prepare(
      `SELECT p.*
         FROM hero_presets p
         JOIN heroes h ON h.id = p.hero_id
        WHERE p.user_id = ?
        ORDER BY h.created_at ASC, p.is_default DESC, p.created_at ASC`,
    )
    .all(userId) as unknown as PresetRow[];
  return rows.map(presetView);
}

export function listHeroPresets(userId: string, heroId: string): HeroPresetView[] {
  getHero(userId, heroId);
  ensureDefaultPreset(userId, heroId);
  const rows = db
    .prepare(
      `SELECT * FROM hero_presets
        WHERE hero_id = ? AND user_id = ?
        ORDER BY is_default DESC, created_at ASC`,
    )
    .all(heroId, userId) as unknown as PresetRow[];
  return rows.map(presetView);
}

export function ensureDefaultPreset(userId: string, heroId: string): HeroPresetView {
  const hero = getHero(userId, heroId);
  const current = db
    .prepare(
      "SELECT * FROM hero_presets WHERE hero_id = ? AND user_id = ? AND is_default = 1 LIMIT 1",
    )
    .get(heroId, userId) as unknown as PresetRow | undefined;
  if (current) return presetView(current);

  const any = db
    .prepare(
      "SELECT * FROM hero_presets WHERE hero_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1",
    )
    .get(heroId, userId) as unknown as PresetRow | undefined;
  if (any) {
    db.prepare("UPDATE hero_presets SET is_default = 1, updated_at = ? WHERE id = ?").run(
      Date.now(),
      any.id,
    );
    return presetView({ ...any, is_default: 1 });
  }

  const now = Date.now();
  const id = randomUUID();
  const position = defaultPositionForWeapon(hero.weapon_type as WeaponType);
  db.prepare(
    `INSERT INTO hero_presets
       (id, user_id, hero_id, name, position, settings_json, bound_dungeon_id, is_default, created_at, updated_at)
     VALUES (?, ?, ?, '默认', ?, '{}', NULL, 1, ?, ?)`,
  ).run(id, userId, heroId, position, now, now);
  return presetView({
    id,
    user_id: userId,
    hero_id: heroId,
    name: "默认",
    position,
    settings_json: "{}",
    bound_dungeon_id: null,
    is_default: 1,
    created_at: now,
    updated_at: now,
  });
}

export function createPreset(
  userId: string,
  heroId: string,
  input: HeroPresetInput,
): HeroPresetView {
  const hero = getHero(userId, heroId);
  const settings = input.settings ?? {};
  validateSettings(hero, settings);
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM hero_presets WHERE hero_id = ? AND user_id = ?")
    .get(heroId, userId) as unknown as { count: number };
  if (count.count >= MAX_HERO_PRESETS) {
    throw conflict(`每个英雄最多保存 ${MAX_HERO_PRESETS} 套预设`, "preset_limit");
  }

  const id = randomUUID();
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO hero_presets
         (id, user_id, hero_id, name, position, settings_json, bound_dungeon_id, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      userId,
      heroId,
      input.name,
      input.position,
      JSON.stringify(settings),
      settings.boundDungeonId ?? null,
      now,
      now,
    );
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw conflict("这个预设名已经存在");
    }
    throw error;
  }
  return presetView(getPreset(userId, heroId, id));
}

export function updatePreset(
  userId: string,
  heroId: string,
  presetId: string,
  input: HeroPresetUpdateInput,
): HeroPresetView {
  const hero = getHero(userId, heroId);
  const current = getPreset(userId, heroId, presetId);
  const settings = input.settings ?? parseSettings(current.settings_json);
  validateSettings(hero, settings);
  const now = Date.now();
  try {
    db.prepare(
      `UPDATE hero_presets
          SET name = ?, position = ?, settings_json = ?, bound_dungeon_id = ?, updated_at = ?
        WHERE id = ? AND hero_id = ? AND user_id = ?`,
    ).run(
      input.name ?? current.name,
      input.position ?? current.position,
      JSON.stringify(settings),
      settings.boundDungeonId ?? null,
      now,
      presetId,
      heroId,
      userId,
    );
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw conflict("这个预设名已经存在");
    }
    throw error;
  }
  return presetView(getPreset(userId, heroId, presetId));
}

export function deletePreset(userId: string, heroId: string, presetId: string): void {
  getHero(userId, heroId);
  const current = getPreset(userId, heroId, presetId);
  const count = db
    .prepare("SELECT COUNT(*) AS count FROM hero_presets WHERE hero_id = ? AND user_id = ?")
    .get(heroId, userId) as unknown as { count: number };
  if (count.count <= 1) {
    throw badRequest("每个英雄至少保留一套预设", "preset_minimum");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "DELETE FROM hero_presets WHERE id = ? AND hero_id = ? AND user_id = ?",
    ).run(presetId, heroId, userId);
    if (current.is_default) {
      const next = db
        .prepare(
          "SELECT id FROM hero_presets WHERE hero_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1",
        )
        .get(heroId, userId) as unknown as { id: string } | undefined;
      if (next) {
        db.prepare("UPDATE hero_presets SET is_default = 1, updated_at = ? WHERE id = ?").run(
          Date.now(),
          next.id,
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setDefaultPreset(
  userId: string,
  heroId: string,
  presetId: string,
): HeroPresetView {
  getHero(userId, heroId);
  getPreset(userId, heroId, presetId);
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE hero_presets SET is_default = 0, updated_at = ? WHERE hero_id = ? AND user_id = ?",
    ).run(now, heroId, userId);
    db.prepare(
      "UPDATE hero_presets SET is_default = 1, updated_at = ? WHERE id = ? AND hero_id = ? AND user_id = ?",
    ).run(now, presetId, heroId, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return presetView(getPreset(userId, heroId, presetId));
}

/** 派遣时解析预设：显式指定 > 绑定该迷宫 > 默认 > 自动补默认。 */
export function resolvePresetForDungeon(
  userId: string,
  heroId: string,
  dungeonId: string,
  presetId?: string,
): HeroPresetView {
  getHero(userId, heroId);
  if (presetId) {
    return presetView(getPreset(userId, heroId, presetId));
  }
  const bound = db
    .prepare(
      `SELECT * FROM hero_presets
        WHERE hero_id = ? AND user_id = ? AND bound_dungeon_id = ?
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1`,
    )
    .get(heroId, userId, dungeonId) as unknown as PresetRow | undefined;
  if (bound) return presetView(bound);
  const fallback = db
    .prepare(
      `SELECT * FROM hero_presets
        WHERE hero_id = ? AND user_id = ? AND is_default = 1
        LIMIT 1`,
    )
    .get(heroId, userId) as unknown as PresetRow | undefined;
  if (fallback) return presetView(fallback);
  return ensureDefaultPreset(userId, heroId);
}
