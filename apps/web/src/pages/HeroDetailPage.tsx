import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Clock,
  Eye,
  Heart,
  HeartPulse,
  Minus,
  Plus,
  Shield,
  Sparkles,
  Swords,
  Zap,
} from "lucide-react";
import {
  AFFINITY_PERK_LABELS,
  AFFINITY_PERK_TEXTS,
  AILMENT_LABELS,
  DAMAGE_TYPE_LABELS,
  MODIFIER_KIND_LABELS,
  SLOT_LABELS,
  WEAPON_TYPE_LABELS,
  ailmentForDamageType,
  clamp,
  modifierAmountText,
  type HeroSkillView,
  type Slot,
} from "@wod/shared";
import {
  applySkillHitBase,
  computeHeroDerived,
  epForLevel,
  MAX_LEVEL,
  outgoingDamageMultiplier,
  skillCritChance,
  skillDamageBreakdown,
  skillMagnitudeMultiplier,
  sumModifiers,
} from "@wod/engine";
import { api, errorMessage } from "../api";
import { useAuth, useContent } from "../context";
import { useApi, useNow } from "../hooks";
import { heroActions, heroFinalStats, heroPhysicalReduction } from "../heroStats";
import { EquipmentWorkspace } from "../components/EquipmentWorkspace";
import { HeroPresets } from "../components/HeroPresets";
import { HeroTitlesCard } from "../components/HeroTitlesCard";
import { ItemCard } from "../components/ItemCard";
import { SkillTreeModal, type HeroChoice } from "../components/SkillTreeModal";
import {
  Badge,
  Bar,
  Button,
  Card,
  ErrorNotice,
  Modal,
  PageHeader,
  Sigil,
  Spinner,
  slotIcon,
} from "../components/ui";

const KIND_LABEL: Record<HeroSkillView["kind"], string> = {
  attack: "攻击",
  heal: "治疗",
  buff: "增益",
  passive: "被动",
  trait: "特质",
};

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 技能升级预览的「当前 → 预览（+差值）」文本。 */
function deltaText(before: number, after: number, digits = 1, suffix = ""): string {
  const a = round(before, digits);
  const b = round(after, digits);
  if (a === b) return `${a}${suffix}`;
  const diff = round(b - a, digits);
  return `${a}${suffix} → ${b}${suffix}（${diff > 0 ? "+" : ""}${diff}${suffix}）`;
}

function percentText(value: number | undefined): string {
  return value === undefined ? "" : `${Math.round(value * 100)}%`;
}

interface Pending {
  skills: Record<string, number>;
  unlocks: string[];
}

const EMPTY_PENDING: Pending = { skills: {}, unlocks: [] };

/**
 * 音叉树是无向图：待解锁节点必须能从已解锁节点出发、只经过待解锁节点到达。
 * 取消一个节点时，把它后面失去锚点的待解锁节点一起清掉，避免保存时报错。
 */
function prunePendingUnlocks(skills: HeroSkillView[], pending: string[]): string[] {
  if (pending.length === 0) return pending;
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const pendingSet = new Set(pending);
  const neighbors = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    const left = neighbors.get(a) ?? new Set<string>();
    left.add(b);
    neighbors.set(a, left);
    const right = neighbors.get(b) ?? new Set<string>();
    right.add(a);
    neighbors.set(b, right);
  };
  for (const skill of skills) {
    for (const id of [...skill.requires, ...skill.requiresAny, ...skill.links]) {
      addEdge(skill.id, id);
    }
  }
  const anchored = new Set(skills.filter((skill) => skill.unlocked).map((skill) => skill.id));
  const reachable = new Set(anchored);
  const queue = [...anchored];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const neighbor of neighbors.get(id) ?? []) {
      if (!pendingSet.has(neighbor) || reachable.has(neighbor) || !byId.has(neighbor)) continue;
      reachable.add(neighbor);
      queue.push(neighbor);
    }
  }
  return pending.filter((id) => reachable.has(id));
}

export function HeroDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const content = useContent();
  const { user, refreshUser } = useAuth();
  const heroQ = useApi(
    () => (id ? api.hero(id).then((data) => data.hero) : Promise.reject(new Error("缺少英雄编号"))),
    [id],
  );
  const rosterQ = useApi(() => api.heroes(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [equipmentSlot, setEquipmentSlot] = useState<Slot>("weapon");
  const [treeOpen, setTreeOpen] = useState(() => searchParams.get("tree") === "1");
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(EMPTY_PENDING);
  const now = useNow(1000);

  const hero = heroQ.data;

  useEffect(() => {
    setPending(EMPTY_PENDING);
  }, [hero?.id]);

  useEffect(() => {
    if (searchParams.get("tree") === "1") setTreeOpen(true);
  }, [searchParams]);

  async function act(key: string, task: () => Promise<void>, success?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await task();
      if (success) setNotice(success);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (heroQ.loading && !hero) return <Spinner label="正在查看英雄档案…" />;
  if (!hero) {
    return (
      <div className="page">
        <ErrorNotice message={heroQ.error ?? "英雄不存在"} />
        <Link to="/heroes" className="btn btn-ghost btn-md">
          <ArrowLeft size={16} /> 返回名册
        </Link>
      </div>
    );
  }

  const race = content.races.find((row) => row.id === hero.raceId);
  const busyWithExpedition = Boolean(hero.busyExpeditionId);
  const died = Boolean(hero.diedAt);
  const slots: Slot[] = ["weapon", "armor", "trinket"];
  const levelFloor = epForLevel(hero.level);
  const levelCeil = epForLevel(hero.level + 1);
  const levelSpan = Math.max(1, levelCeil - levelFloor);
  const finalStats = heroFinalStats(hero);
  const actions = heroActions(hero);
  const reduction = heroPhysicalReduction(hero);
  const hasReference = Boolean(hero.reference);
  const visibleModifiers = hero.modifiers.filter((row) => row.kind !== "hit");
  const trainableSkills = hero.skills.filter(
    (skill) => skill.unlocked && skill.kind !== "passive" && skill.kind !== "trait",
  );
  const heroChoices: HeroChoice[] = (rosterQ.data?.heroes ?? []).map((row) =>
    row.id === hero.id
      ? {
          id: hero.id,
          name: hero.name,
          level: hero.level,
          weaponName: hero.weaponName,
        }
      : {
          id: row.id,
          name: row.name,
          level: row.level,
          weaponName: row.weaponName,
        },
  );
  if (!heroChoices.some((row) => row.id === hero.id)) {
    heroChoices.unshift({
      id: hero.id,
      name: hero.name,
      level: hero.level,
      weaponName: hero.weaponName,
    });
  }

  const currentHero = hero;

  function switchTreeHero(heroId: string) {
    if (heroId === currentHero.id) return;
    navigate(`/heroes/${heroId}?tree=1`);
  }

  function closeTree() {
    setTreeOpen(false);
    if (searchParams.get("tree")) {
      navigate(`/heroes/${currentHero.id}`, { replace: true });
    }
  }

  function openEquipment(slot: Slot = "weapon") {
    setEquipmentSlot(slot);
    setEquipmentOpen(true);
  }

  function specFor(draft: Pending) {
    const skillLevels: Record<string, number> = {};
    for (const skill of hero!.skills) {
      if (skill.level > 0) skillLevels[skill.id] = skill.level;
    }
    for (const id of draft.unlocks) {
      skillLevels[id] = Math.max(1, skillLevels[id] ?? 1);
    }
    for (const [skillId, inc] of Object.entries(draft.skills)) {
      skillLevels[skillId] = Math.max(1, (skillLevels[skillId] ?? 1) + inc);
    }
    return computeHeroDerived(content, {
      id: hero!.id,
      name: hero!.name,
      level: hero!.level,
      epEarned: hero!.epEarned,
      raceId: hero!.raceId,
      weaponType: hero!.pathWeaponType,
      skillLevels,
      equipment: slots.flatMap((slot) => {
        const item = hero!.equipment[slot];
        return item?.templateId
          ? [
              {
                templateId: item.templateId,
                affixes: item.affixes ?? [],
                        },
            ]
          : [];
      }),
    });
  }

  function costOf(skills: Record<string, number>, unlocks: string[]) {
    let skillEp = 0;
    let skillGold = 0;
    let skillCount = 0;
    for (const skill of hero!.skills) {
      const inc = skills[skill.id] ?? 0;
      if (inc > 0) {
        skillEp += skill.epCost * inc;
        skillGold += skill.goldCost * inc;
        skillCount += inc;
      }
    }
    let points = 0;
    for (const id of unlocks) {
      const skill = hero!.skills.find((row) => row.id === id);
      points += skill?.cost ?? 0;
    }
    return { skillEp, skillGold, skillCount, points };
  }

  const draft = costOf(pending.skills, pending.unlocks);
  const skillPointsLeft = hero.skillPoints.available - draft.points;
  const totalPending = draft.skillCount + pending.unlocks.length;
  const draftError =
    skillPointsLeft < 0
      ? `技能点不足：还要 ${-skillPointsLeft} 点`
      : draft.skillEp > hero.ep
        ? `经验点不足：需要 ${draft.skillEp}，可用 ${hero.ep}`
        : draft.skillGold > (user?.gold ?? 0)
          ? `金币不足：需要 ${draft.skillGold}，可用 ${user?.gold ?? 0}`
          : null;
  // 技能展开/期望伤害使用当前与草稿两套派生值。
  const baseDerived = specFor(EMPTY_PENDING);
  const previewDerived = specFor(pending);

  function skillPlusDisabled(skill: HeroSkillView): boolean {
    if (busyWithExpedition || !skill.unlocked || skill.kind === "passive" || skill.kind === "trait") return true;
    const inc = pending.skills[skill.id] ?? 0;
    if (skill.level + inc >= skill.maxLevel) return true;
    const next = costOf({ ...pending.skills, [skill.id]: inc + 1 }, pending.unlocks);
    return next.skillEp > hero!.ep || next.skillGold > (user?.gold ?? 0);
  }

  function toggleUnlock(skill: HeroSkillView) {
    setPending((current) => {
      const nextUnlocks = current.unlocks.includes(skill.id)
        ? current.unlocks.filter((id) => id !== skill.id)
        : [...current.unlocks, skill.id];
      return {
        ...current,
        unlocks: prunePendingUnlocks(hero!.skills, nextUnlocks),
      };
    });
  }

  async function saveDraft(): Promise<boolean> {
    setBusy("save-draft");
    setError(null);
    setNotice(null);
    try {
      const data = await api.trainBatch(hero!.id, {
        skills: pending.skills,
        unlocks: pending.unlocks,
      });
      heroQ.setData(data.hero);
      await refreshUser();
      setPending(EMPTY_PENDING);
      setNotice(
        `已保存：解锁 ${pending.unlocks.length} 个节点（${data.cost.skillPoints} 技能点），技能 +${draft.skillCount} 级，消耗 ${data.cost.ep} 经验点 / ${data.cost.gold} 金币。`,
      );
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function addSkill(skill: HeroSkillView) {
    setPending((current) => ({
      ...current,
      skills: {
        ...current.skills,
        [skill.id]: (current.skills[skill.id] ?? 0) + 1,
      },
    }));
  }

  function removeSkill(skill: HeroSkillView) {
    setPending((current) => {
      const next = { ...current.skills };
      const value = (next[skill.id] ?? 0) - 1;
      if (value <= 0) delete next[skill.id];
      else next[skill.id] = value;
      return { ...current, skills: next };
    });
  }

  const goldLeft = (user?.gold ?? 0) - draft.skillGold;
  const epLeft = hero.ep - draft.skillEp;

  return (
    <div className="page">
      <Link to="/heroes" className="back-link">
        <ArrowLeft size={15} /> 返回名册
      </Link>

      <PageHeader
        eyebrow={`${hero.raceName} · ${hero.weaponName} · 等级 ${hero.level}`}
        title={hero.name}
        actions={
          <Badge tone={busyWithExpedition ? "gold" : died ? "red" : "green"}>
            {busyWithExpedition ? "远征中" : died ? "已永久死亡" : "待命"}
          </Badge>
        }
      />

      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}

      <div className="hero-detail-grid">
        <div className="hero-detail-main">
          <Card className="hero-sheet">
            <div className="hero-sheet-head">
              <Sigil weaponType={hero.pathWeaponType} color={hero.weaponColor ?? "#c9a227"} size="xl" />
              <div className="hero-sheet-title">
                <h2>战斗档案</h2>
                <span>
                  {hero.raceName} · {hero.weaponName} · 等级 {hero.level}
                </span>
              </div>
              {died ? (
                <Badge tone="red">阵亡 · 可在死亡名册中使用复活券</Badge>
              ) : null}
            </div>

            <div className="hero-metrics">
              <span>
                <Swords size={14} /> 战力 {hero.power}
              </span>
              <span>
                <Heart size={14} /> {hero.maxHp}
              </span>
              <span
                title={
                  hasReference
                    ? `对同级 ±2 级标准物理攻击（约 ${Math.round(hero.reference.hitDamage)} 伤害）`
                    : undefined
                }
              >
                <Shield size={14} /> {Math.round(hero.armor * 10) / 10}
                {reduction !== undefined ? `（${Math.round(reduction * 100)}%）` : ""}
              </span>
              <span>
                <Zap size={14} /> {hero.maxEnergy}
              </span>
              <span title="先攻决定行动顺序；每回合固定一次主要行动">
                <Clock size={14} /> {hero.initiative}（{actions} 行动）
              </span>
              <span
                title={
                  hasReference
                    ? `对同级 ±2 级标准怪物（对方命中 ${Math.round(hero.reference.hit * 10) / 10}）`
                    : undefined
                }
              >
                <Eye size={14} /> 闪避 {Math.round(hero.evasion * 10) / 10}
                {hero.evasionRate !== undefined
                  ? `（${Math.round(hero.evasionRate * 100)}%）`
                  : ""}
              </span>
              <span>
                <Sparkles size={14} /> 暴击 {Math.round(hero.critChance * 100)}%
              </span>
            </div>

            <div className="hero-xp">
              <span>
                {hero.level >= MAX_LEVEL
                  ? "经验点 已满级"
                  : `经验点 ${hero.epEarned - levelFloor} / ${levelSpan}`}
              </span>
              <Bar value={hero.level >= MAX_LEVEL ? 1 : hero.epEarned - levelFloor} max={hero.level >= MAX_LEVEL ? 1 : levelSpan} />
              <span className="muted-text">可用经验点 {hero.ep} · 技能点 {hero.skillPoints.available}</span>
            </div>

            <div className="section-head compact">
              <h2>最终数值</h2>
              <span className="muted-text">
                已计入过往、被动、装备与强化；不含局内 buff
              </span>
            </div>
            <div className="final-stat-groups">
              <div className="final-stat-group">
                <h3>基本数值</h3>
                <div className="preview-stats">
                  <div className="preview-stat">
                    <span>生命</span>
                    <strong>{Math.round(finalStats.hp * 10) / 10}</strong>
                  </div>
                  <div className="preview-stat">
                    <span>法力</span>
                    <strong>{Math.round(finalStats.mana * 10) / 10}</strong>
                  </div>
                  <div className="preview-stat">
                    <span>先攻</span>
                    <strong>{finalStats.initiative}（{actions} 行动）</strong>
                  </div>
                  <div className="preview-stat">
                    <span>暴击</span>
                    <strong>{Math.round(finalStats.crit * 10) / 10}%</strong>
                  </div>
                </div>
              </div>
              <div className="final-stat-group">
                <h3>防御数值</h3>
                <div className="preview-stats">
                  <div className="preview-stat">
                    <span>护甲</span>
                    <strong>
                      {Math.round(finalStats.armor * 10) / 10}
                      {reduction !== undefined ? `（${Math.round(reduction * 100)}%）` : ""}
                    </strong>
                  </div>
                  <div className="preview-stat">
                    <span>闪避</span>
                    <strong>
                      {Math.round(finalStats.evasion * 10) / 10}
                      {hero.evasionRate !== undefined
                        ? `（${Math.round(hero.evasionRate * 100)}%）`
                        : ""}
                    </strong>
                  </div>
                  <div className="preview-stat">
                    <span>元素抗性</span>
                    <strong>{Math.round((hero.resistances.elemental ?? 0) * 100)}%</strong>
                  </div>
                  <div className="preview-stat">
                    <span>混沌抗性</span>
                    <strong>{Math.round((hero.resistances.chaos ?? 0) * 100)}%</strong>
                  </div>
                </div>
              </div>
            </div>
            {hasReference ? (
              <p className="muted-text final-stat-note">
                括号内概率以同级 ±2 级标准怪物为参考：参考命中{" "}
                {Math.round(hero.reference.hit * 10) / 10}、参考闪避{" "}
                {Math.round(hero.reference.evasion * 10) / 10}、标准物理伤害约{" "}
                {Math.round(hero.reference.hitDamage)}。护甲对低伤害更有效，对高伤害会递减。
              </p>
            ) : null}

            <div className="section-head compact">
              <h2>常驻修正</h2>
              <span className="muted-text">已计入上方最终数值</span>
            </div>
            <div className="bonus-chips">
              {visibleModifiers.length === 0 ? <span className="muted-text">暂无修正</span> : null}
              {visibleModifiers.map((row, index) => (
                <span key={index} className={(row.kind === "damageTaken" ? row.amount < 0 : row.amount > 0) ? "bonus-pos" : "bonus-neg"}>
                  {MODIFIER_KIND_LABELS[row.kind]} {modifierAmountText(row.kind, row.amount)}
                </span>
              ))}
            </div>
          </Card>

          <Card className="skill-training-card">
            <div className="section-head compact">
              <h2>
                <Sparkles size={17} /> 技能训练
              </h2>
              <span className="muted-text">基础技能 + 已解锁主动技能</span>
            </div>
            <div className="skill-training-list">
              {trainableSkills.map((skill) => {
                const inc = pending.skills[skill.id] ?? 0;
                const expanded = expandedSkillId === skill.id;
                const previewLevel = skill.level + inc;
                const isAttack = skill.kind === "attack";
                const baseCritRate = skill.baseCritRate ?? (isAttack ? 5 : 0);
                const baseHitRate = skill.baseHitRate ?? (isAttack ? 90 : 100);
                const source =
                  skill.source === "basic"
                    ? "基础技能"
                    : `${WEAPON_TYPE_LABELS[skill.treeWeaponType ?? hero.pathWeaponType]}树`;
                const Icon =
                  skill.kind === "heal" ? HeartPulse : skill.kind === "buff" ? Sparkles : Swords;

                const currentBreakdown = isAttack
                  ? skillDamageBreakdown(
                      hero.level,
                      baseDerived.attackPower,
                      skill,
                      skill.level,
                      baseDerived.hooks,
                    )
                  : null;
                const nextBreakdown = isAttack
                  ? skillDamageBreakdown(
                      hero.level,
                      previewDerived.attackPower,
                      skill,
                      previewLevel,
                      previewDerived.hooks,
                    )
                  : null;
                const currentDamage = currentBreakdown
                  ? currentBreakdown.total * outgoingDamageMultiplier(baseDerived.modifiers)
                  : null;
                const nextDamage = nextBreakdown
                  ? nextBreakdown.total * outgoingDamageMultiplier(previewDerived.modifiers)
                  : null;
                const currentCrit = isAttack
                  ? skillCritChance(baseDerived.critChance, baseCritRate)
                  : null;
                const nextCrit = isAttack
                  ? skillCritChance(previewDerived.critChance, baseCritRate)
                  : null;
                const currentHit = isAttack
                  ? applySkillHitBase(baseDerived.hitRate, baseHitRate)
                  : null;
                const nextHit = isAttack
                  ? applySkillHitBase(previewDerived.hitRate, baseHitRate)
                  : null;

                const healingPct = clamp(
                  sumModifiers(baseDerived.modifiers, "healing") / 100,
                  -0.6,
                  1.5,
                );
                const nextHealingPct = clamp(
                  sumModifiers(previewDerived.modifiers, "healing") / 100,
                  -0.6,
                  1.5,
                );
                const healCurrent =
                  skill.kind === "heal"
                    ? (skill.power + skill.levelScale * hero.level) *
                      skillMagnitudeMultiplier(skill.level) *
                      (1 + healingPct) *
                      (1 + baseDerived.hooks.skillPowerPct)
                    : null;
                const healNext =
                  skill.kind === "heal"
                    ? (skill.power + skill.levelScale * hero.level) *
                      skillMagnitudeMultiplier(previewLevel) *
                      (1 + nextHealingPct) *
                      (1 + previewDerived.hooks.skillPowerPct)
                    : null;

                const collapseSummary = isAttack
                  ? `期望伤害 ${deltaText(currentDamage ?? 0, nextDamage ?? 0)}`
                  : skill.kind === "heal"
                    ? `治疗 ${deltaText(healCurrent ?? 0, healNext ?? 0)}`
                    : "效果技能";

                const breakdownRows =
                  currentBreakdown && nextBreakdown
                    ? [
                        {
                          label: "技能基础",
                          before: currentBreakdown.power,
                          after: nextBreakdown.power,
                        },
                        {
                          label: "等级成长",
                          before: currentBreakdown.levelScaling,
                          after: nextBreakdown.levelScaling,
                        },
                        {
                          label: "攻击缩放",
                          before: currentBreakdown.attackScaling,
                          after: nextBreakdown.attackScaling,
                        },
                        {
                          label: "基础合计",
                          before: currentBreakdown.baseMagnitude,
                          after: nextBreakdown.baseMagnitude,
                        },
                      ].filter((row) => row.before !== 0 || row.after !== 0)
                    : [];
                const currentDamagePct =
                  (outgoingDamageMultiplier(baseDerived.modifiers) - 1) * 100;
                const nextDamagePct =
                  (outgoingDamageMultiplier(previewDerived.modifiers) - 1) * 100;

                return (
                  <div className="skill-training-item" key={skill.id}>
                    <div
                      className={`skill-training-row${expanded ? " skill-training-row-open" : ""}`}
                    >
                      <button
                        type="button"
                        className="skill-training-main"
                        aria-expanded={expanded}
                        onClick={() =>
                          setExpandedSkillId(expanded ? null : skill.id)
                        }
                      >
                        <span className="skill-training-icon">
                          <Icon size={15} />
                        </span>
                        <span className="skill-training-title">
                          <strong>{skill.name}</strong>
                          <small>
                            {source} · Lv {previewLevel} / {skill.maxLevel}
                          </small>
                          <span className="skill-training-expect">{collapseSummary}</span>
                        </span>
                        <ChevronDown
                          size={15}
                          className={`skill-training-chevron${expanded ? " skill-training-chevron-open" : ""}`}
                        />
                      </button>
                      <span className="skill-training-cost">
                        {skill.epCost} EP · {skill.goldCost} 金 / 级
                      </span>
                      <div className="stat-buttons">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyWithExpedition || inc === 0}
                          onClick={() => removeSkill(skill)}
                        >
                          −
                        </Button>
                        <strong>{previewLevel}</strong>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={skillPlusDisabled(skill)}
                          onClick={() => addSkill(skill)}
                        >
                          +
                        </Button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="skill-training-detail">
                        <div className="skill-detail-meta">
                          {isAttack ? (
                            <>
                              <span>
                                {DAMAGE_TYPE_LABELS[skill.damageType ?? "crushing"]} ·{" "}
                                {skill.target === "all-enemies" ? "群体" : "单体"}
                              </span>
                              <span>基础暴击 {baseCritRate}%</span>
                              <span>实际暴击 {deltaText(currentCrit! * 100, nextCrit! * 100, 1, "%")}</span>
                              <span>基础命中 {baseHitRate}%</span>
                              <span>
                                对参考目标{" "}
                                {deltaText(currentHit! * 100, nextHit! * 100, 1, "%")}
                              </span>
                              {(skill.ailmentEfficiency ?? 2) !== 2 ? (
                                <span>异常效率 ×{skill.ailmentEfficiency}</span>
                              ) : null}
                              {skill.executeThreshold !== undefined ? (
                                <span>
                                  处决：目标 ≤{Math.round(skill.executeThreshold * 100)}% 生命时伤害 +
                                  {Math.round((skill.executeBonusPct ?? 0) * 100)}%
                                </span>
                              ) : null}
                              {skill.ailmentBonusPct ? (
                                <span>
                                  异常协同：目标带有【
                                  {AILMENT_LABELS[
                                    ailmentForDamageType(skill.damageType ?? "crushing")
                                  ]}
                                  】时伤害 +{Math.round(skill.ailmentBonusPct * 100)}%
                                </span>
                              ) : null}
                              {!skill.usable ? <span>当前武器不可用</span> : null}
                            </>
                          ) : (
                            <span>
                              基础暴击 {baseCritRate}% · 基础命中 {baseHitRate}%
                              （非攻击技能不判定）
                            </span>
                          )}
                        </div>

                        {isAttack && currentBreakdown && nextBreakdown ? (
                          <>
                            <span className="skill-detail-title">伤害构成</span>
                            <div className="skill-breakdown">
                            {breakdownRows.map((row) => (
                              <div className="skill-breakdown-row" key={row.label}>
                                <span>{row.label}</span>
                                <strong>{deltaText(row.before, row.after)}</strong>
                              </div>
                            ))}
                            <div className="skill-breakdown-row">
                              <span>技能等级倍率</span>
                              <strong>
                                ×{round(currentBreakdown.levelMultiplier, 2)}
                                {round(currentBreakdown.levelMultiplier, 2) ===
                                round(nextBreakdown.levelMultiplier, 2)
                                  ? ""
                                  : ` → ×${round(nextBreakdown.levelMultiplier, 2)}`}
                              </strong>
                            </div>
                            {currentBreakdown.powerMultiplier !== 1 ||
                            nextBreakdown.powerMultiplier !== 1 ? (
                              <div className="skill-breakdown-row">
                                <span>技能增伤</span>
                                <strong>
                                  {deltaText(
                                    (currentBreakdown.powerMultiplier - 1) * 100,
                                    (nextBreakdown.powerMultiplier - 1) * 100,
                                    1,
                                    "%",
                                  )}
                                </strong>
                              </div>
                            ) : null}
                            {currentDamagePct !== 0 || nextDamagePct !== 0 ? (
                              <div className="skill-breakdown-row">
                                <span>角色增伤</span>
                                <strong>
                                  {deltaText(currentDamagePct, nextDamagePct, 1, "%")}
                                </strong>
                              </div>
                            ) : null}
                            <div className="skill-breakdown-row skill-breakdown-total">
                              <span>期望伤害</span>
                              <strong>{deltaText(currentDamage ?? 0, nextDamage ?? 0)}</strong>
                            </div>
                          </div>
                          </>
                        ) : skill.kind === "heal" ? (
                          <>
                            <span className="skill-detail-title">治疗构成</span>
                            <div className="skill-breakdown">
                            <div className="skill-breakdown-row">
                              <span>技能基础</span>
                              <strong>{round(skill.power, 1)}</strong>
                            </div>
                            <div className="skill-breakdown-row">
                              <span>等级成长</span>
                              <strong>{round(skill.levelScale * hero.level, 1)}</strong>
                            </div>
                            <div className="skill-breakdown-row">
                              <span>技能等级倍率</span>
                              <strong>
                                ×{round(skillMagnitudeMultiplier(skill.level), 2)}
                                {round(skillMagnitudeMultiplier(skill.level), 2) ===
                                round(skillMagnitudeMultiplier(previewLevel), 2)
                                  ? ""
                                  : ` → ×${round(skillMagnitudeMultiplier(previewLevel), 2)}`}
                              </strong>
                            </div>
                            <div className="skill-breakdown-row">
                              <span>治疗加成</span>
                              <strong>{deltaText(healingPct * 100, nextHealingPct * 100, 1, "%")}</strong>
                            </div>
                            {baseDerived.hooks.skillPowerPct !== 0 ||
                            previewDerived.hooks.skillPowerPct !== 0 ? (
                              <div className="skill-breakdown-row">
                                <span>技能增伤</span>
                                <strong>
                                  {deltaText(
                                    baseDerived.hooks.skillPowerPct * 100,
                                    previewDerived.hooks.skillPowerPct * 100,
                                    1,
                                    "%",
                                  )}
                                </strong>
                              </div>
                            ) : null}
                            <div className="skill-breakdown-row skill-breakdown-total">
                              <span>治疗期望</span>
                              <strong>{deltaText(healCurrent ?? 0, healNext ?? 0)}</strong>
                            </div>
                          </div>
                          </>
                        ) : (
                          <p className="skill-detail-note">增益/减益技能，无直接伤害。</p>
                        )}

                        <p className="skill-detail-note">
                          {isAttack
                            ? "期望伤害 = 技能直伤量级 × 角色增伤；未计入命中、暴击、目标护甲/抗性/易伤，也不含处决/异常协同与持续伤害。"
                            : "基础概率不随技能等级变化。"}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {trainableSkills.length === 0 ? (
                <p className="muted-text">还没有可训练的主动技能。</p>
              ) : null}
            </div>
            <div className="skill-training-footer">
              <span className="muted-text">
                待训练 +{draft.skillCount} 级 · {draft.skillEp} EP / {draft.skillGold} 金币 ·
                可用 {epLeft} EP / {goldLeft} 金币
              </span>
              <Button
                variant="primary"
                loading={busy === "save-draft"}
                disabled={draft.skillCount === 0 || Boolean(draftError)}
                onClick={() => void saveDraft()}
              >
                保存改动
              </Button>
            </div>
            {draftError ? <p className="draft-error">{draftError}</p> : null}

            <div className="skill-learning-section">
              <div className="section-head compact">
                <h2>
                  <Swords size={17} /> 技能学习
                </h2>
                <span className="muted-text">
                  技能点 {hero.skillPoints.available} / {hero.skillPoints.total}
                </span>
              </div>
              <div className="skill-learning-row">
                <span className="muted-text">
                  已解锁 <b>{hero.skills.filter((skill) => skill.unlocked && skill.source !== "basic").length}</b>
                  {" · "}可解锁 <b>{hero.skills.filter((skill) => !skill.unlocked && skill.canUnlock && skill.cost <= skillPointsLeft).length}</b>
                  {pending.unlocks.length > 0 ? (
                    <>
                      {" · "}未保存 <b>{pending.unlocks.length}</b>
                    </>
                  ) : null}
                </span>
                <Button variant="primary" icon={Sparkles} onClick={() => setTreeOpen(true)}>
                  进入技能学习
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <aside className="hero-detail-side">
          <HeroTitlesCard heroId={hero.id} onChanged={() => void heroQ.reload()} />
          <HeroPresets heroId={hero.id} refreshToken={`${hero.id}:${hero.skills.filter((s) => s.level > 0).length}`} />

          <Card className="gear-card">
            <div className="section-head compact">
              <h2>装备</h2>
              <Button size="sm" variant="ghost" onClick={() => openEquipment("weapon")}>
                管理装备
              </Button>
            </div>
            <div className="gear-slots">
              {slots.map((slot) => {
                const item = hero.equipment[slot];
                const SlotIcon = slotIcon(slot);
                if (!item) {
                  return (
                    <button
                      key={slot}
                      type="button"
                      className="gear-empty gear-empty-button"
                      onClick={() => openEquipment(slot)}
                    >
                      <SlotIcon size={18} />
                      <span>{SLOT_LABELS[slot]}空置 · 点击装备</span>
                    </button>
                  );
                }
                return (
                  <ItemCard
                    key={slot}
                    item={item}
                    compact
                    footerText="已装备"
                    actions={
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyWithExpedition}
                        onClick={() => openEquipment(slot)}
                      >
                        更换
                      </Button>
                    }
                  />
                );
              })}
            </div>
            <p className="muted-text">
              武器熟练：{hero.weaponProficiencies.map((type) => WEAPON_TYPE_LABELS[type]).join(" / ") || "无"}
            </p>
          </Card>

          <Card>
            <div className="section-head compact">
              <h2>过往</h2>
            </div>
            {race ? (
              <>
                <p className="muted-text">{race.description}</p>
                <p className="muted-text">
                  特质：{race.trait.name} — {race.trait.description}
                </p>
                {race.dungeonAffinity ? (
                  <>
                    <p className="muted-text">
                      亲和：{AFFINITY_PERK_LABELS[race.dungeonAffinity.perk]} ·{" "}
                      {race.dungeonAffinity.tags.join(" / ")}
                    </p>
                    <p className="muted-text">
                      {AFFINITY_PERK_TEXTS[race.dungeonAffinity.perk]}
                    </p>
                  </>
                ) : null}
              </>
            ) : null}
          </Card>
        </aside>
      </div>

      <EquipmentWorkspace
        open={equipmentOpen}
        onClose={() => setEquipmentOpen(false)}
        initialHeroId={hero.id}
        initialSlot={equipmentSlot}
        onEquipped={(result) => {
          heroQ.setData(result.hero);
          setNotice("装备已更新。");
        }}
      />

      <SkillTreeModal
        key={hero.id}
        open={treeOpen}
        onClose={closeTree}
        currentHeroId={hero.id}
        heroName={hero.name}
        weaponName={hero.weaponName}
        currentWeapon={hero.pathWeaponType}
        heroLevel={hero.level}
        heroChoices={heroChoices}
        onSwitchHero={switchTreeHero}
        skills={hero.skills}
        pendingSkills={pending.skills}
        pendingUnlocks={pending.unlocks}
        pointsLeft={skillPointsLeft}
        onToggleUnlock={toggleUnlock}
        onSave={saveDraft}
        saving={busy === "save-draft"}
        error={draftError}
        onReset={() => setPending((current) => ({ ...current, unlocks: [] }))}
      />

    </div>
  );
}
