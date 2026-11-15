import { readFileSync } from "node:fs";
import path from "node:path";
import {
  contentPackSchema,
  validateContent,
  type ContentPack,
} from "@wod/shared";
import { CONTENT_DIR } from "./config.js";

function readJson(name: string): unknown {
  const file = path.join(CONTENT_DIR, name);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`读取内容文件失败 ${file}: ${(error as Error).message}`);
  }
}

export function loadContent(): ContentPack {
  const meta = readJson("pack.json") as Record<string, unknown>;
  const parsed = contentPackSchema.safeParse({
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
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(根)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`内容包格式校验失败（${CONTENT_DIR}）:\n${details}`);
  }
  const refErrors = validateContent(parsed.data);
  if (refErrors.length > 0) {
    throw new Error(`内容包引用校验失败（${CONTENT_DIR}）:\n${refErrors.join("\n")}`);
  }
  return parsed.data;
}

export const content: ContentPack = loadContent();
