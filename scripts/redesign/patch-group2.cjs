// 一次性补丁:GroupPage 队列界面改为迷宫。可删。
const fs = require("fs");
const p = "apps/web/src/pages/GroupPage.tsx";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const pairs = [
  [
`                        {row.name} · 怪物等级 {dungeonMonsterLevel(content, row)} ·{" "}
                        {row.routes.length} 条线路`,
`                        {row.name} · 怪物等级 {dungeonMonsterLevel(content, row)} ·{" "}
                        {row.rooms.length} 个房间`,
  ],
  [
`                {selectedDungeon && selectedRoute ? (
                  <>
                    <label className="field">
                      <span>线路</span>
                      <select
                        value={selectedRoute.id}
                        onChange={(event) => {
                          const next = selectedDungeon.routes.find(
                            (row) => row.id === event.target.value,
                          );
                          if (next) changeRoute(next);
                        }}
                        disabled={!isLeader}
                      >
                        {selectedDungeon.routes.map((row) => (
                          <option key={row.id} value={row.id}>
                            {ROUTE_KIND_LABEL[row.kind]} · {row.name} · {row.encounters.length}{" "}
                            层 · 怪物 Lv{routeMonsterLevel(content, row)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="group-dungeon-info">
                      <span>
                        <Map size={14} /> {selectedRoute.encounters.length} 层
                      </span>
                      <span>怪物 Lv{routeMonsterLevel(content, selectedRoute)}</span>
                      <span>{selectedRoute.rewards.ep} 经验点</span>
                      <span>
                        {selectedRoute.rewards.gold[0]}–{selectedRoute.rewards.gold[1]} 金币
                      </span>
                      <span>{dungeonScheduleLabel(selectedDungeon)}</span>
                    </div>
                    <div className="depth-picker group-depth-picker">
                      {selectedRoute.encounters.map((encounter, index) => {
                        const value = index + 1;
                        const monsterLevel = encounterMonsterLevel(content, encounter);
                        const met = value <= maxEligibleDepth;
                        return (
                          <button
                            key={\`\${selectedRoute.id}-\${value}\`}
                            type="button"
                            className={cx(
                              "depth-chip",
                              value === depth && "depth-chip-active",
                              !met && "depth-chip-locked",
                            )}
                            disabled={!isLeader || !met}
                            onClick={() => setDepth(value)}
                            title={encounter.name}
                          >
                            <strong>
                              第 {value} 层
                              {value === selectedRoute.encounters.length ? " · 全通" : ""}
                            </strong>
                            <span>
                              怪物 Lv{monsterLevel} · 战力 {encounter.monsterPower}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div
                      className={cx(
                        "notice",
                        depth === selectedRoute.encounters.length
                          ? "notice-success"
                          : "notice-warn",
                      )}
                    >
                      队伍平均等级 Lv{averageLevel} · 目标第 {depth} 层。
                      {depth === selectedRoute.encounters.length
                        ? " 全通可获得线路完成奖励。"
                        : " 提前收队保留已清层掉落，但没有全通奖励。"}
                    </div>
                  </>
                ) : null}
                {selectedDungeon && !isDungeonOpen(selectedDungeon) ? (
                  <div className="notice notice-error">该预约地牢当前未开放。</div>
                ) : null}
                {selectedRoute && selectedRoute.encounters.length > 0 && !selectedDepthEligible && group.heroes.length > 0 ? (
                  <div className="notice notice-error">
                    当前队伍平均等级 Lv{averageLevel}，第 {depth} 层怪物 Lv
                    {currentMonsterLevel}，超出可挑战范围（最多可高于队伍平均等级{" "}
                    {DUNGEON_LEVEL_TOLERANCE} 级）。请降低深度或提升英雄等级。
                  </div>
                ) : null}`,
`                {selectedDungeon ? (
                  <>
                    <div className="group-dungeon-info">
                      <span>
                        <Map size={14} /> {orderedPathRooms.length} 站
                      </span>
                      <span>路线最高怪物 Lv{maxPathLevel}</span>
                      <span>{selectedDungeon.completionReward.ep} 经验点</span>
                      <span>
                        {selectedDungeon.completionReward.gold[0]}–
                        {selectedDungeon.completionReward.gold[1]} 金币
                      </span>
                      <span>{dungeonScheduleLabel(selectedDungeon)}</span>
                    </div>
                    <MazeMap
                      dungeon={selectedDungeon}
                      path={roomPath}
                      onChange={setRoomPath}
                      partyLevel={averageLevel}
                      compact={!isLeader}
                    />
                    <div className={cx("notice", pathFullClear ? "notice-success" : "notice-warn")}>
                      队伍平均等级 Lv{averageLevel} · 路线 {orderedPathRooms.length} 站
                      （终点 {orderedPathRooms[orderedPathRooms.length - 1]?.name ?? "?"}）。
                      {pathFullClear
                        ? " 全通可获得副本通关奖励。"
                        : " 提前收队保留已得掉落，但没有全通奖励。"}
                    </div>
                  </>
                ) : null}
                {selectedDungeon && !isDungeonOpen(selectedDungeon) ? (
                  <div className="notice notice-error">该预约地牢当前未开放。</div>
                ) : null}
                {selectedDungeon && pathMonsterLevels.length > 0 && !selectedDepthEligible && group.heroes.length > 0 ? (
                  <div className="notice notice-error">
                    当前队伍平均等级 Lv{averageLevel}，路线最高怪物 Lv{maxPathLevel}，
                    超出可挑战范围（最多可高于队伍平均等级 {DUNGEON_LEVEL_TOLERANCE}{" "}
                    级）。请换一条路线或提升英雄等级。
                  </div>
                ) : null}`,
  ],
  [
`                          已通知 <strong>{queue.dungeonName}</strong> · {queue.routeName} · 第{" "}
                          {queue.depth} 层 — 已准备 {readyCount}/{otherMembers.length}`,
`                          已通知 <strong>{queue.dungeonName}</strong> ·{" "}
                          {queue.roomNames.join(" → ")} — 已准备 {readyCount}/{otherMembers.length}`,
  ],
];
for (const [a, b] of pairs) {
  if (!s.includes(a)) console.log("MISS:", a.split("\n")[0].slice(0, 60));
  s = s.replace(a, b);
}
// 剩余 queue?.depth 引用
s = s.split("queue?.depth").join("queue?.roomNames.length");
fs.writeFileSync(p, s);
console.log("group jsx patched");
