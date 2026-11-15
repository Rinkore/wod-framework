import type { Dungeon } from "@wod/shared";
import { Rng } from "./rng.js";

export const PERSONAL_MAZE_GENERATOR_VERSION = 1;

export interface PersonalMazeRegion {
  ownerKey: string;
  seriesId: string;
  depth: number;
  seed: number;
  generatorVersion: number;
  sourceDungeonId: string;
  dungeon: Dungeon;
}

/**
 * Build a personalized, connected topology from a balanced content template.
 * Room encounters and rewards are copied unchanged, so layout variance does
 * not silently change the region's combat or reward budget.
 */
export function generatePersonalMazeRegion(
  template: Dungeon,
  ownerKey: string,
  depth: number,
  seed: number,
): PersonalMazeRegion {
  if (!template.seriesId) throw new Error("个人迷宫模板必须属于一个系列");
  if (!Number.isInteger(depth) || depth < 0) throw new Error("个人迷宫深度必须是非负整数");

  const rng = new Rng(seed);
  const roomIds = new Set(template.rooms.map((room) => room.id));
  const parent = new Map<string, string>(template.rooms.map((room) => [room.id, room.id]));
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current) throw new Error(`迷宫连接引用了未知房间 ${id}`);
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const edges = rng.shuffle(template.edges);
  const connected: Array<[string, string]> = [];
  const rejected: Array<[string, string]> = [];

  for (const [a, b] of edges) {
    if (!roomIds.has(a) || !roomIds.has(b) || a === b) {
      throw new Error(`迷宫连接无效: ${a} -> ${b}`);
    }
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) {
      rejected.push([a, b]);
      continue;
    }
    parent.set(rootA, rootB);
    connected.push([a, b]);
  }

  if (connected.length !== template.rooms.length - 1) {
    throw new Error("个人迷宫模板必须是连通图");
  }

  // Keep at most one alternate route, bounding path choice and travel time.
  const loop = rejected.length > 0 && rng.chance(0.5) ? [rng.pick(rejected)] : [];
  const prefix = `pm-${template.seriesId}-d${depth}`;
  const roomId = new Map(template.rooms.map((room) => [room.id, `${prefix}-${room.id}`]));
  const dungeon: Dungeon = {
    ...template,
    id: prefix,
    name: `${template.name} · 第 ${depth + 1} 区`,
    subtitle: "依照你的探索记录展开的迷宫区域",
    depth,
    rooms: template.rooms.map((room) => ({
      ...room,
      id: roomId.get(room.id)!,
      monsters: room.monsters.map((group) => ({ ...group })),
      ...(room.gold ? { gold: [...room.gold] as [number, number] } : {}),
    })),
    edges: [...connected, ...loop].map(([a, b]) => [roomId.get(a)!, roomId.get(b)!]),
  };

  return {
    ownerKey,
    seriesId: template.seriesId,
    depth,
    seed: seed >>> 0,
    generatorVersion: PERSONAL_MAZE_GENERATOR_VERSION,
    sourceDungeonId: template.id,
    dungeon,
  };
}
