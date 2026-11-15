import type {
  CombatLogAilmentProgress,
  CombatLogEffect,
  CombatLogEntry,
  DamageType,
  EncounterResult,
  ModifierKind,
  SkillPhase,
} from "@wod/shared";

/** 战报里的一个参战单位。maxHp 为 null 表示旧战报里从未记录过生命值。 */
export interface ReportUnit {
  key: string;
  id: string;
  name: string;
  side: "hero" | "enemy";
  level: number;
  position: "front" | "flank" | "back" | "center" | null;
  maxHp: number | null;
  maxEnergy: number | null;
  startHp: number;
  startEnergy: number;
  weaponType?: string | null;
  weaponName?: string | null;
  /** 旧战报从未记录过该单位的生命值。 */
  hpEstimated?: boolean;
  color?: string | null;
  monsterId?: string | null;
}

export interface ReportEffect {
  type: CombatLogEffect["type"];
  /** mod 效果的修正种类。 */
  kind?: ModifierKind;
  amount?: number;
  damage?: number;
  damageType?: DamageType;
  /** shield 当前剩余吸收量。 */
  value?: number;
  /** reflect 反伤比例。 */
  percent?: number;
  /** 中毒/伤口层数。 */
  stacks?: number;
  remaining: number;
  source: string;
}

export interface ReportResult {
  key: string;
  kind: CombatLogEntry["kind"];
  amount: number;
  hpBefore?: number;
  hpAfter?: number;
  attack?: number;
  defense?: number;
  margin?: number;
  hitChance?: number;
  hit?: boolean;
  critChance?: number;
  crit: boolean;
  missReason?: "hit-chance";
  damageType?: DamageType;
  resource?: "hp" | "energy";
  effect?: ReportEffect;
  dot?: boolean;
  down?: boolean;
  /** 持续效果来源名称（tick 行使用）。 */
  source?: string;
  /** 本次伤害带来的异常积累变化。 */
  ailment?: CombatLogAilmentProgress;
  /** 护盾在本次受击前后的剩余值与吸收量。 */
  shieldBefore?: number;
  shieldAfter?: number;
  shieldAbsorbed?: number;
}

export interface ReportAction {
  kind: "action";
  key: string;
  act: string;
  actSide: "hero" | "enemy";
  an: string;
  phase: SkillPhase;
  cost: number;
  enBefore?: number;
  enAfter?: number;
  results: ReportResult[];
}

export interface ReportTicks {
  kind: "ticks";
  key: string;
  unit: string;
  rows: ReportResult[];
}

export interface ReportStun {
  kind: "stun";
  key: string;
  source: string;
}

export type ReportGroup = ReportAction | ReportTicks | ReportStun;

export interface ReportStateUnit {
  hp: number;
  en: number;
  effects: ReportEffect[];
}

export interface ReportStep {
  key: string;
  state: Record<string, ReportStateUnit>;
}

export interface ReportFrame {
  round: number;
  base: Record<string, ReportStateUnit>;
  ticks: Array<ReportTicks | ReportStun>;
  groups: ReportAction[];
  steps: ReportStep[];
}

export interface ReportSkillStat {
  name: string;
  uses: number;
  hits: number;
  attempts: number;
  dmg: number;
  heal: number;
}

export interface ReportUnitStats {
  dealt: number;
  taken: number;
  heal: number;
  healed: number;
  attacks: number;
  hits: number;
  crits: number;
  downs: number;
  dotDealt: number;
  dotTaken: number;
  dieAt: { round: number; skill: string } | null;
  skills: ReportSkillStat[];
}

export interface ReportFloor {
  floor: number;
  name: string;
  description: string;
  rounds: number;
  victory: boolean;
  timeout: boolean;
  dealt: number;
  taken: number;
  units: ReportUnit[];
  start: Record<string, { hp: number; en: number }>;
  frames: ReportFrame[];
  stats: Record<string, ReportUnitStats>;
  endState: Record<string, ReportStateUnit>;
}

export interface ReportHeroInfo {
  id: string;
  name: string;
  level: number;
  weaponType?: string;
  weaponName?: string;
  weaponColor?: string;
}

export interface RouteEncounterInfo {
  name: string;
  monsters: Array<{ name: string; monsterId: string; count: number }>;
}

const MONSTER_POSITIONS = ["front", "flank", "back"] as const;

/** 把引擎日志整理成战报视图模型。旧战报没有开战名单时，从日志反推。 */
export function buildReport(input: {
  encounters: EncounterResult[];
  heroes: ReportHeroInfo[];
  routeEncounters?: RouteEncounterInfo[];
  /** 按单位 id 覆盖阵营（决斗：双方都是英雄侧，把防守方标为敌方）。 */
  sideOverrides?: Record<string, "hero" | "enemy">;
}): ReportFloor[] {
  const floors: ReportFloor[] = [];
  const lastState = new Map<string, ReportStateUnit>();

  input.encounters.forEach((encounter, index) => {
    floors.push(buildFloor(encounter, index, input, lastState));
  });
  return floors;
}

function buildFloor(
  encounter: EncounterResult,
  index: number,
  input: {
    heroes: ReportHeroInfo[];
    routeEncounters?: RouteEncounterInfo[];
    sideOverrides?: Record<string, "hero" | "enemy">;
  },
  lastState: Map<string, ReportStateUnit>,
): ReportFloor {
  const route = input.routeEncounters?.[index];
  const roster = encounter.combatants;

  // ---------- 单位 ----------
  const units = new Map<string, ReportUnit>();
  const heroByName = new Map(input.heroes.map((hero) => [hero.name, hero]));
  const spawnByName = new Map<string, { monsterId: string; position: ReportUnit["position"] }>();
  if (route) {
    const seen = new Map<string, number>();
    let slot = 0;
    for (const group of route.monsters) {
      for (let i = 0; i < group.count; i += 1) {
        const display = group.count > 1 ? `${group.name} ${i + 1}` : group.name;
        spawnByName.set(display, { monsterId: group.monsterId, position: MONSTER_POSITIONS[Math.min(slot, 2)] ?? "front" });
        seen.set(group.name, (seen.get(group.name) ?? 0) + 1);
        slot += 1;
      }
    }
  }

  const addHero = (name: string): ReportUnit => {
    const info = heroByName.get(name);
    const key = info ? `h:${info.id}` : `h:${name}`;
    if (!units.has(key)) {
      const prev = lastState.get(key);
      units.set(key, {
        key,
        id: info?.id ?? name,
        name,
        side: "hero",
        level: info?.level ?? 1,
        position: null,
        maxHp: null,
        maxEnergy: null,
        startHp: prev?.hp ?? 0,
        startEnergy: 0,
        weaponType: info?.weaponType ?? null,
        weaponName: info?.weaponName ?? null,
        color: info?.weaponColor ?? null,
      });
    }
    return units.get(key)!;
  };
  const addEnemy = (name: string): ReportUnit => {
    const key = `e:${index}:${name}`;
    if (!units.has(key)) {
      const spawn = spawnByName.get(name);
      units.set(key, {
        key,
        id: key,
        name,
        side: "enemy",
        level: 1,
        position: spawn?.position ?? null,
        maxHp: null,
        maxEnergy: null,
        startHp: 0,
        startEnergy: 0,
        monsterId: spawn?.monsterId ?? null,
      });
    }
    return units.get(key)!;
  };
  const unitByParticipant = (participant: { name: string; side: "hero" | "enemy" }): ReportUnit =>
    participant.side === "hero" ? addHero(participant.name) : addEnemy(participant.name);

  // 名单优先，其次日志里出现过的单位
  if (roster && roster.length > 0) {
    for (const row of roster) {
      const unit = row.side === "hero" ? addHero(row.name) : addEnemy(row.name);
      unit.id = row.id;
      unit.level = row.level;
      unit.position = row.position;
      unit.maxHp = row.maxHp;
      unit.maxEnergy = row.maxEnergy;
      unit.startHp = row.startHp;
      unit.startEnergy = row.startEnergy;
    }
  }
  for (const entry of encounter.log) {
    if (entry.actor) unitByParticipant(entry.actor);
    if (entry.target) unitByParticipant(entry.target);
  }
  // 日志里补最大生命/法力与起始值
  for (const entry of encounter.log) {
    if (entry.target && entry.maxHp) unitByParticipant(entry.target).maxHp ??= entry.maxHp;
    if (entry.actor && entry.maxEnergy) unitByParticipant(entry.actor).maxEnergy ??= entry.maxEnergy;
  }
  const unitList = [...units.values()];
  for (const unit of unitList) {
    const override = input.sideOverrides?.[unit.id];
    if (override && unit.side !== override) unit.side = override;
  }

  // ---------- 状态 ----------
  const state = new Map<string, ReportStateUnit>();
  const start: Record<string, { hp: number; en: number }> = {};
  for (const unit of unitList) {
    const prev = roster ? null : lastState.get(unit.key);
    const hp = roster ? unit.startHp : prev?.hp ?? unit.startHp;
    const en = roster ? unit.startEnergy : prev?.en ?? unit.startEnergy;
    state.set(unit.key, { hp, en, effects: [] });
    start[unit.key] = { hp, en };
  }
  // 旧战报：从第一条记录反推起始法力
  if (!roster) {
    const firstEnergy = new Map<string, { before: number; round: number }>();
    for (const entry of encounter.log) {
      if (entry.actor && entry.energyBefore !== undefined && entry.kind !== "down" && !firstEnergy.has(entry.actor.name)) {
        firstEnergy.set(entry.actor.name, { before: entry.energyBefore, round: entry.round });
      }
    }
    for (const [name, info] of firstEnergy) {
      const unit = unitList.find((row) => row.name === name);
      if (!unit) continue;
      const restored = Math.max(0, info.before - 6 * (info.round - 1));
      state.get(unit.key)!.en = restored;
      const base = start[unit.key] ?? { hp: unit.startHp, en: unit.startEnergy };
      start[unit.key] = { ...base, en: restored };
    }
  }

  const snapshot = (): Record<string, ReportStateUnit> =>
    Object.fromEntries(
      unitList.map((unit) => {
        const value = state.get(unit.key)!;
        return [
          unit.key,
          {
            hp: Math.max(0, Math.round(value.hp)),
            en: Math.max(0, Math.round(value.en)),
            effects: value.effects.map((effect) => ({ ...effect })),
          },
        ];
      }),
    );

  // ---------- 统计 ----------
  const stats = new Map<string, ReportUnitStats>();
  const statFor = (key: string): ReportUnitStats => {
    let value = stats.get(key);
    if (!value) {
      value = {
        dealt: 0, taken: 0, heal: 0, healed: 0, attacks: 0, hits: 0, crits: 0, downs: 0,
        dotDealt: 0, dotTaken: 0, dieAt: null, skills: [],
      };
      stats.set(key, value);
    }
    return value;
  };
  const skillFor = (key: string, name: string): ReportSkillStat => {
    const value = statFor(key);
    let skill = value.skills.find((row) => row.name === name);
    if (!skill) {
      skill = { name, uses: 0, hits: 0, attempts: 0, dmg: 0, heal: 0 };
      value.skills.push(skill);
    }
    return skill;
  };

  // ---------- 回合 ----------
  const frames: ReportFrame[] = [];
  const frameByRound = new Map<number, ReportFrame>();
  const actorByName = new Map(unitList.map((unit) => [unit.name, unit]));

  const startRound = (round: number): ReportFrame => {
    const ticks: Array<ReportTicks | ReportStun> = [];
    for (const unit of unitList) {
      const current = state.get(unit.key)!;
      if (current.hp <= 0) continue;
      const hot = current.effects.filter((effect) => effect.type === "hot");
      const dot = current.effects.filter((effect) => effect.type === "dot");
      const row: ReportTicks = { kind: "ticks", key: `ticks-${round}-${unit.key}`, unit: unit.key, rows: [] };
      for (const effect of hot) {
        const healed = Math.min(effect.damage ?? 0, (unit.maxHp ?? current.hp) - current.hp);
        if (healed <= 0) continue;
        const before = current.hp;
        current.hp += healed;
        row.rows.push({ key: unit.key, kind: "heal", amount: healed, hpBefore: before, hpAfter: current.hp, source: effect.source, crit: false });
        statFor(actorByName.get(effect.source)?.key ?? unit.key).heal += healed;
        statFor(unit.key).healed += healed;
      }
      for (const effect of dot) {
        if (current.hp <= 0) continue;
        const dealt = Math.max(1, effect.damage ?? 0);
        const before = current.hp;
        current.hp = Math.max(0, current.hp - dealt);
        row.rows.push({
          key: unit.key, kind: "damage", amount: dealt, hpBefore: before, hpAfter: current.hp,
          source: effect.source, damageType: effect.damageType ?? "crushing", dot: true, crit: false,
        });
        const source = actorByName.get(effect.source);
        if (source) {
          statFor(source.key).dealt += dealt;
          statFor(source.key).dotDealt += dealt;
        }
        statFor(unit.key).taken += dealt;
        statFor(unit.key).dotTaken += dealt;
        if (current.hp <= 0) {
          row.rows.push({ key: unit.key, kind: "down", amount: 0, crit: false, source: effect.source });
          if (source) statFor(source.key).downs += 1;
          statFor(unit.key).dieAt = { round, skill: "持续伤害" };
        }
      }
      if (row.rows.length > 0) ticks.push(row);
      if (current.hp <= 0) {
        current.effects = [];
        continue;
      }
      if (current.effects.some((effect) => effect.type === "stun")) {
        ticks.push({ kind: "stun", key: unit.key, source: current.effects.find((e) => e.type === "stun")?.source ?? "?" });
      }
      for (const effect of current.effects) effect.remaining -= 1;
      current.effects = current.effects.filter((effect) => effect.remaining > 0);
    }
    for (const unit of unitList) {
      const current = state.get(unit.key)!;
      if (current.hp <= 0) continue;
      current.en = Math.min(unit.maxEnergy ?? current.en, current.en + 6);
    }
    const frame: ReportFrame = { round, base: snapshot(), ticks, groups: [], steps: [] };
    frameByRound.set(round, frame);
    frames.push(frame);
    return frame;
  };

  const actions = new Map<string, ReportAction>();
  for (const entry of encounter.log) {
    if (entry.round <= 0 || entry.kind === "system") continue;
    let frame = frameByRound.get(entry.round);
    if (!frame) frame = startRound(entry.round);

    if (entry.kind === "down" && !entry.actionId) {
      const unit = entry.target ? unitByParticipant(entry.target) : null;
      if (!unit) continue;
      let attached = false;
      for (let i = frame.groups.length - 1; i >= 0 && !attached; i -= 1) {
        const group = frame.groups[i]!;
        const row = [...group.results].reverse().find((result) => result.key === unit.key && !result.down);
        if (row) { row.down = true; attached = true; }
      }
      if (!attached) {
        for (let i = frame.ticks.length - 1; i >= 0 && !attached; i -= 1) {
          const group = frame.ticks[i]!;
          if (group.kind !== "ticks") continue;
          const row = [...group.rows].reverse().find((result) => result.key === unit.key && !result.down);
          if (row) { row.down = true; attached = true; }
        }
      }
      const killer = /被 (.+?) 的【(.+?)】击倒/.exec(entry.text ?? "");
      statFor(unit.key).dieAt ??= { round: entry.round, skill: killer?.[2] ?? "?" };
      continue;
    }
    if (!entry.actionId) continue;

    let action = actions.get(entry.actionId);
    if (!action) {
      const actorKey = entry.actor ? unitByParticipant(entry.actor).key : null;
      if (!actorKey) continue;
      action = {
        kind: "action",
        key: entry.actionId,
        act: actorKey,
        actSide: entry.actor?.side ?? "enemy",
        an: entry.actionName ?? "攻击",
        phase: entry.phase ?? "main",
        cost: Math.max(0, (entry.energyBefore ?? 0) - (entry.energyAfter ?? 0)),
        enBefore: entry.energyBefore,
        enAfter: entry.energyAfter,
        results: [],
      };
      actions.set(entry.actionId, action);
      frame.groups.push(action);
      skillFor(actorKey, action.an).uses += 1;
    }
    if (!entry.target) continue;

    const unit = unitByParticipant(entry.target);
    const current = state.get(unit.key)!;
    if (entry.hpAfter !== undefined) current.hp = entry.hpAfter;
    if (entry.actor && entry.energyAfter !== undefined) {
      const actor = state.get(action.act);
      if (actor) actor.en = entry.energyAfter;
    }

    const result: ReportResult = {
      key: unit.key,
      kind: entry.kind,
      amount: entry.amount ?? 0,
      hpBefore: entry.hpBefore,
      hpAfter: entry.hpAfter,
      hitChance: entry.hitChance,
      hit: entry.hit,
      critChance: entry.critChance,
      crit: Boolean(entry.crit),
      missReason: entry.missReason,
      damageType: entry.damageType,
      ailment: entry.ailment,
      resource: entry.resource,
      shieldBefore: entry.shieldBefore,
      shieldAfter: entry.shieldAfter,
      shieldAbsorbed: entry.shieldAbsorbed,
    };
    if (entry.effect) {
      const effect: ReportEffect = {
        type: entry.effect.type,
        kind: entry.effect.kind,
        amount: entry.effect.amount,
        damage: entry.effect.damage,
        damageType: entry.effect.damageType,
        value: entry.effect.value,
        percent: entry.effect.percent,
        remaining: Math.max(1, entry.effect.duration ?? 1),
        source: entry.actor?.name ?? "?",
      };
      // 与引擎一致：同源同类刷新而不是叠加（mod 再按修正种类区分）。
      current.effects = current.effects.filter(
        (row) =>
          !(
            row.source === effect.source &&
            row.type === effect.type &&
            (effect.type !== "mod" || row.kind === effect.kind)
          ),
      );
      current.effects.push(effect);
      result.effect = { ...effect };
    }
    // 护盾吸收：把日志中的护盾余量同步回状态，保持血条上方的护盾条准确。
    if (entry.shieldAfter !== undefined) {
      const shields = current.effects.filter((row) => row.type === "shield");
      const totalBefore = shields.reduce((sum, row) => sum + (row.value ?? 0), 0);
      const delta = totalBefore - (entry.shieldAfter ?? 0);
      if (shields.length > 0 && delta > 0) {
        let left = delta;
        for (const shield of shields) {
          const drain = Math.min(shield.value ?? 0, left);
          shield.value = (shield.value ?? 0) - drain;
          left -= drain;
        }
        current.effects = current.effects.filter((row) => row.type !== "shield" || (row.value ?? 0) > 0);
      }
    }

    const actorStats = statFor(action.act);
    const targetStats = statFor(unit.key);
    const skill = skillFor(action.act, action.an);
    if (entry.kind === "damage" || entry.kind === "crit") {
      actorStats.dealt += entry.amount ?? 0;
      actorStats.hits += 1;
      actorStats.attacks += 1;
      if (entry.crit) actorStats.crits += 1;
      targetStats.taken += entry.amount ?? 0;
      skill.dmg += entry.amount ?? 0;
      skill.hits += 1;
      skill.attempts += 1;
    } else if (entry.kind === "miss") {
      actorStats.attacks += 1;
      skill.attempts += 1;
    } else if (entry.kind === "heal") {
      actorStats.heal += entry.amount ?? 0;
      targetStats.healed += entry.amount ?? 0;
      skill.heal += entry.amount ?? 0;
    }
    action.results.push(result);
  }

  // ---------- 每步状态 ----------
  const snap = (value: Map<string, ReportStateUnit>): Record<string, ReportStateUnit> =>
    Object.fromEntries(
      unitList.map((unit) => {
        const current = value.get(unit.key)!;
        return [
          unit.key,
          {
            hp: Math.max(0, Math.round(current.hp)),
            en: Math.max(0, Math.round(current.en)),
            effects: current.effects.map((effect) => ({ ...effect })),
          },
        ];
      }),
    );

  for (const frame of frames) {
    const working = new Map<string, ReportStateUnit>();
    for (const unit of unitList) {
      const base = frame.base[unit.key]!;
      working.set(unit.key, { hp: base.hp, en: base.en, effects: base.effects.map((effect) => ({ ...effect })) });
    }
    frame.steps.push({ key: "base", state: snap(working) });
    for (const group of frame.ticks) {
      if (group.kind === "ticks") {
        for (const row of group.rows) {
          const current = working.get(row.key);
          if (!current) continue;
          if (row.kind === "damage" || row.kind === "heal") current.hp = row.hpAfter ?? current.hp;
          if (row.kind === "down") current.hp = 0;
        }
      }
      frame.steps.push({ key: `tick-${frame.steps.length}`, state: snap(working) });
    }
    for (const group of frame.groups) {
      const actor = working.get(group.act);
      if (actor && group.enAfter !== undefined) actor.en = group.enAfter;
      for (const result of group.results) {
        const current = working.get(result.key);
        if (!current) continue;
        if (result.hpAfter !== undefined) current.hp = result.hpAfter;
        if (result.effect) {
          const source = unitList.find((unit) => unit.key === group.act)?.name ?? "?";
          current.effects = current.effects.filter(
            (row) =>
              !(
                row.source === source &&
                row.type === result.effect?.type &&
                (result.effect.type !== "mod" || row.kind === result.effect.kind)
              ),
          );
          current.effects.push({ ...result.effect, source });
        }
        if (result.down) current.hp = 0;
      }
      frame.steps.push({ key: group.key, state: snap(working) });
    }
  }

  // 旧战报缺生命上限/起始值时，用出现过的最大生命兜底，保证血条可读
  for (const unit of unitList) {
    let seen = Math.max(unit.startHp, lastState.get(unit.key)?.hp ?? 0);
    for (const frame of frames) {
      for (const step of frame.steps) seen = Math.max(seen, step.state[unit.key]?.hp ?? 0);
      for (const group of frame.groups) {
        for (const result of group.results) {
          if (result.key === unit.key) seen = Math.max(seen, result.hpBefore ?? 0, result.hpAfter ?? 0);
        }
      }
    }
    if (seen <= 0) unit.hpEstimated = true;
    unit.maxHp = Math.max(unit.maxHp ?? 0, seen, 1);
    if (unit.startHp <= 0) {
      const dieRound = stats.get(unit.key)?.dieAt?.round ?? Number.POSITIVE_INFINITY;
      unit.startHp = unit.maxHp;
      for (const frame of frames) {
        if (frame.round >= dieRound) break;
        if ((frame.base[unit.key]?.hp ?? 0) <= 0) frame.base[unit.key] = { ...frame.base[unit.key]!, hp: unit.startHp };
        for (const step of frame.steps) {
          const hp = step.state[unit.key]?.hp ?? 0;
          if (hp <= 0) step.state[unit.key] = { ...step.state[unit.key]!, hp: unit.startHp };
        }
      }
    }
  }

  const endState = snapshot();
  for (const unit of unitList) lastState.set(unit.key, endState[unit.key]!);

  return {
    floor: index + 1,
    name: encounter.name,
    description: encounter.description ?? "",
    rounds: encounter.rounds,
    victory: encounter.victory,
    timeout: Boolean(encounter.timeout),
    dealt: encounter.damageDealt,
    taken: encounter.damageTaken,
    units: unitList,
    start,
    frames,
    stats: Object.fromEntries(stats),
    endState,
  };
}
