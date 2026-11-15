import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  contentPackSchema,
  skillTreeNodesForWeapon,
  validateContent,
  weaponPath,
  type ContentPack,
  type WeaponType,
} from "@wod/shared";
import { epForLevel } from "../src/progression.js";
import type { HeroRunSpec } from "../src/stats.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const contentDir = path.join(root, "content");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(contentDir, name), "utf8")) as T;
}

export function loadTestContent(): ContentPack {
  const meta = readJson<Record<string, unknown>>("pack.json");
  const pack = contentPackSchema.parse({
    ...meta,
    races: readJson("races.json"),
    weapons: readJson("weapons.json"),
    skillTrees: readJson("skill-trees.json"),
    skills: readJson("skills.json"),
    items: readJson("items.json"),
    affixes: readJson("affixes.json"),
    monsters: readJson("monsters.json"),
    lootTables: readJson("loot-tables.json"),
    npcs: readJson("npcs.json"),
    titles: readJson("titles.json"),
    quests: readJson("quests.json"),
    dungeons: readJson("dungeons.json"),
  });
  const errors = validateContent(pack);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return pack;
}

export const PARTY_WEAPONS: WeaponType[] = ["sword", "bow", "staff", "book", "dagger", "instrument"];

const RACE_BY_WEAPON: Record<WeaponType, string> = {
  sword: "borderlander",
  axe: "targeshian",
  hammer: "dinturan",
  bow: "woodlander",
  dagger: "targeshian",
  staff: "partan",
  book: "dinturan",
  instrument: "halfling",
};

export function makeParty(content: ContentPack, level: number): HeroRunSpec[] {
  return PARTY_WEAPONS.flatMap((weaponType) => {
    const path = weaponPath(content, weaponType);
    if (!path) return [];
    const raceId = RACE_BY_WEAPON[weaponType] ?? "borderlander";
    const skillLevels: Record<string, number> = {
      "basic-attack": 1,
      "power-attack": 1,
    };
    for (const node of skillTreeNodesForWeapon(content, weaponType)) {
      skillLevels[node.id] = 1;
    }
    return [
      {
        id: `hero-${weaponType}`,
        name: `测试${path.name}`,
        level,
        epEarned: epForLevel(level),
        raceId,
        weaponType,
        skillLevels,
        equipment: path.startingItemIds.map((templateId) => ({ templateId, affixes: [] })),
        settings: undefined,
      },
    ];
  });
}
