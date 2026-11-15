// 一次性补丁:GroupPage 改为迷宫路径。可删。
const fs = require("fs");
const p = "apps/web/src/pages/GroupPage.tsx";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const pairs = [
  [
`import {
  dungeonScheduleLabel,
  formatDuration,
  isDungeonOpen,
  type ContentPack,
  type DungeonRoute,
  type GroupHeroView,
  type HeroCombatSettings,
  type GroupView,
  type Position,
} from "@wod/shared";
import {
  DUNGEON_LEVEL_TOLERANCE,
  canChallengeMonsterLevel,
  dungeonMonsterLevel,
  encounterMonsterLevel,
  routeMonsterLevel,
} from "@wod/engine";`,
`import {
  dungeonScheduleLabel,
  formatDuration,
  isDungeonOpen,
  type GroupHeroView,
  type HeroCombatSettings,
  type GroupView,
  type Position,
} from "@wod/shared";
import {
  DUNGEON_LEVEL_TOLERANCE,
  canChallengeMonsterLevel,
  dungeonMonsterLevel,
  roomMonsterLevel,
} from "@wod/engine";
import { MazeMap, defaultPathFor, isPathValid } from "../components/MazeMap";`,
  ],
  [
`const ROUTE_KIND_LABEL: Record<DungeonRoute["kind"], string> = {
  boss: "讨伐",
  alchemy: "炼金支线",
  forge: "锻造支线",
};

function groupAverageLevel(heroes: GroupHeroView[]): number {
  if (heroes.length === 0) return 0;
  return Math.floor(heroes.reduce((sum, hero) => sum + hero.level, 0) / heroes.length);
}

function deepestEligibleDepth(
  heroes: GroupHeroView[],
  route: DungeonRoute,
  content: ContentPack,
): number {
  const level = groupAverageLevel(heroes);
  let depth = 0;
  for (let index = 0; index < route.encounters.length; index += 1) {
    const monsterLevel = encounterMonsterLevel(content, route.encounters[index]!);
    if (canChallengeMonsterLevel(level, monsterLevel)) {
      depth = index + 1;
    } else {
      break;
    }
  }
  return depth;
}`,
`function groupAverageLevel(heroes: GroupHeroView[]): number {
  if (heroes.length === 0) return 0;
  return Math.floor(heroes.reduce((sum, hero) => sum + hero.level, 0) / heroes.length);
}`,
  ],
  [
`  const [dungeonId, setDungeonId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [depth, setDepth] = useState(1);`,
`  const [dungeonId, setDungeonId] = useState("");
  const [roomPath, setRoomPath] = useState<string[]>([]);`,
  ],
  [
`  useEffect(() => {
    const targetDungeon = content.dungeons.find((row) => row.id === dungeonId);
    if (!targetDungeon) return;
    const remembered = preferences[targetDungeon.id];
    const nextRoute =
      targetDungeon.routes.find((row) => row.id === routeId) ??
      targetDungeon.routes.find((row) => row.id === remembered) ??
      targetDungeon.routes.find((row) => row.kind === "boss") ??
      targetDungeon.routes[0]!;
    if (nextRoute.id !== routeId) setRouteId(nextRoute.id);
    const maxDepth = deepestEligibleDepth(group?.heroes ?? [], nextRoute, content);
    setDepth((current) => Math.max(1, Math.min(current, maxDepth || 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeonId, routeId, group?.heroes, content.dungeons, preferences]);`,
`  useEffect(() => {
    const targetDungeon = content.dungeons.find((row) => row.id === dungeonId);
    if (!targetDungeon) return;
    const remembered = preferences[targetDungeon.id] as string[] | undefined;
    setRoomPath(
      remembered && isPathValid(targetDungeon, remembered)
        ? remembered
        : defaultPathFor(targetDungeon),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeonId, content.dungeons]);`,
  ],
  [
`  const selectedDungeon = content.dungeons.find((row) => row.id === dungeonId);
  const selectedRoute = selectedDungeon
    ? (selectedDungeon.routes.find((row) => row.id === routeId) ??
      selectedDungeon.routes.find((row) => row.kind === "boss") ??
      selectedDungeon.routes[0])
    : null;
  const averageLevel = groupAverageLevel(group.heroes);
  const currentEncounter = selectedRoute?.encounters[depth - 1];
  const currentMonsterLevel = currentEncounter
    ? encounterMonsterLevel(content, currentEncounter)
    : 0;
  const maxEligibleDepth = selectedRoute
    ? deepestEligibleDepth(group.heroes, selectedRoute, content)
    : 0;
  const selectedDepthEligible = Boolean(
    selectedRoute && currentEncounter && depth <= maxEligibleDepth,
  );`,
`  const selectedDungeon = content.dungeons.find((row) => row.id === dungeonId);
  const orderedPathRooms = roomPath.flatMap(
    (roomId) => selectedDungeon?.rooms.filter((room) => room.id === roomId) ?? [],
  );
  const averageLevel = groupAverageLevel(group.heroes);
  const pathMonsterLevels = orderedPathRooms
    .filter((room) => room.monsters.length > 0)
    .map((room) => roomMonsterLevel(content, room));
  const maxPathLevel = pathMonsterLevels.length > 0 ? Math.max(...pathMonsterLevels) : 0;
  const selectedDepthEligible = Boolean(
    selectedDungeon &&
      isPathValid(selectedDungeon, roomPath) &&
      pathMonsterLevels.every((level) => canChallengeMonsterLevel(averageLevel, level)),
  );
  const pathFullClear =
    orderedPathRooms[orderedPathRooms.length - 1]?.kind === "boss";`,
  ],
  [
`  const queueMatchesSelection =
    queue != null &&
    selectedDungeon != null &&
    queue.dungeonId === selectedDungeon.id &&
    queue.routeId === selectedRoute?.id &&
    queue.depth === depth;`,
`  const queueMatchesSelection =
    queue != null &&
    selectedDungeon != null &&
    queue.dungeonId === selectedDungeon.id &&
    queue.roomPath.length === roomPath.length &&
    queue.roomPath.every((roomId, index) => roomId === roomPath[index]);`,
  ],
  [
`    queueIsCurrent &&
    allMembersReady &&
    Boolean(selectedDungeon && selectedRoute && isDungeonOpen(selectedDungeon));`,
`    queueIsCurrent &&
    allMembersReady &&
    Boolean(selectedDungeon && isDungeonOpen(selectedDungeon));`,
  ],
  [
`  function notifyQueue() {
    if (!group || !selectedDungeon || !selectedRoute) return;
    void act(
      "queue",
      async () => {
        const data = await api.queueGroupExpedition(group.id, {
          dungeonId: selectedDungeon.id,
          routeId: selectedRoute.id,
          depth,
        });
        groupQ.setData(data.group);
        setNotice(
          \`已通知队友：\${selectedDungeon.name} · \${selectedRoute.name} · 第 \${depth} 层。等待全员准备后即可出发。\`,
        );
      },
    );
  }`,
`  function notifyQueue() {
    if (!group || !selectedDungeon) return;
    void act(
      "queue",
      async () => {
        const data = await api.queueGroupExpedition(group.id, {
          dungeonId: selectedDungeon.id,
          roomPath,
        });
        groupQ.setData(data.group);
        setNotice(
          \`已通知队友：\${selectedDungeon.name} · \${orderedPathRooms
            .map((room) => room.name)
            .join(" → ")}。等待全员准备后即可出发。\`,
        );
      },
    );
  }`,
  ],
  [
`  function changeDungeon(nextId: string) {
    const next = content.dungeons.find((row) => row.id === nextId);
    setDungeonId(nextId);
    if (!next) {
      setRouteId("");
      setDepth(1);
      return;
    }
    const nextRoute =
      next.routes.find((row) => row.id === preferences[next.id]) ??
      next.routes.find((row) => row.kind === "boss") ??
      next.routes[0]!;
    setRouteId(nextRoute.id);
    setDepth(Math.max(1, deepestEligibleDepth(group?.heroes ?? [], nextRoute, content)));
  }

  function changeRoute(nextRoute: DungeonRoute) {
    setRouteId(nextRoute.id);
    setDepth(Math.max(1, deepestEligibleDepth(group?.heroes ?? [], nextRoute, content)));
  }`,
`  function changeDungeon(nextId: string) {
    const next = content.dungeons.find((row) => row.id === nextId);
    setDungeonId(nextId);
    if (!next) {
      setRoomPath([]);
      return;
    }
    const remembered = preferences[next.id] as string[] | undefined;
    setRoomPath(
      remembered && isPathValid(next, remembered) ? remembered : defaultPathFor(next),
    );
  }`,
  ],
];

for (const [a, b] of pairs) {
  if (!s.includes(a)) console.log("MISS:", a.split("\n")[0].slice(0, 60));
  s = s.replace(a, b);
}
fs.writeFileSync(p, s);
console.log("group part1 patched");
