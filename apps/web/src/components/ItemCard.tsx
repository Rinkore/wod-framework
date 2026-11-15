import type { ReactNode } from "react";
import {
  DAMAGE_TYPE_LABELS,
  ITEM_EFFECT_TRIGGER_LABELS,
  ITEM_SLOT_LABELS,
  MODIFIER_KIND_LABELS,
  WEAPON_TYPE_LABELS,
  modifierAmountText,
  modifierBeneficial,
  type ItemEffect,
  type ItemView,
} from "@wod/shared";
import { RarityTag, cx, slotIcon } from "./ui";

/** 装备特效词条的展示文本。 */
export function itemEffectText(effect: ItemEffect): string {
  const chance = `${ITEM_EFFECT_TRIGGER_LABELS[effect.trigger]} ${Math.round(effect.chance * 100)}%`;
  const whom = effect.target === "self" ? "自身" : "目标";
  const { payload } = effect;
  if (payload.type === "dot") {
    return `${chance} 使${whom}每回合受到 ${payload.base} 点${DAMAGE_TYPE_LABELS[payload.damageType]}伤害，持续 ${payload.duration} 回合`;
  }
  if (payload.type === "mod") {
    const beneficial = modifierBeneficial(payload.kind, payload.amount);
    const verb = beneficial ? (effect.target === "self" ? "获得" : "获得") : "陷入";
    return `${chance} 使${whom}${verb}【${MODIFIER_KIND_LABELS[payload.kind]} ${modifierAmountText(payload.kind, payload.amount)}】，持续 ${payload.duration} 回合`;
  }
  if (payload.type === "shield") {
    return `${chance} 为${whom}附加吸收 ${payload.base} 点伤害的护盾，持续 ${payload.duration} 回合`;
  }
  if (payload.type === "reflect") {
    return `${chance} 使${whom}获得反弹 ${Math.round(payload.percent * 100)}% 所受伤害的屏障，持续 ${payload.duration} 回合`;
  }
  return `${chance} 为${whom}恢复 ${payload.amount} 点法力`;
}

export function ModifierLine({
  kind,
  amount,
  className,
}: {
  kind: keyof typeof MODIFIER_KIND_LABELS;
  amount: number;
  className?: string;
}) {
  const beneficial = modifierBeneficial(kind, amount);
  return (
    <span className={cx(className, beneficial ? "text-gold" : "text-danger")}>
      {MODIFIER_KIND_LABELS[kind]} {modifierAmountText(kind, amount)}
    </span>
  );
}

export function ItemCard({
  item,
  actions,
  equippedName,
  footerText,
  compact = false,
}: {
  item: ItemView;
  actions?: ReactNode;
  equippedName?: string;
  footerText?: ReactNode;
  compact?: boolean;
}) {
  const Icon = slotIcon(item.slot);

  return (
    <article className={cx("item-card", `item-rarity-${item.rarity}`, compact && "item-card-compact")}>
      <header className="item-head">
        <span className="item-icon">
          <Icon size={compact ? 16 : 18} />
        </span>
        <div className="item-title">
          <strong>{item.name}</strong>
          <span>
            等级 {item.level} · {ITEM_SLOT_LABELS[item.slot]}
            {item.slot === "weapon" && item.weaponType
              ? ` · ${WEAPON_TYPE_LABELS[item.weaponType]}`
              : ""}
          </span>
        </div>
        <RarityTag rarity={item.rarity} />
      </header>

      <div className="item-stats">
        {item.weaponDamage ? <span>武器伤害 +{item.weaponDamage}</span> : null}
        {item.damageType ? <span>{DAMAGE_TYPE_LABELS[item.damageType]}</span> : null}
        {item.armor ? <span>护甲 +{item.armor}</span> : null}
        {(item.modifiers ?? []).map((row, index) => (
          <ModifierLine key={`m-${index}`} kind={row.kind} amount={row.amount} />
        ))}
        {(item.effects ?? []).map((effect, index) => (
          <span key={`e-${index}`} className="item-affix">
            {itemEffectText(effect)}
          </span>
        ))}
      </div>

      {!compact ? (
        <>
          <p className="item-desc">{item.description}</p>
          {item.affixes.length > 0 ? (
            <p className="item-affix-note">
              {item.affixes.map((affix) => affix.name).join(" · ")}
            </p>
          ) : null}
        </>
      ) : null}

      <footer className="item-foot">
        <span className={equippedName || footerText || item.ownerName ? "text-gold" : "text-muted"}>
          {equippedName
            ? `装备于 ${equippedName}`
            : item.ownerName
              ? `归属 ${item.ownerName}`
              : footerText ?? `价值 ${item.value} 金币`}
        </span>
        {actions ? <div className="item-actions">{actions}</div> : null}
      </footer>
    </article>
  );
}
