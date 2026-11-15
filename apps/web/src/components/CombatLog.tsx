import { useState } from "react";
import { ChevronDown, Swords } from "lucide-react";
import {
  DAMAGE_TYPE_LABELS,
  MODIFIER_KIND_LABELS,
  SKILL_PHASE_LABELS,
  modifierAmountText,
  modifierBeneficial,
  type CombatLogEffect,
  type CombatLogEntry,
  type EncounterResult,
} from "@wod/shared";
import { Badge, cx } from "./ui";

type LogFilter = "all" | "damage" | "heal" | "status" | "miss";

interface LogGroup {
  key: string;
  kind: "action" | "entry";
  entries: CombatLogEntry[];
}

function groupByRound(entries: CombatLogEntry[]): Array<[number, CombatLogEntry[]]> {
  const groups = new Map<number, CombatLogEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.round) ?? [];
    list.push(entry);
    groups.set(entry.round, list);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function groupEntries(entries: CombatLogEntry[]): LogGroup[] {
  const groups: LogGroup[] = [];
  const byAction = new Map<string, LogGroup>();
  for (const [index, entry] of entries.entries()) {
    const actionable =
      entry.actionId &&
      (entry.kind === "damage" ||
        entry.kind === "crit" ||
        entry.kind === "miss" ||
        entry.kind === "heal" ||
        Boolean(entry.effect));
    if (!actionable) {
      groups.push({ key: `entry-${index}`, kind: "entry", entries: [entry] });
      continue;
    }
    const existing = byAction.get(entry.actionId!);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    const group: LogGroup = {
      key: entry.actionId!,
      kind: "action",
      entries: [entry],
    };
    byAction.set(entry.actionId!, group);
    groups.push(group);
  }
  return groups;
}

function groupMatchesFilter(group: LogGroup, filter: LogFilter): boolean {
  if (filter === "all") return true;
  if (group.kind === "entry") {
    const kind = group.entries[0]?.kind;
    if (filter === "status") {
      return kind === "buff" || kind === "debuff" || kind === "down";
    }
    return false;
  }
  return group.entries.some((entry) => {
    if (filter === "damage") return entry.kind === "damage" || entry.kind === "crit";
    if (filter === "heal") return entry.kind === "heal";
    if (filter === "miss") return entry.kind === "miss";
    if (filter === "status") return Boolean(entry.effect);
    return false;
  });
}

function roundSummary(entries: CombatLogEntry[]): string | null {
  const damage = entries
    .filter((entry) => entry.kind === "damage" || entry.kind === "crit")
    .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const healing = entries
    .filter((entry) => entry.kind === "heal")
    .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const misses = entries.filter((entry) => entry.kind === "miss").length;
  const downs = entries.filter((entry) => entry.kind === "down").length;
  if (damage === 0 && healing === 0 && misses === 0 && downs === 0) return null;
  const parts: string[] = [];
  if (damage > 0) parts.push(`伤害 ${damage}`);
  if (healing > 0) parts.push(`治疗 ${healing}`);
  if (misses > 0) parts.push(`未命中 ${misses}`);
  if (downs > 0) parts.push(`倒下 ${downs}`);
  return parts.join(" · ");
}

function resultLabel(entry: CombatLogEntry): {
  label: string;
  tone: "green" | "gold" | "red" | "muted" | "blue";
} {
  if (entry.kind === "heal") {
    return entry.resource === "energy"
      ? { label: "回蓝", tone: "blue" }
      : { label: "治疗", tone: "green" };
  }
  if (entry.kind === "crit") return { label: "暴击", tone: "gold" };
  if (entry.kind === "damage") return { label: "命中", tone: "red" };
  if (entry.kind === "miss") {
    return { label: "未命中", tone: "muted" };
  }
  return { label: "行动", tone: "muted" };
}

function detailText(entry: CombatLogEntry): string {
  if (entry.kind === "heal") {
    return entry.resource === "energy" ? "恢复法力" : "恢复生命";
  }
  if (entry.hitChance !== undefined) {
    const hit = `命中率 ${Math.round(entry.hitChance * 100)}%`;
    if (entry.kind === "miss") return hit;
    const crit =
      entry.critChance !== undefined
        ? ` · 暴击率 ${Math.round(entry.critChance * 100)}%`
        : "";
    return `${hit}${crit}`;
  }
  return "";
}

function energyText(entry: CombatLogEntry): string | null {
  if (entry.energyBefore === undefined || entry.resource === "hp") return null;
  const after = entry.energyAfter ?? entry.energyBefore;
  const delta = after - entry.energyBefore;
  const sign = delta >= 0 ? "+" : "−";
  const max = entry.maxEnergy ? ` / ${entry.maxEnergy}` : "";
  return `法力 ${entry.energyBefore} ${sign}${Math.abs(delta)} → ${after}${max}`;
}

function hpText(entry: CombatLogEntry): string | null {
  if (entry.resource === "energy" && entry.energyBefore !== undefined) {
    const max = entry.maxEnergy ? ` / ${entry.maxEnergy}` : "";
    return `法力 ${entry.energyBefore} → ${entry.energyAfter ?? entry.energyBefore}${max}`;
  }
  if (entry.hpBefore === undefined || entry.hpAfter === undefined) {
    if (entry.kind === "down" && entry.hpAfter !== undefined) return `生命 0`;
    return null;
  }
  const max = entry.maxHp ? ` / ${entry.maxHp}` : "";
  return `生命 ${entry.hpBefore} → ${entry.hpAfter}${max}`;
}

function LegacyLine({ entry }: { entry: CombatLogEntry }) {
  const legacyText =
    entry.kind === "system" ? entry.text.replace("闪避了攻击", "未能命中") : entry.text;
  return (
    <div className={cx("log-line", `log-${entry.kind}`)}>
      <span className="log-text">{legacyText}</span>
      {entry.amount !== undefined &&
      (entry.kind === "damage" || entry.kind === "crit" || entry.kind === "heal") ? (
        <span className={cx("log-amount", `amount-${entry.kind}`)}>
          {entry.kind === "heal" ? "+" : "−"}
          {entry.amount}
        </span>
      ) : null}
    </div>
  );
}

function effectChip(effect: CombatLogEffect): string {
  if (effect.type === "mod") {
    const label = effect.kind ? MODIFIER_KIND_LABELS[effect.kind] : "修正";
    return `${label} ${effect.kind ? modifierAmountText(effect.kind, effect.amount ?? 0) : ""}`;
  }
  if (effect.type === "hot") return `每回合 +${effect.damage ?? 0} 生命`;
  if (effect.type === "dot") {
    return `每回合 ${effect.damage ?? 0} 点${DAMAGE_TYPE_LABELS[effect.damageType ?? "crushing"]}伤害`;
  }
  if (effect.type === "stun") return "眩晕";
  if (effect.type === "freeze") return "冰冻";
  if (effect.type === "paralysis") return "麻痹";
  if (effect.type === "sleep") return "睡眠";
  if (effect.type === "burn") return "灼伤";
  if (effect.type === "poison") return `中毒 ${effect.stacks ?? 1} 层`;
  if (effect.type === "bleed") return "流血";
  if (effect.type === "wound") return `伤口 ${effect.stacks ?? 1} 层`;
  if (effect.type === "silence") return "沉默";
  if (effect.type === "taunt") return "嘲讽";
  if (effect.type === "shield") return `护盾 ${effect.value ?? 0}`;
  if (effect.type === "reflect") return `反伤 ${Math.round((effect.percent ?? 0) * 100)}%`;
  return "状态";
}

function effectLabel(effect: CombatLogEffect): {
  label: string;
  tone: "green" | "gold" | "red" | "muted" | "blue";
} {
  if (effect.type === "mod") {
    const beneficial = effect.kind ? modifierBeneficial(effect.kind, effect.amount ?? 0) : true;
    return beneficial ? { label: "增益", tone: "blue" } : { label: "减益", tone: "red" };
  }
  if (effect.type === "hot") return { label: "持续治疗", tone: "green" };
  if (effect.type === "dot") return { label: "持续伤害", tone: "gold" };
  if (effect.type === "stun") return { label: "眩晕", tone: "muted" };
  if (effect.type === "freeze") return { label: "冰冻", tone: "muted" };
  if (effect.type === "paralysis") return { label: "麻痹", tone: "red" };
  if (effect.type === "sleep") return { label: "睡眠", tone: "muted" };
  if (effect.type === "burn") return { label: "灼伤", tone: "gold" };
  if (effect.type === "poison") return { label: "中毒", tone: "red" };
  if (effect.type === "bleed") return { label: "流血", tone: "red" };
  if (effect.type === "wound") return { label: "伤口", tone: "gold" };
  if (effect.type === "silence") return { label: "沉默", tone: "muted" };
  if (effect.type === "taunt") return { label: "嘲讽", tone: "muted" };
  if (effect.type === "shield") return { label: "护盾", tone: "blue" };
  if (effect.type === "reflect") return { label: "反伤", tone: "gold" };
  return { label: "状态", tone: "muted" };
}

function ActionCard({ group }: { group: LogGroup }) {
  const first = group.entries[0];
  if (!first?.actor) return <LegacyLine entry={first!} />;
  const strikeEntries = group.entries.filter((entry) => !entry.effect);
  const effectEntries = group.entries.filter((entry) => entry.effect);
  const targetNames = [...new Set(group.entries.map((entry) => entry.target?.name).filter(Boolean))];
  const multiple = targetNames.length > 1 || strikeEntries.length > 1;
  const effectByTarget = new Map<string, CombatLogEntry[]>();
  for (const entry of effectEntries) {
    const name = entry.target?.name ?? "未知目标";
    const rows = effectByTarget.get(name) ?? [];
    rows.push(entry);
    effectByTarget.set(name, rows);
  }

  return (
    <article className={cx("log-action-card", `log-side-${first.actor.side}`)}>
      <header className="log-action-head">
        <span className={cx("log-actor", first.actor.side === "hero" ? "log-hero" : "log-enemy")}>
          {first.actor.name}
        </span>
        <Swords size={13} />
        {first.phase && first.phase !== "main" ? (
          <Badge tone="muted">{SKILL_PHASE_LABELS[first.phase]}</Badge>
        ) : null}
        <strong>{first.actionName ?? "攻击"}</strong>
        {!multiple && first.target ? (
          <>
            <span className="log-arrow">→</span>
            <span className="log-target">{first.target.name}</span>
          </>
        ) : (
          <span className="log-target">→ {targetNames.length} 个目标</span>
        )}
      </header>
      {energyText(first) ? <div className="log-action-energy">{energyText(first)}</div> : null}
      <div className="log-action-rows">
        {strikeEntries.map((entry, index) => {
          const label = resultLabel(entry);
          return (
            <div key={`${group.key}-strike-${index}`} className="log-action-row">
              <Badge tone={label.tone}>{label.label}</Badge>
              {multiple && entry.target ? (
                <span className="log-result-target">{entry.target.name}</span>
              ) : null}
              <span className="log-result-detail">{detailText(entry)}</span>
              <span
                className={cx(
                  "log-result-value",
                  entry.kind === "heal" && "amount-heal",
                  entry.kind === "crit" && "amount-crit",
                  entry.kind === "miss" && "amount-miss",
                )}
              >
                {entry.kind === "miss"
                  ? "—"
                  : `${
                      entry.kind === "heal"
                        ? entry.resource === "energy"
                          ? "法力"
                          : "治疗"
                        : entry.damageType
                          ? DAMAGE_TYPE_LABELS[entry.damageType]
                          : "伤害"
                    } ${entry.kind === "heal" ? "+" : "−"}${entry.amount ?? 0}`}
              </span>
              {hpText(entry) ? <span className="log-result-hp">（{hpText(entry)}）</span> : null}
            </div>
          );
        })}
        {[...effectByTarget.entries()].map(([targetName, entries]) => {
          const effects = entries
            .map((entry) => entry.effect)
            .filter((effect): effect is CombatLogEffect => Boolean(effect));
          if (effects.length === 0) return null;
          const label = effectLabel(effects[0]!);
          const durations = [...new Set(effects.map((effect) => effect.duration ?? 0).filter(Boolean))];
          return (
            <div key={`${group.key}-effect-${targetName}`} className="log-action-row log-effect-row">
              <Badge tone={label.tone}>{label.label}</Badge>
              {multiple ? <span className="log-result-target">{targetName}</span> : null}
              <span className="log-effect-list">
                {effects.map((effect, index) => (
                  <span key={`${targetName}-${index}`} className="log-effect-chip">
                    {effectChip(effect)}
                  </span>
                ))}
              </span>
              {durations.length > 0 ? (
                <span className="log-effect-duration">
                  持续 {durations.join("/")} 回合
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function EncounterLog({
  encounter,
  defaultOpen = false,
}: {
  encounter: EncounterResult;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [collapsedRounds, setCollapsedRounds] = useState<Set<number>>(new Set());
  const misses = encounter.log.filter((entry) => entry.kind === "miss").length;

  function toggleRound(round: number) {
    setCollapsedRounds((current) => {
      const next = new Set(current);
      if (next.has(round)) next.delete(round);
      else next.add(round);
      return next;
    });
  }

  return (
    <article className={cx("encounter-log", open && "encounter-open")}>
      <button type="button" className="encounter-log-head" onClick={() => setOpen((value) => !value)}>
        <span className="encounter-num">
          <Swords size={16} />
        </span>
        <span className="encounter-info">
          <strong>{encounter.name}</strong>
          <small>
            {encounter.rounds} 回合 · 造成 {encounter.damageDealt} 伤害 · 承受{" "}
            {encounter.damageTaken}
            {misses > 0 ? ` · 未命中 ${misses}` : ""}
          </small>
        </span>
        <Badge tone={encounter.victory ? "green" : encounter.timeout ? "gold" : "red"}>
          {encounter.victory ? "胜利" : encounter.timeout ? "撤退" : "失败"}
        </Badge>
        <ChevronDown size={16} className={cx("chev", open && "chev-open")} />
      </button>

      {open ? (
        <div className="combat-log">
          <div className="log-filters">
            {(
              [
                ["all", "全部"],
                ["damage", "伤害"],
                ["heal", "治疗"],
                ["status", "状态"],
                ["miss", "未命中"],
              ] as Array<[LogFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cx("log-filter", filter === value && "log-filter-active")}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {groupByRound(encounter.log).map(([round, entries]) => {
            const groups = groupEntries(entries).filter((group) =>
              groupMatchesFilter(group, filter),
            );
            if (groups.length === 0) return null;
            const summary = roundSummary(entries);
            const collapsed = collapsedRounds.has(round);
            return (
              <div key={round} className="log-round">
                <button
                  type="button"
                  className="log-round-mark log-round-toggle"
                  onClick={() => toggleRound(round)}
                >
                  <span>{round === 0 ? "战斗前" : `第 ${round} 回合`}</span>
                  {summary ? <small>{summary}</small> : null}
                  <ChevronDown size={13} className={cx("chev", !collapsed && "chev-open")} />
                </button>
                {!collapsed ? (
                  <div className="log-lines">
                    {groups.map((group) =>
                      group.kind === "action" ? (
                        <ActionCard key={group.key} group={group} />
                      ) : (
                        <LegacyLine key={group.key} entry={group.entries[0]!} />
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
