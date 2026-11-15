import fs from "node:fs";
const path = "content/monsters.json";
const monsters = JSON.parse(fs.readFileSync(path, "utf8"));
for (const m of monsters) {
  if (m.level >= 8 && m.level <= 10) {
    m.hpMultiplier = Math.round(m.hpMultiplier * 0.85 * 100) / 100;
    m.damageMultiplier = Math.round(m.damageMultiplier * 0.9 * 100) / 100;
  }
}
fs.writeFileSync(path, JSON.stringify(monsters, null, 2) + "\n", "utf8");
console.log("done");
