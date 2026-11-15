import { dungeonMonsterLevel, roomMonsterLevel } from "@wod/engine";

export {};

try {
  const { content } = await import("./content.js");
  console.log(`内容包：${content.name}（${content.id}）v${content.version}`);
  console.log(
    [
      `过往 ${content.races.length}`,
      `武器 ${content.weapons.length}`,
      `技能 ${content.skills.length}`,
      `装备 ${content.items.length}`,
      `怪物 ${content.monsters.length}`,
      `NPC ${content.npcs.length}`,
      `称号 ${content.titles.length}`,
      `任务 ${content.quests.length}`,
      `迷宫 ${content.dungeons.length}`,
    ].join(" · "),
  );
  for (const dungeon of content.dungeons) {
    const npcNote =
      dungeon.npcAssistIds.length > 0
        ? `，NPC 支援 [${dungeon.npcAssistIds.join(", ")}]`
        : "";
    console.log(
      `  - ${dungeon.name}：怪物 Lv${dungeonMonsterLevel(content, dungeon)}${npcNote}`,
    );
    for (const room of dungeon.rooms) {
      const monsters = room.monsters.map((group) => `${group.monsterId}×${group.count}`);
      console.log(
        `    · ${room.name}（${room.kind}）Lv${roomMonsterLevel(content, room)}/战力${room.monsterPower} [${monsters.join(", ")}]`,
      );
    }
  }
  console.log("内容校验通过。");
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
