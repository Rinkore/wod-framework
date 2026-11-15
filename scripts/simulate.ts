import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  heroCanUseItem,
  checkSkillNodeUnlock,
  contentPackSchema,
  skillPointsTotal,
  skillTreeNodesForWeapon,
  validateContent,
  weaponPath,
  type ContentPack,
  type ItemTemplate,
  type WeaponType,
} from "@wod/shared";
import { defaultRoomPath, simulateExpedition } from "../packages/engine/src/expedition.js";
import { computeHeroPower, partyAverage } from "../packages/engine/src/power.js";
import { pathMonsterLevel } from "../packages/engine/src/threat.js";
import {
  MAX_LEVEL,
  MAX_SKILL_LEVEL,
  epForLevel,
} from "../packages/engine/src/progression.js";
import type { HeroRunSpec } from "../packages/engine/src/stats.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(root, "content");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(contentDir, name), "utf8"));
}

export function loadContent(): ContentPack {
  const meta = readJson("pack.json") as Record<string, unknown>;
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
  if (errors.length > 0) throw new Error(`内容校验失败:\n${errors.join("\n")}`);
  return pack;
}

const PARTY_WEAPONS: WeaponType[] = ["sword", "bow", "staff", "book", "dagger", "instrument"];
const SLOT_ORDER = ["weapon", "armor", "trinket"] as const;

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

const POSITION_BY_WEAPON: Record<WeaponType, "front" | "flank" | "back"> = {
  sword: "front",
  axe: "front",
  hammer: "front",
  bow: "back",
  dagger: "front",
  staff: "back",
  book: "back",
  instrument: "back",
};

function itemScore(item: ItemTemplate, slot: (typeof SLOT_ORDER)[number]): number {
  const modifierScore = item.modifiers.reduce(
    (sum, row) => sum + Math.abs(row.amount) * 2,
    0,
  );
  const effectScore = item.effects.length * 20;
  if (slot === "weapon") return (item.weaponDamage ?? 0) * 3 + modifierScore + effectScore;
  if (slot === "armor") return (item.armor ?? 0) * 2 + modifierScore + effectScore;
  return modifierScore * 2 + effectScore;
}

/** 按装备等级选每个槽位可用的最高分装备；武器必须匹配所选武器类型。 */
function bestEquipment(
  content: ContentPack,
  weaponType: WeaponType,
  gearLevel: number,
): HeroRunSpec["equipment"] {
  return SLOT_ORDER.flatMap((slot) => {
    const candidates = content.items.filter(
      (item) =>
        item.kind !== "consumable" &&
        item.rarity !== "epic" &&
        item.slot === slot &&
        item.level <= gearLevel &&
        heroCanUseItem([weaponType], item),
    );
    if (candidates.length === 0) return [];
    const best = [...candidates].sort(
      (a, b) => itemScore(b, slot) - itemScore(a, slot) || b.level - a.level,
    )[0];
    return best ? [{ templateId: best.id, affixes: [] }] : [];
  });
}

/** 选当前等级可用的最高级治疗/法力药水，模拟玩家带药。 */
function bestPotion(
  content: ContentPack,
  gearLevel: number,
): ItemTemplate | undefined {
  return [...content.items]
    .filter(
      (item) =>
        item.kind === "consumable" &&
        item.level <= gearLevel &&
        Boolean(item.potion) &&
        Object.values(item.potion ?? {}).some((value) => (value ?? 0) > 0),
    )
    .sort((a, b) => b.level - a.level)[0];
}

/** 按真实技能点约束解锁节点；被动只到 1 级，主动技能按模拟等级训练。 */
function legalSkillLevels(
  content: ContentPack,
  weaponType: WeaponType,
  level: number,
  skillLevel: number,
): Record<string, number> {
  const path = weaponPath(content, weaponType);
  if (!path) return {};
  const nodes = skillTreeNodesForWeapon(content, weaponType);
  const unlocked = new Set<string>();
  const levels: Record<string, number> = {
    "basic-attack": skillLevel,
    "power-attack": skillLevel,
  };
  const root = nodes.find((node) => node.id === path.rootSkillId) ?? nodes.find((node) => node.tier === 0);
  if (root) {
    unlocked.add(root.id);
    levels[root.id] = skillLevel;
  }
  let points = skillPointsTotal(level);
  const ordered = [...nodes].sort(
    (a, b) => a.tier - b.tier || a.cost - b.cost || a.id.localeCompare(b.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of ordered) {
      if (unlocked.has(node.id)) continue;
      if (!checkSkillNodeUnlock(content, unlocked, node.id, level, points).canUnlock) continue;
      const skill = content.skills.find((row) => row.id === node.id);
      unlocked.add(node.id);
      levels[node.id] = skill?.kind === "passive" ? 1 : skillLevel;
      points -= node.cost;
      changed = true;
    }
  }
  return levels;
}

export function makeParty(
  content: ContentPack,
  level: number,
  gearLevel = level,
  skillLevelOverride?: number,
): HeroRunSpec[] {
  const skillLevel = Math.max(
    1,
    Math.min(MAX_SKILL_LEVEL, skillLevelOverride ?? 1 + Math.floor(level / 2)),
  );
  const potion = bestPotion(content, gearLevel);
  return PARTY_WEAPONS.flatMap((weaponType) => {
    const path = weaponPath(content, weaponType);
    if (!path) return [];
    const skillLevels = legalSkillLevels(content, weaponType, level, skillLevel);
    return [{
      id: `sim-${weaponType}`,
      name: `模拟${path.name}`,
      level,
      epEarned: epForLevel(level),
      raceId: RACE_BY_WEAPON[weaponType] ?? "borderlander",
      weaponType,
      skillLevels,
      position: POSITION_BY_WEAPON[weaponType] ?? "front",
      equipment: bestEquipment(content, weaponType, gearLevel),
      settings: potion
        ? {
            potions: [
              { potionId: potion.id, trigger: "hp" as const, belowPct: 50 },
            ],
          }
        : undefined,
      potions: potion
        ? [{
            itemId: `sim-${weaponType}-potion`,
            userId: `sim-user-${weaponType}`,
            templateId: potion.id,
            name: potion.name,
            charges: potion.charges ?? 1,
            effect: potion.potion ?? {},
          }]
        : [],
    }];
  });
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_LEVEL, Math.max(1, Math.floor(value)));
}

function parseArgs() {
  const dungeonId = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
  const runs = Number(process.argv[3] ?? 100);
  const levelOverride = process.argv[4] ? clampLevel(Number(process.argv[4])) : null;
  const gearOverride = process.argv[5] ? clampLevel(Number(process.argv[5])) : null;
  const routeId = process.argv[6] ?? null;
  return {
    dungeonId,
    runs: Number.isFinite(runs) && runs > 0 ? Math.floor(runs) : 100,
    levelOverride,
    gearOverride,
    routeId,
  };
}

function main() {
  const content = loadContent();
  const { dungeonId, runs, levelOverride, gearOverride, routeId } = parseArgs();
  const dungeons = dungeonId
    ? content.dungeons.filter((row) => row.id === dungeonId)
    : content.dungeons;
  if (dungeons.length === 0) {
    console.error(`找不到迷宫 ${dungeonId}`);
    process.exit(1);
  }

  console.log(
    `内容包：${content.name} v${content.version} · 每座迷宫模拟 ${runs} 次（入口→boss 默认通路）· 队伍 ${PARTY_WEAPONS.length} 人
`,
  );
  console.log(
    ["迷宫", "路径", "等级", "装备", "均战力", "胜率", "均回合", "均金币", "均EP", "均存活", "战利品"].join("	"),
  );

  for (const dungeon of dungeons) {
    const roomPath = defaultRoomPath(dungeon);
    const pathName = roomPath
      .map((roomId) => dungeon.rooms.find((room) => room.id === roomId)?.name ?? roomId)
      .join(" → ");
    const fallbackLevel = pathMonsterLevel(content, dungeon, roomPath);
    const level = levelOverride ?? fallbackLevel;
    const gearLevel = gearOverride ?? level;
    const party = makeParty(content, level, gearLevel);
    const averages = partyAverage(
      party.map((hero) => ({
        level: hero.level,
        power: computeHeroPower(content, hero),
      })),
    );
    let wins = 0;
    let rounds = 0;
    let gold = 0;
    let ep = 0;
    let survivors = 0;
    let items = 0;
    let lastDefeat: string | null = null;

    for (let seed = 1; seed <= runs; seed += 1) {
      const result = simulateExpedition(content, {
        dungeonId: dungeon.id,
        roomPath,
        heroes: party,
        seed: seed * 7919,
      });
      if (result.outcome === "victory") wins += 1;
      rounds += result.summary.rounds;
      gold += result.rewards.gold;
      ep += result.rewards.ep;
      survivors += result.summary.survivors;
      items += result.rewards.items.length;
      if (result.outcome === "defeat" && !lastDefeat) {
        const failed = result.encounters[result.encounters.length - 1];
        lastDefeat = failed
          ? failed.log
              .slice(-6)
              .map((entry) => entry.text)
              .join(" / ")
          : "无日志";
      }
    }

    const fmt = (n: number) => (n / runs).toFixed(1);
    console.log(
      [
        dungeon.name,
        pathName,
        String(level),
        String(gearLevel),
        String(averages.power),
        `${((wins / runs) * 100).toFixed(0)}%`,
        fmt(rounds),
        fmt(gold),
        fmt(ep),
        fmt(survivors),
        fmt(items),
      ].join("	"),
    );
    if (lastDefeat) console.log(`  首次失败摘要：${lastDefeat}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
