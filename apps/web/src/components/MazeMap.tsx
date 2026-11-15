import { useMemo } from "react";
import {
  DAMAGE_TYPE_LABELS,
  ROOM_KIND_LABELS,
  type Dungeon,
  type DungeonRoom,
} from "@wod/shared";
import { roomMonsterLevel } from "@wod/engine";
import { useContent } from "../context";
import { cx } from "./ui";

/** 入口到 boss 的最短通路（与引擎一致的 BFS）。 */
export function defaultPathFor(dungeon: Dungeon): string[] {
  const start = dungeon.rooms.find((room) => room.kind === "start");
  const boss = dungeon.rooms.find((room) => room.kind === "boss");
  if (!start || !boss) return dungeon.rooms.map((room) => room.id);
  const adjacency = new Map<string, string[]>();
  for (const room of dungeon.rooms) adjacency.set(room.id, []);
  for (const [a, b] of dungeon.edges) {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  const previous = new Map<string, string | null>();
  const queue = [start.id];
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
  if (!previous.has(boss.id)) return [start.id];
  const path: string[] = [];
  let cursor: string | null = boss.id;
  while (cursor) {
    path.push(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return path.reverse();
}

/** 校验路径是否合法（与服务器同规则，用于本地 UI 预判）。 */
export function isPathValid(dungeon: Dungeon, path: string[]): boolean {
  const roomById = new Map(dungeon.rooms.map((room) => [room.id, room]));
  const start = dungeon.rooms.find((room) => room.kind === "start");
  if (!start || path.length === 0 || path[0] !== start.id) return false;
  if (new Set(path).size !== path.length) return false;
  const adjacency = new Map<string, string[]>();
  for (const room of dungeon.rooms) adjacency.set(room.id, []);
  for (const [a, b] of dungeon.edges) {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  for (let index = 0; index < path.length; index += 1) {
    const room = roomById.get(path[index]!);
    if (!room) return false;
    if (index > 0 && !(adjacency.get(path[index - 1]!) ?? []).includes(room.id)) return false;
    if (room.kind === "boss" && index !== path.length - 1) return false;
  }
  return true;
}

/** 路径上可判断的房间时长合计（秒，入口不计时）。 */
export function pathDuration(dungeon: Dungeon, path: string[]): number {
  return path.reduce((sum, roomId, index) => {
    if (index === 0) return sum;
    const room = dungeon.rooms.find((row) => row.id === roomId);
    return sum + (room?.durationSeconds ?? dungeon.roomSeconds);
  }, 0);
}

function roomSummary(room: DungeonRoom, content: ReturnType<typeof useContent>): string {
  if (room.monsters.length === 0) {
    return room.kind === "start" ? "安全入口" : "无遭遇 · 可直接搜刮";
  }
  return room.monsters
    .map((group) => {
      const monster = content.monsters.find((row) => row.id === group.monsterId);
      const name = monster?.name ?? group.monsterId;
      const label = monster?.skillIds
        .map((id) => content.skills.find((skill) => skill.id === id)?.damageType)
        .filter(Boolean)[0];
      const type = label ? `（${DAMAGE_TYPE_LABELS[label]}）` : "";
      return `${name}${type}×${group.count}`;
    })
    .join(" · ");
}

export function MazeMap({
  dungeon,
  path,
  onChange,
  partyLevel,
  compact = false,
  readOnly = false,
}: {
  dungeon: Dungeon;
  path: string[];
  onChange: (path: string[]) => void;
  /** 队伍平均等级；低于怪物等级 5 级以上时房间会标记为不可挑战。 */
  partyLevel?: number;
  compact?: boolean;
  /** 只读查看：不能修改路线。 */
  readOnly?: boolean;
}) {
  const content = useContent();
  const maxX = Math.max(...dungeon.rooms.map((room) => room.x), 0);
  const maxY = Math.max(...dungeon.rooms.map((room) => room.y), 0);
  const cols = maxX + 1;
  const rows = maxY + 1;
  const roomById = useMemo(
    () => new Map(dungeon.rooms.map((room) => [room.id, room])),
    [dungeon],
  );
  const adjacency = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const room of dungeon.rooms) map.set(room.id, []);
    for (const [a, b] of dungeon.edges) {
      map.get(a)?.push(b);
      map.get(b)?.push(a);
    }
    return map;
  }, [dungeon]);
  const pathSet = new Set(path);
  const lastRoom = path.length > 0 ? roomById.get(path[path.length - 1]!) : undefined;
  const nextOptions = new Set(lastRoom ? (adjacency.get(lastRoom.id) ?? []) : []);
  const usedEdges = new Set<string>();
  for (let index = 1; index < path.length; index += 1) {
    usedEdges.add(`${path[index - 1]}|${path[index]}`);
    usedEdges.add(`${path[index]}|${path[index - 1]}`);
  }

  function handleClick(room: DungeonRoom) {
    if (readOnly) return;
    if (path.length > 0 && path[path.length - 1] === room.id) {
      onChange(path.slice(0, -1));
      return;
    }
    if (pathSet.has(room.id)) return;
    if (!nextOptions.has(room.id)) return;
    if (room.kind === "boss" && room.id !== dungeon.rooms.find((row) => row.kind === "boss")?.id) {
      return;
    }
    onChange([...path, room.id]);
  }

  return (
    <div className={cx("maze-wrap", compact && "maze-compact")}>
      <div className="maze-board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, auto)` }}>
        <svg className="maze-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {dungeon.edges.map(([a, b]) => {
            const ra = roomById.get(a);
            const rb = roomById.get(b);
            if (!ra || !rb) return null;
            const x1 = ((ra.x + 0.5) / cols) * 100;
            const y1 = ((ra.y + 0.5) / rows) * 100;
            const x2 = ((rb.x + 0.5) / cols) * 100;
            const y2 = ((rb.y + 0.5) / rows) * 100;
            const used = usedEdges.has(`${a}|${b}`);
            return (
              <line
                key={`${a}-${b}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={used ? "maze-edge-used" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {dungeon.rooms.map((room) => {
          const level = room.monsters.length > 0 ? roomMonsterLevel(content, room) : 0;
          const pathIndex = path.indexOf(room.id);
          const reachable = nextOptions.has(room.id) || pathIndex >= 0;
          const locked =
            partyLevel !== undefined &&
            room.monsters.length > 0 &&
            level > partyLevel + 5;
          return (
            <div
              key={room.id}
              className="maze-cell"
              style={{ gridColumn: room.x + 1, gridRow: room.y + 1 }}
            >
              <button
                type="button"
                className={cx(
                  "maze-room",
                  `maze-room-${room.kind}`,
                  pathIndex >= 0 && "maze-room-in-path",
                  reachable && pathIndex < 0 && !readOnly && "maze-room-reachable",
                  locked && "maze-room-locked",
                )}
                disabled={readOnly}
                onClick={() => handleClick(room)}
                title={
                  room.description ??
                  `${ROOM_KIND_LABELS[room.kind]} · ${room.name}`
                }
              >
                <span className="maze-room-head">
                  <span className={`maze-kind maze-kind-${room.kind}`}>{ROOM_KIND_LABELS[room.kind]}</span>
                  {pathIndex >= 0 ? <span className="maze-step">{pathIndex + 1}</span> : null}
                </span>
                <strong>{room.name}</strong>
                {!compact ? <span className="maze-monsters">{roomSummary(room, content)}</span> : null}
                <span className="maze-meta">
                  {room.monsters.length > 0 ? `Lv${level} · 战力 ${room.monsterPower}` : "无战斗"}
                  {room.lootTableId ? " · 有物资" : ""}
                  {locked ? " · 等级不足" : ""}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="maze-pathbar">
        <div className="maze-path-chips">
          {path.map((roomId, index) => {
            const room = roomById.get(roomId);
            return (
              <span key={`${roomId}-${index}`} className="maze-path-chip">
                {index + 1}. {room?.name ?? roomId}
              </span>
            );
          })}
        </div>
        {readOnly ? null : (
          <div className="maze-path-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={path.length <= 1}
              onClick={() => onChange(path.slice(0, -1))}
            >
              撤回
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onChange(defaultPathFor(dungeon))}
            >
              最短通路
            </button>
          </div>
        )}
      </div>
      {readOnly ? null : (
        <p className="maze-hint">
          点击相邻房间延伸路线，终点可以是 boss(全通)或任意房间(提前收队)。所有房间信息均已展示。
        </p>
      )}
    </div>
  );
}
