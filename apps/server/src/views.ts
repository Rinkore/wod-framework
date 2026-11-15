import {
  basicAttackFor,
  computeHeroDerived,
  computeHeroPower,
  epToNext,
  levelFromEp,
  powerAttackFor,
  skillBaseCritRate,
  skillBaseHitRate,
  skillTrainCost,
  skillTrainCostForTier,
  type EquippedItemRef,
} from "@wod/engine";
import type {
  AuthUser,
  Dungeon,
  ExpeditionResultView,
  ExpeditionView,
  HeroSkillView,
  HeroTitleView,
  HeroView,
  ItemRoll,
  ItemView,
  LeaderboardEntry,
  SkillTreeNode,
  Slot,
  WeaponType,
} from "@wod/shared";
import {
  WEAPON_TYPE_LABELS,
  WEAPON_TYPES,
  checkSkillNodeUnlock,
  skillPhases,
  skillPointsSpent,
  skillPointsTotal,
  skillUsableWithWeapon,
  weaponPath,
} from "@wod/shared";
import { content } from "./content.js";
import { db } from "./db.js";
import type { ExpeditionRow, HeroRow, ItemRow, UserRow } from "./types.js";

export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

export function itemRowToView(row: ItemRow): ItemView {
  const data = parseJson<ItemRoll>(row.data_json);
  const template = content.items.find((item) => item.id === row.template_id);
  const kind = data.kind ?? template?.kind ?? "equipment";
  const slot = data.slot ?? template?.slot ?? "trinket";
  return {
    ...data,
    kind,
    slot,
    weaponType: data.weaponType ?? template?.weaponType,
    id: row.id,
    equippedBy: row.equipped_by,
    equippedSlot: row.equipped_slot,
    acquiredAt: row.acquired_at,
  };
}

export function equippedRows(heroId: string): ItemRow[] {
  return db
    .prepare("SELECT * FROM inventory_items WHERE equipped_by = ?")
    .all(heroId) as unknown as ItemRow[];
}

export function equipmentRefs(heroId: string): EquippedItemRef[] {
  return equippedRows(heroId).map((row) => {
    const data = parseJson<ItemRoll>(row.data_json);
    return {
      templateId: row.template_id,
      affixes: data.affixes ?? [],
    };
  });
}

export function busyExpeditionId(heroId: string): string | null {
  const row = db
    .prepare(
      `SELECT eh.expedition_id AS id
         FROM expedition_heroes eh
         JOIN expeditions e ON e.id = eh.expedition_id
        WHERE eh.hero_id = ? AND e.status = 'running'
        LIMIT 1`,
    )
    .get(heroId) as unknown as { id: string } | undefined;
  return row?.id ?? null;
}

export function heroRowToView(row: HeroRow): HeroView {
  const race = content.races.find((entry) => entry.id === row.race_id);
  const path = weaponPath(content, row.weapon_type as WeaponType);
  if (!race || !path) {
    throw new Error(`英雄 ${row.name} 的过往或武器路径已从内容包中移除`);
  }

  const skillLevels = parseJson<Record<string, number>>(row.skills_json || "{}");
  const refs = equipmentRefs(row.id);
  const level = levelFromEp(row.ep_earned);
  const spec = {
    id: row.id,
    name: row.name,
    level,
    epEarned: row.ep_earned,
    raceId: row.race_id,
    weaponType: path.id,
    skillLevels,
    equipment: refs,
  };
  const derived = computeHeroDerived(content, spec);
  const power = computeHeroPower(content, spec);

  const equipment: Record<Slot, ItemView | null> = {
    weapon: null,
    armor: null,
    trinket: null,
  };
  for (const itemRow of equippedRows(row.id)) {
    const view = itemRowToView(itemRow);
    if (view.equippedSlot) equipment[view.equippedSlot] = view;
  }

  const unlocked = new Set(
    Object.entries(skillLevels)
      .filter(([, value]) => value > 0)
      .map(([id]) => id),
  );
  const totalPoints = skillPointsTotal(level);
  const spentPoints = skillPointsSpent(content, unlocked, path.id);
  const availablePoints = Math.max(0, totalPoints - spentPoints);

  const treeRows: Array<{
    source: "weapon";
    treeWeaponType: WeaponType;
    node: SkillTreeNode;
  }> = [];
  for (const weaponType of WEAPON_TYPES) {
    for (const node of content.skillTrees.weapons[weaponType] ?? []) {
      treeRows.push({ source: "weapon", treeWeaponType: weaponType, node });
    }
  }

  const skills: HeroSkillView[] = [];
  const seen = new Set<string>();
  for (const { source, treeWeaponType, node } of treeRows) {
    const rowKey = `${treeWeaponType}:${node.id}`;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    const skill = content.skills.find((entry) => entry.id === node.id);
    if (!skill) continue;
    const skillLevel = Math.max(0, skillLevels[node.id] ?? 0);
    const isUnlocked = skillLevel > 0;
    const check = isUnlocked
      ? { canUnlock: false as const, reason: undefined }
      : checkSkillNodeUnlock(content, unlocked, node.id, level, availablePoints);
    const isPassive = skill.kind === "passive";
    const cost = isPassive ? { ep: 0, gold: 0 } : skillTrainCostForTier(level, node.tier);
    skills.push({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      kind: skill.kind,
      category: skill.category,
      damageType: skill.damageType,
      range: skill.range,
      cooldown: skill.cooldown,
      energyCost: skill.energyCost,
      power: skill.power,
      levelScale: skill.levelScale,
      weaponScale: skill.weaponScale,
      baseCritRate: skillBaseCritRate(skill),
      baseHitRate: skillBaseHitRate(skill),
      ailmentEfficiency: skill.ailmentEfficiency ?? 2,
      executeThreshold: skill.executeThreshold,
      executeBonusPct: skill.executeBonusPct,
      ailmentBonusPct: skill.ailmentBonusPct,
      target: skill.target,
      level: skillLevel,
      maxLevel: isPassive ? 1 : Math.min(skill.maxLevel, 20),
      epCost: isPassive ? 0 : cost.ep,
      goldCost: isPassive ? 0 : cost.gold,
      weaponTypes: skill.weaponTypes,
      usable: !isPassive && skillUsableWithWeapon(skill, derived.weaponType),
      phases: skillPhases(skill),
      unlocked: isUnlocked,
      source,
      treeWeaponType,
      tier: node.tier,
      row: node.row,
      cost: node.cost,
      minLevel: node.minLevel,
      requires: node.requires,
      requiresAny: node.requiresAny,
      links: node.links,
      role: node.role,
      canUnlock: check.canUnlock,
      lockedReason: check.reason,
      passive: skill.passive,
    });
  }

  // 基础技能始终解锁，放在列表最前。
  const basics = [basicAttackFor(path, derived.weaponDamageType), powerAttackFor()];
  const basicViews: HeroSkillView[] = basics.map((skill) => {
    const basicLevel = Math.max(1, skillLevels[skill.id] ?? 1);
    const cost = skillTrainCost(level, skill.category === "basic" ? "basic" : "secondary");
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      kind: skill.kind,
      category: skill.category,
      damageType: derived.weaponDamageType,
      range: skill.range,
      cooldown: skill.cooldown,
      energyCost: skill.energyCost,
      power: skill.power,
      levelScale: skill.levelScale,
      weaponScale: skill.weaponScale,
      baseCritRate: skillBaseCritRate(skill),
      baseHitRate: skillBaseHitRate(skill),
      ailmentEfficiency: skill.ailmentEfficiency ?? 2,
      executeThreshold: skill.executeThreshold,
      executeBonusPct: skill.executeBonusPct,
      ailmentBonusPct: skill.ailmentBonusPct,
      target: skill.target,
      level: basicLevel,
      maxLevel: 20,
      epCost: cost.ep,
      goldCost: cost.gold,
      weaponTypes: skill.weaponTypes,
      usable: true,
      phases: skillPhases(skill),
      unlocked: true,
      source: "basic",
      tier: null,
      row: 0,
      cost: 0,
      minLevel: 1,
      requires: [],
      requiresAny: [],
      links: [],
      canUnlock: false,
    };
  });
  skills.unshift(...basicViews);

  const activeTitleRow = row.active_title_id
    ? (db
        .prepare(
          "SELECT source, unlocked_at FROM hero_titles WHERE hero_id = ? AND title_id = ?",
        )
        .get(row.id, row.active_title_id) as unknown as
        | { source: "fame" | "quest"; unlocked_at: number }
        | undefined)
    : undefined;
  const activeTitleDef = row.active_title_id
    ? content.titles.find((title) => title.id === row.active_title_id)
    : undefined;
  const activeTitle: HeroTitleView | null =
    activeTitleDef && activeTitleRow
      ? {
          id: activeTitleDef.id,
          name: activeTitleDef.name,
          description: activeTitleDef.description,
          color: activeTitleDef.color,
          fameThreshold: activeTitleDef.fameThreshold,
          source: activeTitleRow.source,
          unlockedAt: activeTitleRow.unlocked_at,
        }
      : null;

  return {
    id: row.id,
    name: row.name,
    raceId: row.race_id,
    raceName: race.name,
    pathWeaponType: path.id,
    weaponName: path.name,
    weaponColor: path.color,
    weaponType: derived.weaponType,
    weaponProficiencies: derived.weaponProficiencies,
    level,
    ep: row.xp,
    epEarned: row.ep_earned,
    epToNext: epToNext(level, row.ep_earned),
    finalStats: derived.finalStats,
    maxHp: derived.maxHp,
    maxEnergy: derived.maxEnergy,
    initiative: derived.initiative,
    armor: derived.armor,
    physicalReduction: derived.physicalReduction,
    hit: derived.hit,
    hitRate: derived.hitRate,
    evasion: derived.evasion,
    evasionRate: derived.evasionRate,
    critChance: derived.critChance,
    attackPower: derived.attackPower,
    actionsPerRound: derived.actionsPerRound,
    reference: derived.reference,
    resistances: derived.resistances,
    modifiers: derived.modifiers,
    power,
    trait: race.trait,
    skills,
    skillPoints: {
      total: totalPoints,
      spent: spentPoints,
      available: availablePoints,
    },
    equipment,
    busyExpeditionId: busyExpeditionId(row.id),
    diedAt: row.died_at ?? null,
    fame: row.fame ?? 0,
    activeTitle,
    createdAt: row.created_at,
  };
}

export function expeditionRowToView(row: ExpeditionRow): ExpeditionView {
  const heroIds = parseJson<string[]>(row.hero_ids_json);
  const heroes = heroIds.flatMap((id) => {
    const hero = db.prepare("SELECT * FROM heroes WHERE id = ?").get(id) as unknown as
      | HeroRow
      | undefined;
    if (!hero) return [];
    const path = weaponPath(content, hero.weapon_type as WeaponType);
    return [
      {
        id: hero.id,
        name: hero.name,
        level: hero.level,
        weaponType: hero.weapon_type as WeaponType,
        weaponName: path?.name ?? hero.weapon_type,
        weaponColor: path?.color ?? "#c9a227",
      },
    ];
  });

  // 个人区域不在静态内容里：从远征快照取房间名与名称。
  const mazeSnapshot = row.maze_snapshot_json
    ? (JSON.parse(row.maze_snapshot_json) as Dungeon)
    : null;
  const dungeon =
    content.dungeons.find((entry) => entry.id === row.dungeon_id) ?? mazeSnapshot;
  const roomPath = row.room_path_json
    ? parseJson<string[]>(row.room_path_json)
    : parsedResultPath(row.result_json);
  const roomNames = roomPath.map(
    (roomId) => dungeon?.rooms.find((room) => room.id === roomId)?.name ?? roomId,
  );
  const parsedResult = row.result_json
    ? parseJson<ExpeditionResultView>(row.result_json)
    : null;
  const npcs = (parsedResult?.npcs ?? []).map((npc) => {
    return {
      id: npc.id,
      name: npc.name,
      weaponType: npc.weaponType,
      weaponName: npc.weaponType ? WEAPON_TYPE_LABELS[npc.weaponType] : "未知",
      weaponColor: "#c9a227",
      position: npc.position,
    };
  });
  return {
    id: row.id,
    dungeonId: row.dungeon_id,
    dungeonName: dungeon?.name ?? row.dungeon_id,
    dungeonTheme: dungeon?.theme,
    roomPath,
    roomNames,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    heroes,
    npcs,
    result: row.status === "completed" ? parsedResult : null,
  };
}

function parsedResultPath(resultJson: string | null): string[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson) as { roomPath?: string[] };
    return Array.isArray(parsed.roomPath) ? parsed.roomPath : [];
  } catch {
    return [];
  }
}

export function authUserView(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    gold: row.gold,
    premium: Boolean(row.premium),
    createdAt: row.created_at,
  };
}

export function getLeaderboard(limit = 50): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT h.id, h.name, h.level, h.ep_earned, h.weapon_type, u.username
         FROM heroes h
         JOIN users u ON u.id = h.user_id
        ORDER BY h.level DESC, h.ep_earned DESC, h.created_at ASC
        LIMIT ?`,
    )
    .all(limit) as unknown as Array<{
    id: string;
    name: string;
    level: number;
    ep_earned: number;
    weapon_type: string;
    username: string;
  }>;

  return rows.map((row, index) => {
    const path = weaponPath(content, row.weapon_type as WeaponType);
    return {
      rank: index + 1,
      heroId: row.id,
      heroName: row.name,
      level: levelFromEp(row.ep_earned),
      epEarned: row.ep_earned,
      weaponName: path?.name ?? row.weapon_type,
      weaponType: row.weapon_type as WeaponType,
      weaponColor: path?.color ?? "#c9a227",
      playerName: row.username,
    };
  });
}
