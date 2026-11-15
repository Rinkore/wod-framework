import { loadContent, makeParty } from "./simulate.js";
import { defaultRoomPath, simulateExpedition } from "../packages/engine/src/expedition.js";
import { dungeonMonsterLevel } from "../packages/engine/src/threat.js";

const content = loadContent();
const RUNS = Number(process.argv[2] ?? 60);
const rows: Array<{ dungeon: string; level: number; minus2: number; minus5: number; avg2: number; avg5: number }> = [];

for (const dungeon of content.dungeons) {
  const dungeonLevel = Math.max(1, dungeonMonsterLevel(content, dungeon));
  const dungeonPath = defaultRoomPath(dungeon);
  const result: Record<number, { wins: number; rounds: number; power: number }> = {};
  for (const offset of [2, 5]) {
    const partyLevel = Math.max(1, dungeonLevel - offset);
    const party = makeParty(content, partyLevel, partyLevel, partyLevel);
    let wins = 0;
    let rounds = 0;
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const run = simulateExpedition(content, {
        dungeonId: dungeon.id,
        roomPath: dungeonPath,
        heroes: party,
        seed: seed * 7919,
      });
      if (run.outcome === "victory") wins += 1;
      rounds += run.summary.rounds;
    }
    result[offset] = { wins, rounds: rounds / RUNS, power: party[0]?.level ?? 0 };
  }
  rows.push({
    dungeon: `${dungeon.name} (Lv${dungeonLevel})`,
    level: dungeonLevel,
    minus2: (result[2]!.wins / RUNS) * 100,
    minus5: (result[5]!.wins / RUNS) * 100,
    avg2: result[2]!.rounds,
    avg5: result[5]!.rounds,
  });
}

console.log(["副本", "-2通过率", "-5通过率", "-2均回合", "-5均回合"].join("\t"));
for (const row of rows) {
  console.log(
    [
      row.dungeon,
      `${row.minus2.toFixed(0)}%`,
      `${row.minus5.toFixed(0)}%`,
      row.avg2.toFixed(1),
      row.avg5.toFixed(1),
    ].join("\t"),
  );
}
