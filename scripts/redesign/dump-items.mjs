// 临时检视脚本:输出装备模板概要(重做期间用,可删)
import fs from "node:fs";

const items = JSON.parse(fs.readFileSync("content/items.json", "utf8"));
for (const it of items) {
  if (it.kind !== "equipment") continue;
  const st = it.stats ? Object.entries(it.stats).map(([k, v]) => k + v).join("/") : "";
  console.log(
    [
      it.id,
      it.slot,
      it.rarity,
      "lv" + it.level,
      "val" + it.value,
      it.weaponType || "",
      it.weaponDamage ? "wd" + it.weaponDamage : "",
      it.damageType || "",
      it.armor ? "ar" + it.armor : "",
      st,
    ].join(" | "),
  );
}
console.log("--- materials/consumables ---");
for (const it of items) {
  if (it.kind === "equipment") continue;
  console.log(it.id, "|", it.slot, "|", it.kind, "| lv" + it.level, "|", it.name);
}
