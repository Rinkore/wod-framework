import {
  AFFINITY_PERK_LABELS,
  AILMENTS,
  affinityPerkFor,
  type AffinityPerk,
  type ContentPack,
  type Dungeon,
  type DungeonRoom,
  type EncounterResult,
  type ExpeditionEngineResult,
  type ExpeditionHeroResult,
  type ItemRoll,
} from "@wod/shared";
import { levelFromEp } from "./progression.js";
import { roomMonsterLevel } from "./threat.js";
import { rollLootTable } from "./loot.js";
import { Rng, createSeed } from "./rng.js";
import {
  buildHeroCombatant,
  buildMonsterCombatant,
  resolveFloorSettings,
  simulateEncounter,
  type Combatant,
} from "./combat.js";
import type { HeroRunSpec } from "./stats.js";

export interface ExpeditionRequest {
  dungeonId: string;
  /** 直接提供迷宫对象（个人区域快照）；提供时优先生效，dungeonId 仅用于日志。 */
  dungeon?: Dungeon;
  /** 迷宫路径（房间 id 从入口开始）；不传时使用入口到 boss 的最短通路。 */
  roomPath?: string[];
  heroes: HeroRunSpec[];
  /** 该次远征携带的固定 NPC 支援 id。 */
  npcIds?: string[];
  /** 亲和额外通路；不传时使用迷宫原始 edges。 */
  edges?: Array<[string, string]>;
  seed?: number;
}

function adjacencyOf(dungeon: Dungeon): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const room of dungeon.rooms) adjacency.set(room.id, []);
  for (const [a, b] of dungeon.edges) {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  return adjacency;
}

/** 入口到 boss 的最短通路（BFS）。 */
export function defaultRoomPath(dungeon: Dungeon): string[] {
  const start = dungeon.rooms.find((room) => room.kind === "start");
  const boss = dungeon.rooms.find((room) => room.kind === "boss");
  if (!start || !boss) throw new Error(`迷宫 ${dungeon.id} 缺少入口或 boss 房间`);
  const adjacency = adjacencyOf(dungeon);
  const previous = new Map<string, string | null>();
  const queue: string[] = [start.id];
  previous.set(start.id, null);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === boss.id) break;
    for (const next of adjacency.get(current) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(boss.id)) {
    throw new Error(`迷宫 ${dungeon.id} 的 boss 房间从入口不可达`);
  }
  const path: string[] = [];
  let cursor: string | null = boss.id;
  while (cursor) {
    path.push(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return path.reverse();
}

/** 校验并解析玩家选择的路径；不合法时抛出可读错误。 */
export function resolveRoomPath(dungeon: Dungeon, input?: string[]): DungeonRoom[] {
  const roomById = new Map(dungeon.rooms.map((room) => [room.id, room]));
  const start = dungeon.rooms.find((room) => room.kind === "start");
  if (!start) throw new Error(`迷宫 ${dungeon.id} 缺少入口房间`);
  const pathIds = input && input.length > 0 ? input : defaultRoomPath(dungeon);
  if (pathIds[0] !== start.id) throw new Error("路线必须从入口房间开始");
  if (new Set(pathIds).size !== pathIds.length) throw new Error("路线不能重复经过同一房间");
  if (pathIds.length < 2) throw new Error("路线不能只包含入口房间，至少要选择一个可探索的房间");
  const adjacency = adjacencyOf(dungeon);
  const rooms: DungeonRoom[] = [];
  for (let index = 0; index < pathIds.length; index += 1) {
    const room = roomById.get(pathIds[index]!);
    if (!room) throw new Error(`不存在房间 ${pathIds[index]}`);
    if (index > 0) {
      const previous = pathIds[index - 1]!;
      if (!(adjacency.get(previous) ?? []).includes(room.id)) {
        throw new Error(`房间 ${previous} 与 ${room.id} 之间没有通路`);
      }
    }
    if (room.kind === "boss" && index !== pathIds.length - 1) {
      throw new Error("boss 房间只能作为路线的最后一站");
    }
    rooms.push(room);
  }
  return rooms;
}

function spawnRoomMonsters(content: ContentPack, room: DungeonRoom): Combatant[] {
  const combatants: Combatant[] = [];
  for (const group of room.monsters) {
    const monster = content.monsters.find((row) => row.id === group.monsterId);
    if (!monster) throw new Error(`内容包中不存在怪物 ${group.monsterId}`);
    for (let i = 0; i < group.count; i += 1) {
      const displayName = group.count > 1 ? `${monster.name} ${i + 1}` : monster.name;
      const slot = combatants.length;
      const position = slot === 0 ? "front" : slot === 1 ? "flank" : "back";
      combatants.push(buildMonsterCombatant(content, monster, displayName, position));
    }
  }
  return combatants;
}

/** 越级惩罚：超过 2 级的等级差，怪物每级获得生命/伤害加成。 */
export const UNDERLEVEL_PRESSURE = {
  freeLevels: 2,
  hpPerLevel: 0.05,
  damagePerLevel: 0.12,
} as const;

/**
 * 按队伍平均等级与当前房间怪物等级施加越级压力。
 * 只按真实玩家英雄平均；NPC 支援不拉低平均等级（否则支援越多压力越大）。
 */
function applyUnderlevelPressure(
  heroes: Combatant[],
  monsterLevel: number,
  monsters: Combatant[],
): void {
  if (heroes.length === 0 || monsters.length === 0) return;
  const average = Math.floor(
    heroes.reduce((sum, hero) => sum + hero.level, 0) / heroes.length,
  );
  const gap = Math.max(
    0,
    monsterLevel - average - UNDERLEVEL_PRESSURE.freeLevels,
  );
  if (gap <= 0) return;
  const hpFactor = 1 + gap * UNDERLEVEL_PRESSURE.hpPerLevel;
  const damageFactor = 1 + gap * UNDERLEVEL_PRESSURE.damagePerLevel;
  for (const monster of monsters) {
    monster.maxHp = Math.round(monster.maxHp * hpFactor);
    monster.hp = monster.maxHp;
    monster.damageMultiplier *= damageFactor;
  }
}
function restParty(heroes: Combatant[], fieldRest: boolean): void {
  const hpRatio = fieldRest ? 0.25 : 0.15;
  const energyRatio = fieldRest ? 0.5 : 0.35;
  for (const hero of heroes) {
    hero.effects = [];
    hero.cooldowns = {};
    for (const ailment of AILMENTS) hero.ailments[ailment] = 0;
    if (hero.downed) continue;
    hero.hp = Math.min(hero.maxHp, hero.hp + Math.round(hero.maxHp * hpRatio));
    hero.energy = Math.min(
      hero.maxEnergy,
      hero.energy + Math.round(hero.maxEnergy * energyRatio),
    );
  }
}

function buildNpcSpecs(
  content: ContentPack,
  dungeon: Dungeon,
  npcIds: string[],
): HeroRunSpec[] {
  const seen = new Set<string>();
  return npcIds.flatMap((id) => {
    if (seen.has(id)) throw new Error(`NPC ${id} 不能重复`);
    seen.add(id);
    if (!dungeon.npcAssistIds.includes(id)) {
      throw new Error(`迷宫 ${dungeon.id} 不允许 NPC 支援 ${id}`);
    }
    const npc = content.npcs.find((row) => row.id === id);
    if (!npc) throw new Error(`内容包中不存在 NPC ${id}`);
    return [
      {
        id: npc.id,
        name: npc.name,
        level: npc.level,
        epEarned: 0,
        raceId: npc.raceId,
        weaponType: npc.weaponType,
        passiveSkillIds: [...npc.passiveSkillIds],
        skillLevels: { ...npc.skillLevels },
        position: npc.position,
        equipment: npc.equipment.map((templateId) => ({ templateId, affixes: [] })),
        potions: [],
      },
    ];
  });
}

export function simulateExpedition(
  content: ContentPack,
  request: ExpeditionRequest,
): ExpeditionEngineResult {
  const baseDungeon =
    request.dungeon ?? content.dungeons.find((row) => row.id === request.dungeonId);
  if (!baseDungeon) throw new Error(`内容包中不存在迷宫 ${request.dungeonId}`);
  if (request.heroes.length === 0) throw new Error("远征队伍至少需要一名英雄");
  const dungeon = request.edges ? { ...baseDungeon, edges: request.edges } : baseDungeon;

  const rooms = resolveRoomPath(dungeon, request.roomPath);
  const seed = request.seed ?? createSeed();
  const rng = new Rng(seed);
  const npcSpecs = buildNpcSpecs(content, dungeon, request.npcIds ?? []);
  const realHeroIds = new Set(request.heroes.map((spec) => spec.id));
  const heroes = [...request.heroes, ...npcSpecs].map((spec) =>
    buildHeroCombatant(content, spec),
  );

  // 亲和福利：按队伍成员过往与迷宫标签匹配。
  const perks = new Set<AffinityPerk>();
  const affinityLines: string[] = [];
  for (const spec of request.heroes) {
    const race = content.races.find((row) => row.id === spec.raceId);
    if (!race) continue;
    const perk = affinityPerkFor(race, dungeon.tags);
    if (!perk) continue;
    perks.add(perk);
    affinityLines.push(`${spec.name} 的过往亲和：${AFFINITY_PERK_LABELS[perk]}。`);
  }
  const everDowned = new Set<string>();

  const encounters: EncounterResult[] = [];
  const items: ItemRoll[] = [];
  let gold = 0;
  let ep = 0;
  let fame = 0;
  let allSelectedCleared = true;
  let roomsCleared = 0;
  let evacuated = false;
  // 战斗站号：入口/宝箱房不计站，"第 N 站"永远是第 N 场战斗。
  let battleIndex = 0;

  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index]!;
    const isLast = index === rooms.length - 1;
    // 入口房间不结算。
    if (room.kind === "start") continue;

    if (room.kind === "combat" || room.kind === "boss") {
      battleIndex += 1;
      for (const hero of heroes) {
        hero.settings = resolveFloorSettings(hero.baseSettings, battleIndex);
      }
    }

    if (room.kind === "treasure") {
      // 宝箱房没有遭遇，清空后直接获得掉落。
      roomsCleared += 1;
      const tableId = room.lootTableId;
      if (tableId) items.push(...rollLootTable(content, tableId, rng));
      if (room.gold) gold += rng.int(room.gold[0], room.gold[1]);
      if (!isLast) restParty(heroes, perks.has("field-rest"));
      continue;
    }

    const monsters = spawnRoomMonsters(content, room);
    // 只按真实玩家英雄（不含 NPC）平均等级、按当前房间怪物等级施加压力。
    const partyHeroes = heroes.filter((hero) => realHeroIds.has(hero.id));
    applyUnderlevelPressure(
      partyHeroes,
      roomMonsterLevel(content, room),
      monsters,
    );
    const prelude =
      battleIndex === 1 && affinityLines.length > 0
        ? affinityLines
        : battleIndex > 1
          ? ["队伍在阴影中短暂休整，恢复了部分生命与法力。"]
          : [];
    const result = simulateEncounter(heroes, monsters, rng, {
      name: room.name,
      description: room.description,
      levelNumber: battleIndex,
      prelude,
    });
    encounters.push(result);

    if (result.victory) {
      roomsCleared += 1;
      for (const group of room.monsters) {
        const monster = content.monsters.find((row) => row.id === group.monsterId);
        if (!monster) continue;
        ep += monster.xp * group.count;
        for (let i = 0; i < group.count; i += 1) {
          gold += rng.int(monster.gold[0], monster.gold[1]);
          if (monster.lootTableId) {
            items.push(...rollLootTable(content, monster.lootTableId, rng));
          }
        }
      }
      if (room.lootTableId) {
        items.push(...rollLootTable(content, room.lootTableId, rng));
      }
      if (room.gold) gold += rng.int(room.gold[0], room.gold[1]);
      // 熟路搜刮：每个清空的房间额外掷一次首个怪物的战利品表。
      if (perks.has("extra-loot")) {
        const firstMonster = room.monsters
          .map((group) =>
            content.monsters.find((row) => row.id === group.monsterId),
          )
          .find((monster) => Boolean(monster?.lootTableId));
        if (firstMonster?.lootTableId) {
          items.push(...rollLootTable(content, firstMonster.lootTableId, rng));
        }
      }
    } else {
      allSelectedCleared = false;
      // 战斗超时代表队伍主动撤出当前房间：保留已取得收益，不触发永久死亡。
      if (result.timeout) {
        evacuated = true;
        break;
      }
    }

    for (const hero of heroes) {
      if (hero.downed && realHeroIds.has(hero.id)) everDowned.add(hero.id);
    }

    if (!result.victory) break;

    // 撤离条件：任意角色在房间清空后达成 → 全员成功撤离（保留已得掉落，全员存活）。
    if (evaluateEvacuation(request.heroes, heroes, roomsCleared)) {
      evacuated = true;
      break;
    }

    if (!isLast) restParty(heroes, perks.has("field-rest"));
  }

  // 撤离（含 boss 房触发的自动撤离）不算线路全通：不发放通关奖励，不推进深层解锁。
  const routeCleared =
    !evacuated && allSelectedCleared && rooms[rooms.length - 1]?.kind === "boss";
  if (routeCleared) {
    ep += dungeon.completionReward.ep;
    fame += dungeon.completionReward.fame ?? 0;
    gold += rng.int(dungeon.completionReward.gold[0], dungeon.completionReward.gold[1]);
    if (dungeon.completionReward.lootTableId) {
      items.push(...rollLootTable(content, dungeon.completionReward.lootTableId, rng));
    }
  }

  // 主动撤离、超时撤退和完整通关都保留已取得物品；真正战败才丢失战利品。
  const keptItems = evacuated || allSelectedCleared ? items : [];

  const perHero: ExpeditionHeroResult[] = request.heroes.map((spec) => {
    const downed = everDowned.has(spec.id);
    // 战败时倒地者拿一半 EP；撤离视为全员被救回，拿全额。
    const epGained = Math.max(0, Math.round(ep * (evacuated ? 1 : downed ? 0.5 : 1)));
    const epEarnedAfter = spec.epEarned + epGained;
    return {
      heroId: spec.id,
      name: spec.name,
      downed,
      epGained,
      fromLevel: spec.level,
      toLevel: levelFromEp(epEarnedAfter),
      epEarnedAfter,
    };
  });


  const npcResults = npcSpecs.map((spec) => {
    const combatant = heroes.find((hero) => hero.id === spec.id);
    return {
      id: spec.id,
      name: spec.name,
      weaponType: spec.weaponType,
      position: spec.position ?? "front",
      downed: combatant?.downed ?? false,
    };
  });

  return {
    outcome: evacuated ? "evacuated" : allSelectedCleared ? "victory" : "defeat",
    seed,
    roomPath: rooms.map((room) => room.id),
    roomNames: rooms.map((room) => room.name),
    routeCleared,
    encounters,
    rewards: { gold, ep, fame, items: keptItems },
    perHero,
    ...(npcResults.length > 0 ? { npcs: npcResults } : {}),
    summary: {
      rounds: encounters.reduce((sum, encounter) => sum + encounter.rounds, 0),
      monstersSlain: computeMonstersSlain(rooms, encounters),
      survivors: heroes.filter(
        (hero) => realHeroIds.has(hero.id) && !hero.downed,
      ).length,
      floorsCleared: roomsCleared,
    },
  };
}

/** 已清房间内的怪物击杀数。 */
function computeMonstersSlain(
  rooms: DungeonRoom[],
  encounters: EncounterResult[],
): number {
  let slain = 0;
  let encounterIndex = 0;
  for (const room of rooms) {
    if (room.kind === "start" || room.kind === "treasure") continue;
    const result = encounters[encounterIndex];
    encounterIndex += 1;
    if (!result?.victory) continue;
    slain += room.monsters.reduce((count, group) => count + group.count, 0);
  }
  return slain;
}

/**
 * 撤离条件评估：在每次房间清空后调用。
 * 任意角色满足其战前配置中的撤离条件即返回 true（全员撤离）。
 */
function evaluateEvacuation(
  specs: HeroRunSpec[],
  combatants: Combatant[],
  roomsCleared: number,
): boolean {
  for (const spec of specs) {
    const rule = spec.settings?.evacuation;
    if (!rule) continue;
    const hero = combatants.find((row) => row.id === spec.id);
    if (!hero) continue;
    if (rule.type === "hp") {
      const ratio = (hero.hp / Math.max(1, hero.maxHp)) * 100;
      if (ratio < rule.value) return true;
    } else if (rule.type === "downed") {
      const downed = combatants.filter((row) => row.downed).length;
      if (downed >= rule.value) return true;
    } else if (rule.type === "rooms") {
      if (roomsCleared >= rule.value) return true;
    }
  }
  return false;
}
