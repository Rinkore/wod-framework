import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChartNoAxesColumn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Zap,
  Flame,
  HeartPulse,
  Pause,
  Play,
  Shield,
  Skull,
  X,
} from "lucide-react";
import {
  SKILL_PHASE_LABELS,
  AILMENT_LABELS,
  DAMAGE_TYPE_LABELS,
  MODIFIER_KIND_LABELS,
  POSITION_LABELS,
  modifierAmountText,
  modifierBeneficial,
} from "@wod/shared";
import { weaponIcon } from "../components/ui";
import type { ReportEffect, ReportFloor, ReportFrame, ReportResult, ReportUnit } from "./model";

const POSITION_LABEL: Record<string, string> = {
  ...POSITION_LABELS,
  center: "中排（旧记录）",
  unknown: "未记录",
};
function pct(value: number, max: number | null): string {
  const ratio = max && max > 0 ? value / max : 0;
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%`;
}

/** 效果渲染所需的最小字段（分组聚合对象也满足）。 */
type EffectLike = Pick<
  ReportEffect,
  "type" | "kind" | "amount" | "damage" | "value" | "percent" | "remaining" | "damageType" | "stacks"
>;

/** 效果对持有者是否有利（决定 chip 配色）。 */
function effectIsBeneficial(effect: EffectLike): boolean {
  if (
    effect.type === "dot" ||
    effect.type === "stun" ||
    effect.type === "freeze" ||
    effect.type === "paralysis" ||
    effect.type === "sleep" ||
    effect.type === "burn" ||
    effect.type === "poison" ||
    effect.type === "bleed" ||
    effect.type === "wound" ||
    effect.type === "silence" ||
    effect.type === "taunt"
  ) {
    return false;
  }
  if (effect.type === "hot" || effect.type === "shield" || effect.type === "reflect") return true;
  if (effect.type === "mod") {
    return effect.kind ? modifierBeneficial(effect.kind, effect.amount ?? 0) : true;
  }
  return true;
}

/** 效果 chip 的配色类。 */
function effectToneClass(effect: EffectLike): string {
  if (effect.type === "dot" || effect.type === "burn" || effect.type === "poison" || effect.type === "bleed") return "dot";
  if (effect.type === "stun" || effect.type === "freeze" || effect.type === "sleep") return "stun";
  return effectIsBeneficial(effect) ? "buff" : "debuff";
}

function fxShort(effect: EffectLike): string {
  switch (effect.type) {
    case "mod":
      return effect.kind
        ? `${MODIFIER_KIND_LABELS[effect.kind]} ${modifierAmountText(effect.kind, effect.amount ?? 0)}`
        : "修正";
    case "dot":
      return `每回合 ${effect.damage ?? 0}`;
    case "hot":
      return `每回合 +${effect.damage ?? 0}`;
    case "stun":
      return "眩晕";
    case "freeze":
      return "冰冻";
    case "paralysis":
      return "麻痹";
    case "sleep":
      return "睡眠";
    case "burn":
      return "灼伤";
    case "poison":
      return `中毒 ${effect.stacks ?? 1}`;
    case "bleed":
      return "流血";
    case "wound":
      return `伤口 ${effect.stacks ?? 1}`;
    case "silence":
      return "沉默";
    case "taunt":
      return "嘲讽";
    case "shield":
      return `盾 ${effect.value ?? 0}`;
    case "reflect":
      return `反伤 ${Math.round((effect.percent ?? 0) * 100)}%`;
    default:
      return "状态";
  }
}

function effectText(effect?: EffectLike): string {
  if (!effect) return "获得效果";
  const turns = effect.remaining ? ` · ${effect.remaining} 回合` : "";
  switch (effect.type) {
    case "dot": {
      const type = effect.damageType ? DAMAGE_TYPE_LABELS[effect.damageType] ?? "" : "";
      return `持续${type}伤害 ${effect.damage ?? 0}/回合${turns}`;
    }
    case "hot":
      return `持续治疗 ${effect.damage ?? 0}/回合${turns}`;
    case "stun":
      return `眩晕${turns}`;
    case "freeze":
      return `冰冻，无法行动与回复魔力${turns}`;
    case "paralysis":
      return `麻痹，行为有 25% 概率被取消${turns}`;
    case "sleep":
      return `睡眠，随机攻击可触及目标${turns}`;
    case "burn":
      return `灼伤，每回合损失最大生命 5%${turns}`;
    case "poison":
      return `中毒 ${effect.stacks ?? 1} 层，每层每回合损失最大生命 1%`;
    case "bleed":
      return "流血，受到物理伤害时额外失去该次伤害 5% 的生命";
    case "wound":
      return `伤口 ${effect.stacks ?? 1} 层，每层使攻击者暴击率 +5%`;
    case "silence":
      return `沉默，无法使用技能${turns}`;
    case "taunt":
      return `嘲讽，只能攻击施加者${turns}`;
    case "shield":
      return `护盾，可吸收 ${effect.value ?? 0} 点伤害${turns}`;
    case "reflect":
      return `反伤屏障，反弹 ${Math.round((effect.percent ?? 0) * 100)}% 所受伤害${turns}`;
    case "mod": {
      if (!effect.kind) return `修正${turns}`;
      const label = MODIFIER_KIND_LABELS[effect.kind];
      const text = modifierAmountText(effect.kind, effect.amount ?? 0);
      return modifierBeneficial(effect.kind, effect.amount ?? 0)
        ? `获得【${label} ${text}】${turns}`
        : `陷入【${label} ${text}】${turns}`;
    }
    default:
      return "状态效果";
  }
}

function effectGroups(effects: ReportEffect[]) {
  const groups = new Map<
    string,
    { type: ReportEffect["type"]; kind?: ReportEffect["kind"]; amount: number; damage: number; value: number; remaining: number; sources: Set<string> }
  >();
  for (const effect of effects) {
    const key =
      effect.type === "mod" && effect.kind ? `mod:${effect.kind}` : effect.type;
    const group = groups.get(key) ?? {
      type: effect.type,
      kind: effect.kind,
      amount: 0,
      damage: 0,
      value: 0,
      remaining: 0,
      sources: new Set<string>(),
    };
    group.amount += effect.amount ?? 0;
    group.damage += effect.damage ?? 0;
    group.value += effect.value ?? 0;
    group.remaining = Math.max(group.remaining, effect.remaining);
    group.sources.add(effect.source);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function monsterIcon(monsterId?: string | null) {
  if (monsterId === "lava-elemental") return Flame;
  if (monsterId === "ash-hound") return Shield;
  return Skull;
}

function unitIcon(unit: ReportUnit) {
  if (unit.side === "hero" && unit.weaponType) return weaponIcon(unit.weaponType as never);
  return monsterIcon(unit.monsterId);
}

type StepState = "done" | "todo" | "current";

export interface BattleReportMeta {
  dungeonName: string;
  routeName?: string;
  seed?: number;
  startAt?: number;
}

export function BattleReport({
  floors,
  meta,
}: {
  floors: ReportFloor[];
  meta: BattleReportMeta;
}) {
  const [floorIndex, setFloorIndex] = useState(() => Math.max(0, floors.length - 1));
  const [round, setRound] = useState(() =>
    floors.length > 0 ? floors[Math.max(0, floors.length - 1)]!.frames[0]?.round ?? 1 : 1,
  );
  const [step, setStep] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [openSkills, setOpenSkills] = useState<Set<string>>(new Set());
  const [statsOpen, setStatsOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [slotHeight, setSlotHeight] = useState(0);
  const slotRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);

  const floor = floors[Math.min(floorIndex, floors.length - 1)]!;
  const frame = useMemo(() => {
    if (!floor) return null;
    return floor.frames.find((row) => row.round === round) ?? floor.frames[0] ?? null;
  }, [floor, round]);

  const maxStep = frame ? frame.steps.length - 1 : 0;
  const index = step == null ? maxStep : Math.max(0, Math.min(maxStep, step));
  const unitOf = (key: string): ReportUnit =>
    floor.units.find((unit) => unit.key === key) ?? {
      key,
      id: key,
      name: "?",
      side: "enemy",
      level: 1,
      position: null,
      maxHp: null,
      maxEnergy: null,
      startHp: 0,
      startEnergy: 0,
    };

  function currentAction() {
    if (!frame) return null;
    if (index === 0) return { kind: "start" as const };
    const tickCount = frame.ticks.length;
    if (index <= tickCount) {
      const group = frame.ticks[index - 1]!;
      if (group.kind === "stun") return { kind: "stun" as const, unit: unitOf(group.key) };
      const unit = unitOf(group.unit);
      const dmg = group.rows.filter((row) => row.kind === "damage");
      const heal = group.rows.filter((row) => row.kind === "heal");
      return {
        kind: dmg.length ? ("tick" as const) : ("hot" as const),
        unit,
        amount: dmg.reduce((sum, row) => sum + row.amount, 0) || heal.reduce((sum, row) => sum + row.amount, 0),
        damageTypes: [...new Set(dmg.map((row) => row.damageType).filter(Boolean))] as string[],
        sources: [...new Set(group.rows.map((row) => row.source))],
        down: group.rows.some((row) => row.kind === "down"),
      };
    }
    const group = frame.groups[index - tickCount - 1];
    if (!group) return null;
    return { kind: "action" as const, group };
  }

  function focusStepMatches(target: ReportFrame, at: number, key: string | null): boolean {
    if (!key) return true;
    if (at <= 0) return false;
    const tickCount = target.ticks.length;
    if (at <= tickCount) {
      const group = target.ticks[at - 1]!;
      if (group.kind === "stun") return group.key === key;
      return group.unit === key;
    }
    const group = target.groups[at - tickCount - 1];
    if (!group) return false;
    return group.act === key || group.results.some((result) => result.key === key);
  }

  function findFocusStep(target: ReportFrame, from: number | null, dir: 1 | -1, key: string): number | null {
    if (dir > 0) {
      for (let i = (from ?? 0) + 1; i < target.steps.length - 1; i += 1) {
        if (focusStepMatches(target, i, key)) return i;
      }
    } else {
      for (let i = (from ?? target.steps.length - 1) - 1; i >= 1; i -= 1) {
        if (focusStepMatches(target, i, key)) return i;
      }
    }
    return null;
  }

  // 回放
  useEffect(() => {
    if (!playing || !frame) return;
    const timer = window.setInterval(() => {
      const target = frame!;
      let next: number | null = null;
      for (let i = (step ?? 0) + 1; i < target.steps.length - 1; i += 1) {
        if (focusStepMatches(target, i, focus)) { next = i; break; }
      }
      if (next != null) {
        setStep(next);
        return;
      }
      // 跳到下一回合的第一个相关动作
      const floorFrames = floor!.frames;
      const at = floorFrames.indexOf(target);
      for (let r = at + 1; r < floorFrames.length; r += 1) {
        const candidate = floorFrames[r]!;
        for (let i = 1; i < candidate.steps.length - 1; i += 1) {
          if (focusStepMatches(candidate, i, focus)) {
            setRound(candidate.round);
            setStep(i);
            return;
          }
        }
      }
      setPlaying(false);
      setStep(null);
    }, 900);
    return () => window.clearInterval(timer);
  }, [playing, frame, floor, step, focus]);

  // 动作卡高度锁定：同回合内按最高的一张卡预留
  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const cards = Array.from(probe.querySelectorAll<HTMLElement>(".wr-now-probe-card"));
    const height = cards.reduce((max, card) => Math.max(max, card.getBoundingClientRect().height), 0);
    if (height > 0) setSlotHeight(Math.ceil(height));
  }, [frame, floor]);

  if (!floor || !frame) return null;

  const changeFloor = (next: number) => {
    setFloorIndex(next);
    setRound(floors[next]!.frames[0]?.round ?? 1);
    setStep(null);
    setFocus(null);
    setPlaying(false);
  };

  const changeRound = (nextRound: number) => {
    const target = floor.frames.find((row) => row.round === nextRound);
    if (!target) return;
    setRound(nextRound);
    setStep(null);
    setPlaying(false);
  };

  const stepBy = (dir: 1 | -1) => {
    setPlaying(false);
    if (focus) {
      setStep(findFocusStep(frame, step, dir, focus));
      return;
    }
    const current = step == null ? maxStep : step;
    const next = Math.max(0, Math.min(maxStep, current + dir));
    setStep(next >= maxStep ? null : next);
  };

  const focusUnit = (key: string) => {
    const next = focus === key ? null : key;
    setFocus(next);
    setPlaying(false);
    if (next) {
      let first: number | null = null;
      for (let i = 1; i < frame.steps.length - 1; i += 1) {
        if (focusStepMatches(frame, i, next)) { first = i; break; }
      }
      setStep(first);
    }
  };

  const action = currentAction();
  const state = frame.steps[index]!.state;
  const prevState = index === 0 ? frame.base : frame.steps[index - 1]!.state;

  // 高亮
  const touched = new Map<string, "hit" | "healed">();
  let actingKey: string | null = null;
  if (step != null && action) {
    if (action.kind === "action") {
      actingKey = action.group.act;
      for (const result of action.group.results) touched.set(result.key, result.kind === "heal" ? "healed" : "hit");
    } else if (action.kind === "tick" || action.kind === "hot" || action.kind === "stun") {
      touched.set(action.unit.key, action.kind === "hot" ? "healed" : "hit");
    }
  }

  const atEnd = index === maxStep;
  const showTicks = step == null || step >= frame.ticks.length;
  const focusUnitData = focus ? unitOf(focus) : null;

  const roundSummary = `${index === 0 ? "回合开始" : atEnd ? "回合结束" : `第 ${index}/${maxStep} 步`}`;

  // ---- 战场 ----
  const board = (side: "hero" | "enemy") => {
    const order: Record<string, number> = { front: 0, flank: 1, back: 2, center: 3, unknown: 4 };
    const units = floor.units
      .filter((unit) => unit.side === side)
      .sort((a, b) => (order[a.position ?? "unknown"] ?? 4) - (order[b.position ?? "unknown"] ?? 4));
    return (
      <section className="wr-board" data-side={side} aria-label={side === "hero" ? "我方战场" : "敌方战场"}>
        <div className="wr-board-head">
          <strong>{side === "hero" ? "我方" : "敌方"}</strong>
          <small>{units.filter((unit) => (state[unit.key]?.hp ?? 0) > 0).length}/{units.length} 存活</small>
        </div>
        <div className="wr-units">
          {units.map((unit) => {
                  const now = state[unit.key] ?? { hp: 0, en: 0, effects: [] };
                  const before = prevState[unit.key] ?? now;
                  const dead = now.hp <= 0;
                  const delta = now.hp - before.hp;
                  const lost = Math.max(0, before.hp - now.hp);
                  const gain = Math.max(0, now.hp - before.hp);
                  const ratio = unit.maxHp ? now.hp / unit.maxHp : 1;
                  const low = ratio < 0.25 ? "low" : ratio < 0.55 ? "mid" : "";
                  const Icon = unitIcon(unit);
                  const color = unit.color ?? (side === "hero" ? "#c9a85f" : "#d07878");
                  const mark = actingKey === unit.key ? "acting" : touched.get(unit.key) ?? "";
                  const effects = effectGroups(now.effects);
                  return (
                    <button type="button" key={unit.key} className="wr-unit" data-unit={unit.key} data-dead={dead}
                      data-focus={focus && focus !== unit.key ? "out" : "in"} data-state={mark}
                      onClick={() => focusUnit(unit.key)} title={focus === unit.key ? "取消只看" : `只看 ${unit.name}`}>
                      <span className="wr-unit-head">
                        <span className="wr-sigil" style={{ "--sigil": color } as React.CSSProperties}><Icon /></span>
                        <span className="wr-unit-name">{unit.name}</span>
                        <span className="wr-unit-lv">Lv<b>{unit.level}</b></span>
                        {unit.position ? <span className="wr-unit-pos">{POSITION_LABEL[unit.position] ?? unit.position}</span> : null}
                        {actingKey === unit.key ? <span className="wr-now-tag">行动中</span> : null}
                        {dead ? <span className="wr-down-tag"><Skull />倒下</span> : delta < 0 ? <span className="wr-unit-delta dmg">{delta}</span> : delta > 0 ? <span className="wr-unit-delta heal">+{delta}</span> : null}
                      </span>
                      <span className="wr-bars">
                        <span className="wr-hpbar" data-side={unit.side}>
                          <span className={`hp-fill ${low}`} style={{ width: pct(now.hp, unit.maxHp) }} />
                          {lost > 0 ? <span className="hp-lost" style={{ left: pct(now.hp, unit.maxHp), width: pct(lost, unit.maxHp) }} /> : null}
                          {gain > 0 ? <span className="hp-gain" style={{ left: pct(before.hp, unit.maxHp), width: pct(gain, unit.maxHp) }} /> : null}
                        </span>
                        <span className="wr-hpnum"><span>{unit.hpEstimated ? "未受伤" : unit.maxHp ? `${now.hp}/${unit.maxHp}` : "—"}</span><span>{dead || !unit.maxEnergy ? "" : `法力 ${now.en}/${unit.maxEnergy}`}</span></span>
                        {unit.maxEnergy ? <span className="wr-enbar" aria-hidden="true"><span style={{ width: pct(now.en, unit.maxEnergy) }} /></span> : null}
                      </span>
                      {effects.length > 0 ? <span className="wr-effects">{effects.map((effect, i) => <span key={i} className={`wr-fx ${effectToneClass(effect)}`}>
                        {effect.type === "dot" ? <Flame /> : effect.type === "stun" ? <Zap /> : effect.type === "shield" ? <Shield /> : null}<b>{fxShort(effect)}</b>
                        {effect.type === "dot" ? <span>/{effect.remaining ? `${effect.remaining}` : ""}</span> : effect.remaining ? <span>·{effect.remaining}</span> : null}
                      </span>)}</span> : null}
                    </button>
                  );
                })}
          {units.length === 0 ? <span className="wr-empty">没有记录单位</span> : null}
        </div>
      </section>
    );
  };

  return (
    <div className="wod-report" aria-label="战报">
      <div className="wr-floors" role="group" aria-label="选择楼层">
        {floors.map((item, i) => (
          <button
            key={item.floor}
            type="button"
            className="wr-floor"
            aria-pressed={i === floorIndex}
            data-outcome={item.victory ? "victory" : "defeat"}
            onClick={() => changeFloor(i)}
          >
            <span className="wr-floor-no">{item.floor}</span>
            <span>{item.name}</span>
            <small>{item.rounds} 回合</small>
          </button>
        ))}
      </div>
      <div className="wr-roundbar">
        <button type="button" className="wr-roundbar-arrow" aria-label="上一回合" disabled={round <= 1} onClick={() => changeRound(round - 1)}>
          <ChevronLeft />
        </button>
        <div className="wr-rounds" role="group" aria-label="选择回合">
          {floor.frames.map((item) => {
            const end = item.steps[item.steps.length - 1]!.state;
            const ownUnits = floor.units.filter((unit) => unit.side === "hero");
            const foeUnits = floor.units.filter((unit) => unit.side === "enemy");
            const ownMax = ownUnits.reduce((sum, unit) => sum + (unit.maxHp ?? 1), 0) || 1;
            const foeMax = foeUnits.reduce((sum, unit) => sum + (unit.maxHp ?? 1), 0) || 1;
            const own = ownUnits.reduce((sum, unit) => sum + Math.max(0, end[unit.key]?.hp ?? 0), 0);
            const foe = foeUnits.reduce((sum, unit) => sum + Math.max(0, end[unit.key]?.hp ?? 0), 0);
            const deaths = item.groups.some((group) => group.results.some((result) => result.down))
              || item.ticks.some((group) => group.kind === "ticks" && group.rows.some((row) => row.kind === "down"));
            return (
              <button
                type="button"
                key={item.round}
                className="wr-round"
                aria-pressed={item.round === round}
                aria-label={`第 ${item.round} 回合`}
                onClick={() => changeRound(item.round)}
              >
                <span className="wr-round-no">{item.round}</span>
                <span className="wr-round-bars">
                  <i className="own" style={{ height: `${Math.max(4, Math.min(26, (own / ownMax) * 26))}px` }} />
                  <i className="foe" style={{ height: `${Math.max(4, Math.min(26, (foe / foeMax) * 26))}px` }} />
                </span>
                {deaths ? <span className="wr-round-skull"><Skull /></span> : null}
              </button>
            );
          })}
        </div>
        <button type="button" className="wr-roundbar-arrow" aria-label="下一回合" disabled={round >= floor.frames.length} onClick={() => changeRound(round + 1)}>
          <ChevronRight />
        </button>
      </div>
      <div className="wr-round-legend">
        <span><i className="own" />我方剩余生命</span>
        <span><i className="foe" />敌方剩余生命</span>
      </div>

      {/* 本层统计 */}
      <details className="wr-stats" open={statsOpen} onToggle={(event) => setStatsOpen((event.target as HTMLDetailsElement).open)}>
        <summary>
          <ChartNoAxesColumn />
          <strong>本层统计</strong>
          <span>伤害 / 承受 / 治疗 / 命中 / 击倒 · 点单位看技能</span>
          <span className="meta">{floor.units.length} 名参战单位</span>
        </summary>
        <div className="wr-stats-body">
          <div className="wr-table-wrap">
            <table className="wr-table">
              <thead>
                <tr>
                  <th>单位</th><th>造成伤害</th><th>承受伤害</th>
                  <th className="hide-narrow">治疗量</th><th className="hide-narrow">命中</th>
                  <th className="hide-narrow">暴击</th><th>击倒</th>
                </tr>
              </thead>
              <tbody>
                {floor.units.map((unit) => {
                  const row = floor.stats[unit.key] ?? { dealt: 0, taken: 0, heal: 0, hits: 0, attacks: 0, crits: 0, downs: 0, skills: [], dieAt: null };
                  const end = floor.endState[unit.key];
                  const die = row.dieAt ? `第 ${row.dieAt.round} 回合被 ${row.dieAt.skill} 击倒` : (end?.hp ?? 0) > 0 ? "存活" : "倒下";
                  const maxDealt = Math.max(1, ...floor.units.map((u) => floor.stats[u.key]?.dealt ?? 0));
                  const maxTaken = Math.max(1, ...floor.units.map((u) => floor.stats[u.key]?.taken ?? 0));
                  const maxHeal = Math.max(1, ...floor.units.map((u) => floor.stats[u.key]?.heal ?? 0));
                  const open = openSkills.has(unit.key);
                  const Icon = unitIcon(unit);
                  const hasSkills = (row.skills?.length ?? 0) > 0;
                  return (
                    <>
                      <tr
                        key={unit.key}
                        className={`wr-unit-row ${hasSkills ? "expandable" : ""}`}
                        onClick={hasSkills ? () => {
                          setOpenSkills((current) => {
                            const next = new Set(current);
                            if (next.has(unit.key)) next.delete(unit.key); else next.add(unit.key);
                            return next;
                          });
                        } : undefined}
                      >
                        <td>
                          <div className="unit-cell">
                            <span className="wr-sigil" style={{ "--sigil": unit.color ?? (unit.side === "hero" ? "#c9a85f" : "#d07878") } as React.CSSProperties}>
                              <Icon />
                            </span>
                            <span>{unit.name}<br /><span className="sub">{die}</span></span>
                            {hasSkills ? <span className="wr-skill-caret"><ChevronDown /></span> : null}
                          </div>
                        </td>
                        <td className="wr-bar-cell"><div className="wr-barcell"><span className="bar"><i className={unit.side === "hero" ? "own" : "foe"} style={{ width: `${(row.dealt / maxDealt) * 100}%` }} /></span>{row.dealt}</div></td>
                        <td className="wr-bar-cell"><div className="wr-barcell"><span className="bar"><i className="foe" style={{ width: `${(row.taken / maxTaken) * 100}%` }} /></span>{row.taken}</div></td>
                        <td className="wr-bar-cell hide-narrow"><div className="wr-barcell"><span className="bar"><i className="heal" style={{ width: `${(row.heal / maxHeal) * 100}%` }} /></span>{row.heal}</div></td>
                        <td className="hide-narrow">{row.hits}/{row.attacks}</td>
                        <td className="hide-narrow">{row.crits}</td>
                        <td>{row.downs}</td>
                      </tr>
                      {hasSkills && open ? (
                        <tr className="wr-skill-row" key={`${unit.key}-skills`}>
                          <td colSpan={7}>
                            <div className="wr-skill-list">
                              {row.skills.map((skill) => (
                                <div className="wr-skill-line" key={skill.name}>
                                  <b>{skill.name}</b>
                                  <span>{skill.uses} 次</span>
                                  <span>命中 {skill.hits}/{skill.attempts}</span>
                                  <span className="num">{skill.dmg ? `伤害 ${skill.dmg}` : skill.heal ? `治疗 ${skill.heal}` : ""}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {/* 当前动作卡（整行，高度按回合锁定） */}
      <div className="wr-now-slot" ref={slotRef} style={{ minHeight: slotHeight ? `${slotHeight}px` : undefined }}>
        <NowCard frame={frame} index={index} unitOf={unitOf} round={frame.round} />
        <div className="wr-now-probe" aria-hidden="true" ref={probeRef}>
          {frame.steps.map((_, i) => (
            <div key={i} className="wr-now-probe-card">
              <NowCard frame={frame} index={i} unitOf={unitOf} round={frame.round} />
            </div>
          ))}
        </div>
      </div>

      {/* 回放控制 */}
      <div className="wr-now-nav">
        <div className="wr-nav-group">
          <button type="button" className="wr-nav-btn" aria-label="上一步" disabled={index <= 0} onClick={() => stepBy(-1)}><ChevronLeft /></button>
          <button
            type="button"
            className="wr-nav-btn wr-nav-play"
            aria-pressed={playing}
            onClick={() => {
              if (playing) { setPlaying(false); return; }
              if (focus) {
                const first = findFocusStep(frame, step, 1, focus);
                if (first != null) setStep(first);
              } else if (step == null) {
                setStep(0);
              }
              setPlaying(true);
            }}
          >
            {playing ? <Pause /> : <Play />}{playing ? "暂停" : "回放"}
          </button>
          <button type="button" className="wr-nav-btn" aria-label="下一步" disabled={atEnd} onClick={() => stepBy(1)}><ChevronRight /></button>
        </div>
        <span className="wr-nav-step">{atEnd ? "回合结束" : `第 ${index}/${maxStep} 步`}</span>
        {atEnd ? null : (
          <button type="button" className="wr-nav-end" onClick={() => { setStep(null); setPlaying(false); }}>看回合结果</button>
        )}
      </div>

      {/* 战场：整行，我方左 / 敌方右 */}
      <div className="wr-battlefield-note" aria-label="敌我站位说明">
        <strong>战场站位</strong>
        <span>左侧：我方</span>
        <span>右侧：敌方</span>
        <span>前排 · 游走 · 后排</span>
      </div>
      <div className="wr-boards">
        {board("hero")}
        {board("enemy")}
      </div>

      {/* 聊天式动作流 */}
      <section className="wr-feed" aria-label="回合动作">
        <div className="wr-feed-head">
          <div className="wr-feed-round">
            <button type="button" className="wr-feed-round-btn" aria-label="上一回合" disabled={round <= 1} onClick={() => changeRound(round - 1)}><ChevronLeft /></button>
            <h3>第 {frame.round} 回合</h3>
            <button type="button" className="wr-feed-round-btn" aria-label="下一回合" disabled={round >= floor.frames.length} onClick={() => changeRound(round + 1)}><ChevronRight /></button>
          </div>
          <span className="wr-round-summary">{roundSummary} · 我方靠左，敌方靠右</span>
          {focusUnitData ? (
            <span className="wr-focus">
              只看 <Crosshair /> {focusUnitData.name}
              <button type="button" aria-label="取消只看" onClick={() => { setFocus(null); setPlaying(false); }}><X /></button>
            </span>
          ) : null}
        </div>
        <div className="wr-chat">
          {showTicks ? frame.ticks.map((group, i) => {
            const at = i + 1;
            const stepState = stateOf(at, step);
            if (group.kind === "stun") {
              const unit = unitOf(group.key);
              return (
                <Bubble key={group.key} side={unit.side} stepState={stepState} focusOut={Boolean(focus && focus !== unit.key)}
                  onClick={() => setStep(at)} className="wr-bubble-system">
                  <span className="wr-bubble-head">
                    <span className={`who ${unit.side === "hero" ? "h" : "e"}`}>{unit.name}</span>
                    <span className="wr-bubble-meta"><Zap />眩晕</span>
                  </span>
                  <span className="wr-bubble-body"><span className="wr-line">本回合无法行动</span></span>
                </Bubble>
              );
            }
            const unit = unitOf(group.unit);
            const dmg = group.rows.filter((row) => row.kind === "damage");
            const heal = group.rows.filter((row) => row.kind === "heal");
            const sources = [...new Set(group.rows.map((row) => row.source).filter(Boolean))];
            return (
              <Bubble key={group.key} side={unit.side} stepState={stepState} focusOut={Boolean(focus && focus !== unit.key)}
                onClick={() => setStep(at)} className="wr-bubble-tick">
                <span className="wr-bubble-head"><span className="wr-bubble-meta">回合开始 · {sources.join("、") || "持续效果"}</span></span>
                <span className="wr-bubble-body">
                  {dmg.length > 0 ? (
                    <span className="wr-line">
                      <span className={`wr-line-target ${unit.side === "enemy" ? "e" : ""}`}>{unit.name}</span>
                      <span className="wr-amount dmg">−{dmg.reduce((sum, row) => sum + row.amount, 0)}</span>
                      <span className="wr-type">{[...new Set(dmg.map((row) => (row.damageType ? DAMAGE_TYPE_LABELS[row.damageType] : "")))].filter(Boolean).join("、") || "持续"}伤害</span>
                      {dmg.some((row) => row.kind === "down") ? <span className="wr-badge red ghost"><Skull />击倒</span> : null}
                    </span>
                  ) : null}
                  {heal.length > 0 ? (
                    <span className="wr-line">
                      <span className={`wr-line-target ${unit.side === "enemy" ? "e" : ""}`}>{unit.name}</span>
                      <span className="wr-amount heal">+{heal.reduce((sum, row) => sum + row.amount, 0)}</span>
                      <span className="wr-type">生命</span>
                    </span>
                  ) : null}
                </span>
              </Bubble>
            );
          }) : null}

          {frame.groups.map((group, i) => {
            const at = frame.ticks.length + i + 1;
            const stepState = stateOf(at, step);
            const unit = unitOf(group.act);
            const touch = group.results.map((result) => result.key);
            const focusOut = Boolean(focus && group.act !== focus && !touch.includes(focus));
            const pureEffect = group.results.every((result) => result.effect && result.kind !== "damage" && result.kind !== "crit" && result.kind !== "miss" && result.kind !== "heal");
            const nodes: React.ReactNode[] = [];
            const previousPhase = frame.groups[i - 1]?.phase;
            if (group.phase !== previousPhase && SKILL_PHASE_LABELS[group.phase]) {
              nodes.push(
                <div className="wr-chat-phase" key={`phase-${group.key}`}><span>{SKILL_PHASE_LABELS[group.phase]}</span></div>,
              );
            }
            if (pureEffect) {
              const byTarget: Array<{ unit: ReportUnit; effects: ReportEffect[] }> = [];
              for (const result of group.results) {
                if (!result.effect) continue;
                const row = byTarget.find((item) => item.unit.key === result.key);
                if (row) row.effects.push(result.effect);
                else byTarget.push({ unit: unitOf(result.key), effects: [result.effect] });
              }
              const isBuff = byTarget[0]?.effects.some((effect) => effectIsBeneficial(effect)) ?? true;
              nodes.push(
                <Bubble key={group.key} side={unit.side} stepState={stepState} focusOut={focusOut} onClick={() => setStep(at)} className="wr-bubble-effect">
                  <span className="wr-bubble-head">
                    <span className="wr-sigil" style={{ "--sigil": unit.color ?? (unit.side === "hero" ? "#c9a85f" : "#d07878") } as React.CSSProperties}>{(() => { const EffectIcon = unitIcon(unit); return <EffectIcon />; })()}</span>
                    <span className="wr-bubble-label">角色</span>
                    <span className={`who ${unit.side === "hero" ? "h" : "e"}`}>{unit.name}</span>
                    <span className="wr-bubble-label">行为</span>
                    <span className="skill">{group.an}</span>
                    <span className={`wr-badge ${isBuff ? "blue" : "purple"} ghost`}>{isBuff ? "增益" : "减益"}</span>
                    {byTarget.length > 1 ? <span className="wr-bubble-meta">{byTarget.length} 名单位</span> : null}
                  </span>
                  <span className="wr-bubble-body">
                    {byTarget.map((row) => (
                      <span className="wr-line wr-effect-target-line" key={row.unit.key}>
                        <span className={`wr-line-target ${row.unit.side === "enemy" ? "e" : ""}`}>目标：{row.unit.name}</span>
                        {row.effects.map((effect, at2) => (
                          <span className={`wr-fx ${effectToneClass(effect)}`} key={at2}>
                            {effect.type === "dot" ? <Flame /> : effect.type === "stun" ? <Zap /> : null}
                            {effectText(effect)}
                            {effect.remaining ? ` ·${effect.remaining}` : ""}
                          </span>
                        ))}
                      </span>
                    ))}
                  </span>
                </Bubble>,
              );
              return nodes;
            }
            const targetCount = new Set(group.results.map((result) => result.key)).size;
            const multi = targetCount > 1;
            const Icon = unitIcon(unit);
            nodes.push(
              <Bubble key={group.key} side={unit.side} stepState={stepState} focusOut={focusOut} onClick={() => setStep(at)} className="wr-bubble-action">
                <span className="wr-bubble-head">
                  <span className="wr-sigil" style={{ "--sigil": unit.color ?? (unit.side === "hero" ? "#c9a85f" : "#d07878") } as React.CSSProperties}><Icon /></span>
                  <span className="wr-bubble-label">角色</span>
                  <span className={`who ${unit.side === "hero" ? "h" : "e"}`}>{unit.name}</span>
                  <span className="wr-bubble-label">行为</span>
                  <span className="skill">{group.an}</span>
                  {multi ? <span className="wr-bubble-meta">{targetCount} 个目标</span> : null}
                </span>
                <span className="wr-bubble-body">
                  {group.results.map((result, at2) => (
                    <ResultLine key={at2} result={result} unit={unitOf(result.key)} multi={multi} />
                  ))}
                </span>
              </Bubble>,
            );
            return nodes;
          })}
        </div>
      </section>

      <div className="wr-foot">
        {meta.startAt ? <span>{new Date(meta.startAt).toLocaleString("zh-CN")}</span> : null}
        <span>点按单位可只看它；点按动作可回放到那一步</span>
        <span>逐回合回放，或按 ← → 切换回合</span>
      </div>
    </div>
  );
}

function stateOf(at: number, step: number | null): StepState {
  if (step == null) return "done";
  if (step === at) return "current";
  return step > at ? "done" : "todo";
}

function Bubble({
  side,
  stepState,
  focusOut,
  onClick,
  className,
  children,
}: {
  side: "hero" | "enemy";
  stepState: StepState;
  focusOut: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="wr-chat-row"
      data-side={side}
      data-step={stepState}
      data-focus={focusOut ? "out" : "in"}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <article className={`wr-bubble ${className}`}>{children}</article>
    </div>
  );
}

function ResultLine({ result, unit }: { result: ReportResult; unit: ReportUnit; multi?: boolean }) {
  return <TargetDetail result={result} unit={unit} />;
}

function TargetDetail({ result, unit }: { result: ReportResult; unit: ReportUnit }) {
  const isMiss = result.kind === "miss";
  const isHeal = result.kind === "heal";
  const hasHp = result.hpBefore !== undefined || result.hpAfter !== undefined;
  const hp = result.hpAfter ?? result.hpBefore;
  const hpDelta = result.hpBefore !== undefined && result.hpAfter !== undefined
    ? result.hpAfter - result.hpBefore
    : result.kind === "heal"
      ? result.amount
      : result.kind === "damage" || result.kind === "crit"
        ? -result.amount
        : undefined;
  const hasHit = result.hitChance !== undefined;
  const hasCrit = result.critChance !== undefined;
  const hpLabel = unit.maxHp ? `${Math.max(0, Math.round(hp ?? 0))}/${unit.maxHp}` : hp !== undefined ? `${Math.max(0, Math.round(hp))}` : "—";
  const ailment = result.ailment;
  return (
    <span className="wr-target-detail">
      <strong className={`wr-detail-target ${unit.side === "enemy" ? "e" : ""}`}>{unit.name}</strong>
      {hasHp ? (
        <span className="wr-detail-hp" title={`生命 ${hpLabel}`}>
          <span className="wr-hpmini wr-detail-hpbar" aria-hidden="true">
            <span className={unit.side === "enemy" ? "enemy" : ""} style={{ width: pct(hp ?? 0, unit.maxHp) }} />
          </span>
          <span className="wr-detail-value">{hpLabel}</span>
        </span>
      ) : null}
      {hpDelta !== undefined && hpDelta !== 0 ? (
        <strong className={`wr-detail-delta ${hpDelta > 0 ? "heal" : "dmg"}`}>{hpDelta > 0 ? "+" : ""}{Math.round(hpDelta)}</strong>
      ) : null}
      {result.damageType ? <span className="wr-detail-type">（{DAMAGE_TYPE_LABELS[result.damageType] ?? result.damageType}）</span> : null}
      {hasCrit ? <span className={result.crit ? "wr-detail-positive" : "wr-detail-muted"}>{result.crit ? "暴击" : "未暴击"}（{Math.round(result.critChance! * 100)}%）</span> : null}
      {hasHit ? <span className={result.hit === false ? "wr-detail-negative" : "wr-detail-positive"}>{result.hit === false ? "未命中" : "命中"}（{Math.round(result.hitChance! * 100)}%）</span> : null}
      {ailment ? <span className={ailment.triggered ? "wr-detail-positive" : "wr-detail-muted"}>{ailment.triggered ? `触发【${AILMENT_LABELS[ailment.ailment]}】` : `${AILMENT_LABELS[ailment.ailment]} +${ailment.delta}（${ailment.after}/${ailment.threshold}）`}</span> : null}
      {isHeal && result.resource ? <span className="wr-detail-positive">{result.resource === "energy" ? "法力" : "生命"}</span> : null}
      {!hasHit && isMiss ? <span className="wr-detail-negative">未命中</span> : null}
      {result.effect ? <span className={`wr-fx ${effectToneClass(result.effect)}`}>
        {result.effect.type === "dot" ? <Flame /> : result.effect.type === "stun" ? <Zap /> : result.effect.type === "shield" ? <Shield /> : null}
        {effectText(result.effect)}
      </span> : null}
      {result.down ? <span className="wr-detail-negative"><Skull />击倒</span> : null}
    </span>
  );
}

function NowCard({
  frame,
  index,
  unitOf,
  round,
}: {
  frame: ReportFrame;
  index: number;
  unitOf: (key: string) => ReportUnit;
  round: number;
}) {
  return (
    <div className="wr-now" data-tone={toneFor(frame, index)}>
      {renderNowContent(frame, index, unitOf, round)}
    </div>
  );
}

function toneFor(frame: ReportFrame, index: number): string {
  if (index === frame.steps.length - 1) return "idle";
  if (index === 0) return "idle";
  if (index <= frame.ticks.length) {
    const group = frame.ticks[index - 1]!;
    if (group.kind === "stun") return "stun";
    return group.rows.some((row) => row.kind === "damage") ? "hit" : "heal";
  }
  const group = frame.groups[index - frame.ticks.length - 1];
  if (!group) return "idle";
  if (group.results.every((result) => result.kind === "miss")) return "miss";
  if (group.results.some((result) => result.kind === "heal")) return "heal";
  return "hit";
}

function renderNowContent(
  frame: ReportFrame,
  index: number,
  unitOf: (key: string) => ReportUnit,
  round: number,
): React.ReactNode {
  const tickCount = frame.ticks.length;
  if (index === frame.steps.length - 1) {
    const end = frame.steps[index]!.state;
    const start = frame.base;
    let dealt = 0;
    let taken = 0;
    let missed = 0;
    const downs = new Set<string>();
    for (const [key, value] of Object.entries(end)) {
      const before = start[key]?.hp ?? value.hp;
      const unit = unitOf(key);
      const delta = value.hp - before;
      if (unit.side === "enemy") dealt += Math.max(0, -delta);
      else taken += Math.max(0, -delta);
    }
    for (const group of frame.groups) {
      for (const result of group.results) {
        if (result.kind === "miss") missed += 1;
        if (result.down) downs.add(unitOf(result.key).name);
      }
    }
    for (const group of frame.ticks) {
      if (group.kind !== "ticks") continue;
      for (const row of group.rows) if (row.kind === "down") downs.add(unitOf(row.key).name);
    }
    return (
      <>
        <div className="wr-now-head">
          <b>第 {round} 回合结束</b>
          <span className="wr-now-sub">造成 <b>{dealt}</b> · 承受 <b className="wr-red">{taken}</b>{missed ? ` · 未命中 ${missed}` : ""}</span>
          {downs.size ? <span className="wr-badge red ghost"><Skull />{[...downs].join("、")} 倒下</span> : null}
        </div>
      </>
    );
  }
  if (index === 0) {
    return (
      <div className="wr-now-head">
        <b>第 {round} 回合开始</b>
        <span className="wr-now-sub">点右侧动作逐条推进，或按 ▶ 回放</span>
      </div>
    );
  }
  if (index <= tickCount) {
    const group = frame.ticks[index - 1]!;
    if (group.kind === "stun") {
      const unit = unitOf(group.key);
      return (
        <div className="wr-now-head">
          <span className="wr-now-actor">{unit.name}</span>
          <span className="wr-badge purple ghost"><Zap />眩晕</span>
          <span className="wr-now-sub">本回合无法行动</span>
        </div>
      );
    }
    const unit = unitOf(group.unit);
    const dmg = group.rows.filter((row) => row.kind === "damage");
    const heal = group.rows.filter((row) => row.kind === "heal");
    const sources = [...new Set(group.rows.map((row) => row.source).filter(Boolean))];
    return (
      <>
        <div className="wr-now-head">
          {dmg.length ? <Flame /> : <HeartPulse />}
          <span className="wr-now-actor">{sources.join("、") || "持续效果"}</span>
          <span className="wr-now-skill">持续效果结算</span>
          <span className="wr-now-arrow">→</span>
          <span className="wr-now-target">{unit.name}</span>
          {dmg.length ? (
            <>
              <b className="wr-red">−{dmg.reduce((sum, row) => sum + row.amount, 0)}</b>
              <span className="wr-now-type">
                {[...new Set(dmg.map((row) => (row.damageType ? DAMAGE_TYPE_LABELS[row.damageType] : "")))].filter(Boolean).join("、") || "持续"}伤害
              </span>
            </>
          ) : (
            <>
              <b className="wr-green">+{heal.reduce((sum, row) => sum + row.amount, 0)}</b>
              <span className="wr-now-type">生命</span>
            </>
          )}
          {group.rows.some((row) => row.kind === "down") ? <span className="wr-badge red ghost"><Skull />击倒</span> : null}
        </div>
      </>
    );
  }
  const group = frame.groups[index - tickCount - 1];
  if (!group) return null;
  const actor = unitOf(group.act);
  const grouped: Array<{ unit: ReportUnit; rows: ReportResult[] }> = [];
  for (const result of group.results) {
    const row = grouped.find((item) => item.unit.key === result.key);
    if (row) row.rows.push(result);
    else grouped.push({ unit: unitOf(result.key), rows: [result] });
  }
  const multi = grouped.length > 1;
  const Icon = unitIcon(actor);
  return (
    <>
      <div className="wr-now-head">
        <span className="wr-sigil" style={{ "--sigil": actor.color ?? (actor.side === "hero" ? "#c9a85f" : "#d07878") } as React.CSSProperties}><Icon /></span>
        <span className="wr-now-actor-label">角色</span>
        <span className={`wr-now-actor ${actor.side === "hero" ? "h" : "e"}`}>{actor.name}</span>
        <span className="wr-now-actor-label">行为</span>
        <span className="wr-now-skill">【{group.an}】</span>
      </div>
      <div className="wr-now-results">
        {grouped.map((item) => (
          <div className={`wr-now-result ${multi ? "multi" : ""}`} key={item.unit.key}>
            <TargetDetail result={item.rows[0]!} unit={item.unit} />
            {item.rows.slice(1).map((result, i) => <TargetDetail key={i} result={result} unit={item.unit} />)}
          </div>
        ))}
      </div>
    </>
  );
}
