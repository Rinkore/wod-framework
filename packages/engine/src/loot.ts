import {
  RARITY_ORDER,
  isEquipmentSlot,
  type Affix,
  type AffixRoll,
  type ContentPack,
  type ItemRoll,
  type ItemTemplate,
  type Modifier,
  type Rarity,
} from "@wod/shared";
import type { Rng } from "./rng.js";

const AFFIX_COUNT: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
};


export function rollItem(
  content: ContentPack,
  template: ItemTemplate,
  rng: Rng,
): ItemRoll {
  const affixCount = AFFIX_COUNT[template.rarity];
  // 特效词缀仅稀有及以上品质出现。
  const allowEffectAffixes = RARITY_ORDER[template.rarity] >= RARITY_ORDER.rare;
  const pool = content.affixes.filter(

        (affix) =>
          isEquipmentSlot(template.slot) &&
          affix.slots.includes(template.slot) &&
          (affix.kind === "modifier" || allowEffectAffixes),
      );
  const chosen: Affix[] = [];

  for (let i = 0; i < affixCount && pool.length > chosen.length; i += 1) {
    const remaining = pool.filter((affix) => !chosen.some((row) => row.id === affix.id));
    if (remaining.length === 0) break;
    chosen.push(rng.pick(remaining));
  }

  const affixes: AffixRoll[] = chosen.map((affix) => {
    if (affix.kind === "modifier") {
      return {
        affixId: affix.id,
        name: affix.name,
        modifiers: affix.modifiers.map((entry): Modifier => ({
          kind: entry.kind,
          amount: rng.int(entry.min, entry.max),
        })),
      };
    }
    return { affixId: affix.id, name: affix.name, effect: affix.effect };
  });

  const rolledModifiers: Modifier[] = [...template.modifiers];
  const effects = [...template.effects];
  let affixValue = 0;
  for (const affix of affixes) {
    for (const modifier of affix.modifiers ?? []) {
      rolledModifiers.push(modifier);
      affixValue += Math.abs(modifier.amount) * 2;
    }
    if (affix.effect) {
      effects.push(affix.effect);
      affixValue += 25;
    }
  }

  const prefix = affixes[0]?.name;
  const value = Math.round(template.value + affixValue + template.level * 3);

  return {
    templateId: template.id,
    name: prefix ? `${prefix}的${template.name}` : template.name,
    description: template.description,
    kind: template.kind,
    slot: template.slot,
    rarity: template.rarity,
    level: template.level,
    modifiers: rolledModifiers,
    effects,
    armor: template.armor,
    weaponDamage: template.weaponDamage,
    damageType: template.damageType,
    weaponType: template.weaponType,
    affixes,
    value,
  };
}

export function rollItemById(
  content: ContentPack,
  templateId: string,
  rng: Rng,
): ItemRoll | null {
  const template = content.items.find((row) => row.id === templateId);
  if (!template) return null;
  return rollItem(content, template, rng);
}

/** 按掉落表掷骰：先判定是否掉落，再按权重抽取若干件。 */
export function rollLootTable(content: ContentPack, tableId: string, rng: Rng): ItemRoll[] {
  const table = content.lootTables.find((row) => row.id === tableId);
  if (!table) return [];
  if (!rng.chance(table.chance)) return [];

  const results: ItemRoll[] = [];
  for (let roll = 0; roll < table.rolls; roll += 1) {
    const total = table.entries.reduce((sum, entry) => sum + entry.weight, 0);
    let ticket = rng.float(0, total);
    for (const entry of table.entries) {
      ticket -= entry.weight;
      if (ticket <= 0) {
        const template = content.items.find((row) => row.id === entry.templateId);
        if (template) {
          results.push(rollItem(content, template, rng));
        }
        break;
      }
    }
  }
  return results;
}

export function sellValue(item: Pick<ItemRoll, "value" | "rarity">): number {
  const multiplier = 0.45 + RARITY_ORDER[item.rarity] * 0.02;
  return Math.max(1, Math.floor(item.value * multiplier));
}
