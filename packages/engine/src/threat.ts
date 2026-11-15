import type { ContentPack, Dungeon, DungeonRoom } from "@wod/shared";

/** 玩家最多可以挑战高于自身等级多少级的迷宫怪物。 */
export const DUNGEON_LEVEL_TOLERANCE = 5;

/** 该房间怪物等级：取房间内所有怪物中的最高等级。 */
export function roomMonsterLevel(content: ContentPack, room: DungeonRoom): number {
  let level = 1;
  for (const group of room.monsters) {
    const monster = content.monsters.find((row) => row.id === group.monsterId);
    if (monster) level = Math.max(level, monster.level);
  }
  return level;
}

/** 路径怪物等级：取路径上各房间怪物等级的最高值。 */
export function pathMonsterLevel(
  content: ContentPack,
  dungeon: Dungeon,
  roomPath: string[],
): number {
  let level = 1;
  for (const roomId of roomPath) {
    const room = dungeon.rooms.find((row) => row.id === roomId);
    if (room) level = Math.max(level, roomMonsterLevel(content, room));
  }
  return level;
}

/** 迷宫怪物等级：取所有房间中的最高怪物等级。 */
export function dungeonMonsterLevel(content: ContentPack, dungeon: Dungeon): number {
  return dungeon.rooms.reduce(
    (level, room) => Math.max(level, roomMonsterLevel(content, room)),
    1,
  );
}

/** 队伍平均等级 + 容差是否足以挑战该层怪物。 */
export function canChallengeMonsterLevel(
  partyLevel: number,
  monsterLevel: number,
): boolean {
  return partyLevel + DUNGEON_LEVEL_TOLERANCE >= monsterLevel;
}
