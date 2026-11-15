// 平衡调参:削减 8 级以上怪物的伤害/生命倍率,补偿英雄失去装备属性后的强度(一次性,可删)
import fs from "node:fs";

const path = "content/monsters.json";
const monsters = JSON.parse(fs.readFileSync(path, "utf8"));

for (const monster of monsters) {
  if (monster.level >= 8 && monster.level < 12) {
    monster.hpMultiplier = Math.round(monster.hpMultiplier * 0.85 * 100) / 100;
  } else if (monster.level >= 12 && monster.level < 16) {
    monster.damageMultiplier = Math.round(monster.damageMultiplier * 0.7 * 100) / 100;
    monster.hpMultiplier = Math.round(monster.hpMultiplier * 0.85 * 100) / 100;
  } else if (monster.level >= 16) {
    monster.damageMultiplier = Math.round(monster.damageMultiplier * 1.3 * 100) / 100;
    monster.hpMultiplier = Math.round(monster.hpMultiplier * 0.9 * 100) / 100;
  }
}

fs.writeFileSync(path, JSON.stringify(monsters, null, 2) + "\n", "utf8");
console.log("怪物平衡调整完成");
