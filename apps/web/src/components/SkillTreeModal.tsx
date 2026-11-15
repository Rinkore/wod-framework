import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  ChevronDown,
  HeartPulse,
  Link2,
  Lock,
  Shield,
  Sparkles,
  Swords,
} from "lucide-react";
import {
  BASE_STAT_LABELS,
  MODIFIER_KIND_LABELS,
  WEAPON_TYPE_LABELS,
  WEAPON_TYPES,
  hooksTexts,
  modifierAmountText,
  type HeroSkillView,
  type WeaponType,
} from "@wod/shared";
import { Badge, Button, Modal, cx } from "./ui";

const STEP = 45;
const NODE_SIZE = 76;
const ROOT_RADIUS = 180;
const RING_GAP = 92;
const BRANCH_OFFSET = 12;
const LABEL_RADIUS = ROOT_RADIUS + RING_GAP * 6 + 78;
const WHEEL_MARGIN = 24;

function nodeKey(skill: HeroSkillView): string {
  return `${skill.treeWeaponType ?? "basic"}:${skill.id}`;
}

const ROLE_LABEL: Record<string, string> = {
  root: "起始",
  stem: "稳固",
  passive: "被动 · 分叉",
  mechanic: "机制",
  terminal: "末端",
  connection: "连接点",
};

function roleFor(skill: HeroSkillView): string {
  return skill.role ?? (skill.source === "basic" ? "root" : "mechanic");
}

interface WheelNode {
  skill: HeroSkillView;
  x: number;
  y: number;
  radius: number;
  angle: number;
}

interface WheelLabel {
  weaponType: WeaponType;
  x: number;
  y: number;
  angle: number;
  current: boolean;
}

export interface HeroChoice {
  id: string;
  name: string;
  level: number;
  weaponName: string;
}

interface Wheel {
  nodes: WheelNode[];
  labels: WheelLabel[];
  size: number;
  center: number;
  maxRadius: number;
  ringRadii: number[];
}

function buildWeaponWheel(
  skills: HeroSkillView[],
  rotation: number,
  currentWeapon: WeaponType,
): Wheel {
  const maxRadius = LABEL_RADIUS;
  const center = maxRadius + WHEEL_MARGIN;
  const size = center * 2;
  const placed: WheelNode[] = [];
  const labels: WheelLabel[] = [];

  const place = (skill: HeroSkillView, radius: number, angle: number) => {
    placed.push({ skill, radius, angle, x: 0, y: 0 });
  };

  WEAPON_TYPES.forEach((weaponType, index) => {
    const base = index * STEP + rotation;
    const section = skills.filter(
      (skill) => skill.source === "weapon" && skill.treeWeaponType === weaponType,
    );
    if (section.length === 0) return;
    const root = section.find((skill) => skill.role === "root") ?? section[0];
    if (root) place(root, ROOT_RADIUS, base);
    // 柄必须按实际前置链排序：stem1 直接接根，stem2 接 stem1。
    // 不能按名称排序，否则“格挡姿态/战技架势”会前后颠倒。
    const stemNodes = section.filter((skill) => skill.role === "stem");
    const stem1 =
      stemNodes.find((skill) => root && skill.requires.includes(root.id)) ?? stemNodes[0];
    const stem2 =
      (stem1
        ? stemNodes.find(
            (skill) => skill.id !== stem1.id && skill.requires.includes(stem1.id),
          )
        : undefined) ?? stemNodes.find((skill) => skill.id !== stem1?.id);
    [stem1, stem2].forEach((skill, stemIndex) => {
      if (skill) place(skill, ROOT_RADIUS + RING_GAP * (stemIndex + 1), base);
    });

    // 两条音叉臂：被动 → 机制 → 末端 → 连接点。
    for (const row of [-1, 1]) {
      const branchAngle = base + row * BRANCH_OFFSET;
      const passive = section.find((skill) => skill.role === "passive" && skill.row === row);
      const mechanic = section.find((skill) => skill.role === "mechanic" && skill.row === row);
      const terminal = section.find((skill) => skill.role === "terminal" && skill.row === row);
      const connection = section.find((skill) => skill.role === "connection" && skill.row === row);
      if (passive) place(passive, ROOT_RADIUS + RING_GAP * 3, branchAngle);
      if (mechanic) place(mechanic, ROOT_RADIUS + RING_GAP * 4, branchAngle);
      if (terminal) place(terminal, ROOT_RADIUS + RING_GAP * 5, branchAngle);
      if (connection) place(connection, ROOT_RADIUS + RING_GAP * 6, branchAngle);
    }

    labels.push({
      weaponType,
      angle: base,
      x: 0,
      y: 0,
      current: weaponType === currentWeapon,
    });
  });

  for (const row of placed) {
    const rad = (row.angle * Math.PI) / 180;
    row.x = center + row.radius * Math.cos(rad);
    row.y = center + row.radius * Math.sin(rad);
  }
  for (const label of labels) {
    const rad = (label.angle * Math.PI) / 180;
    label.x = center + LABEL_RADIUS * Math.cos(rad);
    label.y = center + LABEL_RADIUS * Math.sin(rad);
  }

  return {
    nodes: placed,
    labels,
    size,
    center,
    maxRadius,
    ringRadii: Array.from({ length: 7 }, (_, index) => ROOT_RADIUS + index * RING_GAP),
  };
}

function NodeIcon({ skill }: { skill: HeroSkillView }) {
  if (skill.role === "connection") return <Link2 size={18} />;
  if (skill.role === "terminal") return <Shield size={18} />;
  if (skill.kind === "heal") return <HeartPulse size={18} />;
  if (skill.kind === "buff" || skill.kind === "passive") return <Sparkles size={18} />;
  return <Swords size={18} />;
}

function nodeState(skill: HeroSkillView, canQueue: boolean): string {
  if (skill.unlocked) return "skill-node-learned";
  if (canQueue || skill.canUnlock) return "skill-node-available";
  return "skill-node-blocked";
}

function NodeButton({
  skill,
  x,
  y,
  selected,
  queued,
  canQueue,
  offSector,
  onSelect,
  size = NODE_SIZE,
}: {
  skill: HeroSkillView;
  x: number;
  y: number;
  selected: boolean;
  queued: boolean;
  canQueue: boolean;
  offSector: boolean;
  onSelect: (skill: HeroSkillView) => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      title={`${ROLE_LABEL[roleFor(skill)] ?? "节点"} · ${
        skill.unlocked ? `Lv${skill.level}` : `${skill.cost} 技能点 · ${skill.minLevel} 级`
      }`}
      className={cx(
        "skill-wheel-node",
        `skill-node-${roleFor(skill)}`,
        nodeState(skill, canQueue),
        offSector && "skill-node-off-sector",
        selected && "skill-node-selected",
        queued && "skill-node-queued",
      )}
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => onSelect(skill)}
    >
      <span className="skill-node-icon">
        <NodeIcon skill={skill} />
      </span>
      <strong>{skill.name}</strong>
      {skill.unlocked ? (
        <Check size={12} className="skill-node-check" />
      ) : (
        <Lock size={12} className="skill-node-lock" />
      )}
    </button>
  );
}

function HeroSwitcher({
  currentId,
  heroName,
  weaponName,
  choices,
  onSwitch,
}: {
  currentId: string;
  heroName: string;
  weaponName: string;
  choices: HeroChoice[];
  onSwitch: (heroId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="hero-switcher" ref={rootRef}>
      <button
        type="button"
        className="hero-switcher-trigger"
        onClick={() => setOpen((value) => !value)}
        title="切换角色天赋树"
      >
        <span className="hero-switcher-copy">
          <strong>{heroName}</strong>
          <small>{weaponName} · 点击切换角色</small>
        </span>
        <ChevronDown size={14} className={open ? "is-open" : undefined} />
      </button>
      {open ? (
        <div className="hero-switcher-menu">
          <span className="eyebrow">切换角色天赋树</span>
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={cx("hero-switcher-item", choice.id === currentId && "is-current")}
              onClick={() => {
                setOpen(false);
                if (choice.id !== currentId) onSwitch(choice.id);
              }}
            >
              <span>
                <strong>{choice.name}</strong>
                <small>
                  {choice.weaponName} · Lv{choice.level}
                </small>
              </span>
              {choice.id === currentId ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SkillTreeModal({
  open,
  onClose,
  currentHeroId,
  heroName,
  weaponName,
  currentWeapon,
  heroLevel,
  heroChoices,
  onSwitchHero,
  skills,
  pendingSkills,
  pendingUnlocks,
  pointsLeft,
  onToggleUnlock,
  onSave,
  saving,
  error,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  currentHeroId: string;
  heroName: string;
  weaponName: string;
  currentWeapon: WeaponType;
  heroLevel: number;
  heroChoices: HeroChoice[];
  onSwitchHero: (heroId: string) => void;
  skills: HeroSkillView[];
  pendingSkills: Record<string, number>;
  pendingUnlocks: string[];
  pointsLeft: number;
  onToggleUnlock: (skill: HeroSkillView) => void;
  onSave: () => Promise<boolean>;
  saving: boolean;
  error: string | null;
  onReset: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [resetNonce, setResetNonce] = useState(0);
  const [viewport, setViewport] = useState({ width: 900, height: 520 });
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const wheelViewportRef = useRef<HTMLDivElement>(null);
  const pendingZoomRef = useRef<{ wx: number; wy: number; scale: number } | null>(null);
  const zoomRef = useRef(1);

  const rotation = -90 - WEAPON_TYPES.indexOf(currentWeapon) * STEP;
  const weaponSkills = useMemo(() => skills.filter((skill) => skill.source === "weapon"), [skills]);
  const all = weaponSkills;
  const allById = useMemo(() => new Map(all.map((skill) => [skill.id, skill])), [all]);
  const incomingLinks = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const skill of all) {
      for (const target of skill.links) {
        const list = map.get(target) ?? [];
        list.push(skill.id);
        map.set(target, list);
      }
    }
    return map;
  }, [all]);

  const focusedWeapon = (selectedId ? allById.get(selectedId)?.treeWeaponType : undefined) ?? currentWeapon;
  const wheel = useMemo(
    () => buildWeaponWheel(skills, rotation, focusedWeapon),
    [skills, rotation, focusedWeapon],
  );
  const placedById = useMemo(
    () => new Map(wheel.nodes.map((row) => [row.skill.id, row])),
    [wheel.nodes],
  );

  const unlockedIds = useMemo(
    () => new Set(skills.filter((skill) => skill.unlocked).map((skill) => skill.id)),
    [skills],
  );
  const pendingSet = useMemo(() => new Set(pendingUnlocks), [pendingUnlocks]);
  const anchors = useMemo(
    () => new Set([...unlockedIds, ...pendingSet]),
    [unlockedIds, pendingSet],
  );
  const canQueue = (skill: HeroSkillView) =>
    !skill.unlocked &&
    !pendingSet.has(skill.id) &&
    skill.minLevel <= heroLevel &&
    skill.cost <= pointsLeft &&
    [
      ...skill.requires,
      ...skill.requiresAny,
      ...skill.links,
      ...(incomingLinks.get(skill.id) ?? []),
    ].some((id) => anchors.has(id));

  const fitScale = Math.min(
    Math.max(0.2, viewport.width / wheel.size),
    Math.max(0.2, viewport.height / wheel.size),
    1,
  );
  const effectiveScale = zoom;
  const wheelWidth = wheel.size * effectiveScale;
  const wheelHeight = wheel.size * effectiveScale;
  const stageWidth = Math.max(viewport.width, wheelWidth + 32);
  const stageHeight = Math.max(viewport.height, wheelHeight + 32);
  const fitLeft = (stageWidth - wheelWidth) / 2;
  const fitTop = (stageHeight - wheelHeight) / 2;

  function zoomTo(nextScale: number, center = false) {
    const scroller = wheelViewportRef.current;
    const clamped = Math.max(0.3, Math.min(2, nextScale));
    const currentScale = zoomRef.current;
    if (!scroller || Math.abs(clamped - currentScale) < 0.001) {
      zoomRef.current = clamped;
      setZoom(clamped);
      return;
    }
    pendingZoomRef.current = {
      wx: center
        ? wheel.size / 2
        : (scroller.scrollLeft + scroller.clientWidth / 2 - fitLeft) / currentScale,
      wy: center
        ? wheel.size / 2
        : (scroller.scrollTop + scroller.clientHeight / 2 - fitTop) / currentScale,
      scale: clamped,
    };
    zoomRef.current = clamped;
    setZoom(clamped);
  }

  useLayoutEffect(() => {
    const pending = pendingZoomRef.current;
    const scroller = wheelViewportRef.current;
    if (!pending || !scroller) return;
    const nextWheelWidth = wheel.size * pending.scale;
    const nextWheelHeight = wheel.size * pending.scale;
    const nextStageWidth = Math.max(viewport.width, nextWheelWidth + 32);
    const nextStageHeight = Math.max(viewport.height, nextWheelHeight + 32);
    const nextFitLeft = (nextStageWidth - nextWheelWidth) / 2;
    const nextFitTop = (nextStageHeight - nextWheelHeight) / 2;
    scroller.scrollLeft = Math.max(
      0,
      nextFitLeft + pending.wx * pending.scale - scroller.clientWidth / 2,
    );
    scroller.scrollTop = Math.max(
      0,
      nextFitTop + pending.wy * pending.scale - scroller.clientHeight / 2,
    );
    pendingZoomRef.current = null;
  }, [zoom, viewport.width, viewport.height, wheel.size]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    zoomRef.current = 1;
    setZoom(1);
    setResetNonce((value) => value + 1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = wheelViewportRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, (element.scrollWidth - element.clientWidth) / 2);
    // 当前武器音叉在顶部；滚到顶部让整条音叉可见。
    element.scrollTop = 0;
  }, [open, resetNonce]);

  useEffect(() => {
    if (!open) return;
    const element = wheelViewportRef.current;
    if (!element) return;
    const update = () =>
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  const selected = selectedId ? (allById.get(selectedId) ?? null) : null;
  const queued = selected ? pendingUnlocks.includes(selected.id) : false;
  const pendingSkillCount = Object.values(pendingSkills).reduce((sum, value) => sum + value, 0);
  const totalPending = pendingSkillCount + pendingUnlocks.length;

  function resetView() {
    zoomRef.current = 1;
    setZoom(1);
    setResetNonce((value) => value + 1);
  }

  function focusSkill(skill: HeroSkillView) {
    setSelectedId(skill.id);
    const placed = placedById.get(skill.id);
    const scroller = wheelViewportRef.current;
    if (!placed || !scroller) return;
    const contentX = fitLeft + placed.x * effectiveScale;
    const contentY = fitTop + placed.y * effectiveScale;
    scroller.scrollTo({
      left: Math.max(0, contentX - scroller.clientWidth / 2),
      top: Math.max(0, contentY - scroller.clientHeight / 2),
      behavior: "smooth",
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const scroller = wheelViewportRef.current;
    if (!scroller) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const scroller = wheelViewportRef.current;
    const start = panRef.current;
    if (!scroller || !start) return;
    scroller.scrollLeft = start.left - (event.clientX - start.x);
    scroller.scrollTop = start.top - (event.clientY - start.y);
  }

  function onPointerUp() {
    panRef.current = null;
  }

  async function saveAndClose() {
    const ok = await onSave();
    if (ok) onClose();
  }

  const paths = useMemo(() => {
    const rows: Array<{ key: string; d: string; link?: boolean }> = [];
    for (const row of wheel.nodes) {
      for (const parentId of [...row.skill.requires, ...row.skill.requiresAny]) {
        const parent = placedById.get(parentId);
        if (!parent) continue;
        const dx = row.x - parent.x;
        const dy = row.y - parent.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const cx = (parent.x + row.x) / 2 - (dy / length) * 10;
        const cy = (parent.y + row.y) / 2 + (dx / length) * 10;
        rows.push({
          key: `${parent.skill.id}-${row.skill.id}`,
          d: `M ${parent.x} ${parent.y} Q ${cx} ${cy} ${row.x} ${row.y}`,
        });
      }
    }
    for (const row of wheel.nodes) {
      if (row.skill.role !== "connection") continue;
      for (const targetId of row.skill.links) {
        const target = placedById.get(targetId);
        if (!target) continue;
        const dx = target.x - row.x;
        const dy = target.y - row.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const cx = (row.x + target.x) / 2 - (dy / length) * 18;
        const cy = (row.y + target.y) / 2 + (dx / length) * 18;
        rows.push({
          key: `link-${row.skill.id}-${target.skill.id}`,
          d: `M ${row.x} ${row.y} Q ${cx} ${cy} ${target.x} ${target.y}`,
          link: true,
        });
      }
    }
    return rows;
  }, [wheel.nodes, placedById]);

  const wheelNodes = useMemo(
    () =>
      wheel.nodes.map(({ skill, x, y }) => {
        const queueable =
          !skill.unlocked &&
          !pendingSet.has(skill.id) &&
          skill.minLevel <= heroLevel &&
          skill.cost <= pointsLeft &&
          [
            ...skill.requires,
            ...skill.requiresAny,
            ...skill.links,
            ...(incomingLinks.get(skill.id) ?? []),
          ].some((id) => anchors.has(id));
        return (
          <NodeButton
            key={nodeKey(skill)}
            skill={skill}
            x={x}
            y={y}
            selected={selectedId === skill.id}
            queued={pendingSet.has(skill.id)}
            canQueue={queueable}
            offSector={skill.treeWeaponType !== focusedWeapon}
            onSelect={(row) => setSelectedId(row.id)}
          />
        );
      }),
    [wheel.nodes, selectedId, pendingSet, heroLevel, pointsLeft, anchors, incomingLinks, focusedWeapon],
  );

  const currentIndex = WEAPON_TYPES.indexOf(focusedWeapon);
  const sectorStart = ((currentIndex * STEP - STEP / 2 + rotation) * Math.PI) / 180;
  const sectorEnd = ((currentIndex * STEP + STEP / 2 + rotation) * Math.PI) / 180;
  const sectorInner = ROOT_RADIUS - 34;
  const sectorOuter = LABEL_RADIUS - 10;
  const sectorPath = [
    `M ${wheel.center + sectorInner * Math.cos(sectorStart)} ${wheel.center + sectorInner * Math.sin(sectorStart)}`,
    `L ${wheel.center + sectorOuter * Math.cos(sectorStart)} ${wheel.center + sectorOuter * Math.sin(sectorStart)}`,
    `A ${sectorOuter} ${sectorOuter} 0 0 1 ${wheel.center + sectorOuter * Math.cos(sectorEnd)} ${wheel.center + sectorOuter * Math.sin(sectorEnd)}`,
    `L ${wheel.center + sectorInner * Math.cos(sectorEnd)} ${wheel.center + sectorInner * Math.sin(sectorEnd)}`,
    `A ${sectorInner} ${sectorInner} 0 0 0 ${wheel.center + sectorInner * Math.cos(sectorStart)} ${wheel.center + sectorInner * Math.sin(sectorStart)}`,
    "Z",
  ].join(" ");

  const linkTargets = selected
    ? selected.links
        .map((id) => allById.get(id))
        .filter((row): row is HeroSkillView => Boolean(row))
    : [];

  const localReason = selected
    ? selected.unlocked
      ? null
      : selected.minLevel > heroLevel
        ? `需要英雄等级 ${selected.minLevel}`
        : selected.cost > pointsLeft
          ? `技能点不足（需要 ${selected.cost} 点）`
          : [
              ...selected.requires,
              ...selected.requiresAny,
              ...selected.links,
              ...(incomingLinks.get(selected.id) ?? []),
            ].every((id) => !unlockedIds.has(id) && !pendingSet.has(id))
            ? "需要先解锁相邻节点"
            : selected.lockedReason
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${heroName} · 音叉天赋树`}
      header={
        <HeroSwitcher
          currentId={currentHeroId}
          heroName={heroName}
          weaponName={weaponName}
          choices={heroChoices}
          onSwitch={onSwitchHero}
        />
      }
      full
      fullscreen
      footer={
        <div className="skill-tree-footer">
          <span className="muted-text">
            已选解锁 {pendingUnlocks.length}
            {pendingSkillCount > 0 ? ` · 角色页待训练 +${pendingSkillCount}` : ""}
          </span>
          <div className="draft-actions">
            <Button variant="ghost" onClick={onReset}>
              重置
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={totalPending === 0 || Boolean(error)}
              onClick={() => void saveAndClose()}
            >
              保存并关闭
            </Button>
          </div>
        </div>
      }
    >
      <div className="skill-tree-modal">
        <div className="skill-wheel-toolbar">
          <div className="skill-wheel-zoom">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => zoomTo(zoom - 0.15)}
              title="缩小"
            >
              −
            </Button>
            <span className="skill-wheel-angle">{Math.round(zoom * 100)}%</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => zoomTo(zoom + 0.15)}
              title="放大"
            >
              +
            </Button>
            <Button size="sm" variant="ghost" onClick={() => zoomTo(fitScale, true)} title="缩放以显示全部 8 棵音叉">
              全览
            </Button>
            <Button size="sm" variant="ghost" onClick={resetView} title="恢复 100% 并居中">
              居中
            </Button>
          </div>
          <span className="skill-wheel-points">
            当前武器 <b>{weaponName}</b>
            {focusedWeapon !== currentWeapon
              ? ` · 查看 ${WEAPON_TYPE_LABELS[focusedWeapon]}`
              : ""}{" "}
            · 技能点 {pointsLeft}
          </span>
        </div>

        <div className="skill-tree-layout">
          <div className="skill-tree-main">
            <div className="skill-wheel-scroll" ref={wheelViewportRef}>
              <div
                className="skill-wheel-stage"
                style={{ width: stageWidth, height: stageHeight }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={(event) => {
                  event.preventDefault();
                  zoomTo(zoom + (event.deltaY < 0 ? 0.12 : -0.12));
                }}
              >
                <div
                  className="skill-wheel-fit"
                  style={{
                    width: wheel.size,
                    height: wheel.size,
                    transform: `translate(${fitLeft}px, ${fitTop}px) scale(${effectiveScale})`,
                  }}
                >
                  <svg className="skill-wheel-guides" width={wheel.size} height={wheel.size} aria-hidden>
                    <path className="skill-wheel-current-sector" d={sectorPath} />
                    {wheel.ringRadii.map((radius, index) => (
                      <circle key={`ring-${index}`} cx={wheel.center} cy={wheel.center} r={radius} />
                    ))}
                    {Array.from({ length: 8 }, (_, index) => {
                      const angle = ((index * STEP + STEP / 2 + rotation) * Math.PI) / 180;
                      return (
                        <line
                          key={`spoke-${index}`}
                          x1={wheel.center + ROOT_RADIUS * Math.cos(angle)}
                          y1={wheel.center + ROOT_RADIUS * Math.sin(angle)}
                          x2={wheel.center + wheel.maxRadius * Math.cos(angle)}
                          y2={wheel.center + wheel.maxRadius * Math.sin(angle)}
                        />
                      );
                    })}
                    {wheel.labels.map((label) => (
                      <text
                        key={`label-${label.weaponType}`}
                        className={label.current ? "skill-sector-label current" : "skill-sector-label"}
                        x={label.x}
                        y={label.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {WEAPON_TYPE_LABELS[label.weaponType]}
                      </text>
                    ))}
                  </svg>
                  <svg className="skill-wheel-edges" width={wheel.size} height={wheel.size} aria-hidden>
                    {paths.map((path) => (
                      <path
                        key={path.key}
                        className={path.link ? "skill-wheel-link-edge" : undefined}
                        d={path.d}
                      />
                    ))}
                  </svg>
                  {wheelNodes}
                </div>
              </div>
            </div>
          </div>

          {selected ? (
            <aside className="skill-tree-detail">
              <>
                <div className="skill-tree-detail-head">
                  <div>
                    <span className="eyebrow">
                      {`${WEAPON_TYPE_LABELS[selected.treeWeaponType ?? currentWeapon]}树`}
                    </span>
                    <h3>{selected.name}</h3>
                  </div>
                  <Badge
                    tone={
                      selected.kind === "heal"
                        ? "green"
                        : selected.kind === "buff"
                          ? "blue"
                          : selected.kind === "passive"
                            ? "purple"
                            : "muted"
                    }
                  >
                    {selected.kind === "passive"
                      ? "被动"
                      : selected.kind === "heal"
                        ? "治疗"
                        : selected.kind === "buff"
                          ? "增益"
                          : "攻击"}
                  </Badge>
                </div>
                <p className="muted-text">{selected.description}</p>

                <div className="skill-tree-detail-grid">
                  <span>节点</span>
                  <strong>{ROLE_LABEL[roleFor(selected)] ?? "节点"}</strong>
                  <span>层级 / 门槛</span>
                  <strong>
                    {selected.tier === null ? "基础" : `T${selected.tier}`} · Lv{selected.minLevel}
                  </strong>
                  <span>等级</span>
                  <strong>
                    {selected.level} / {selected.maxLevel}
                  </strong>
                  <span>冷却 / 法力</span>
                  <strong>
                    {selected.cooldown} / {selected.energyCost}
                  </strong>
                  <span>等级系数 / 武器</span>
                  <strong>
                    {selected.levelScale} / {selected.weaponScale}
                  </strong>
                  <span>解锁花费</span>
                  <strong>{selected.cost} 技能点</strong>
                </div>

                {selected.passive ? (
                  <div className="skill-tree-passive">
                    <span className="eyebrow">被动加成</span>
                    <p className="muted-text">
                      {selected.passive.hpPct !== 0
                        ? `生命 ${Math.round(selected.passive.hpPct * 100)}% · `
                        : ""}
                      {selected.passive.manaPct !== 0
                        ? `法力 ${Math.round(selected.passive.manaPct * 100)}% · `
                        : ""}
                      {Object.entries(selected.passive.base)
                        .filter(([, value]) => value)
                        .map(
                          ([key, value]) =>
                            `${BASE_STAT_LABELS[key as keyof typeof BASE_STAT_LABELS]} +${value}`,
                        )
                        .join(" · ")}
                    </p>
                    {selected.passive.modifiers.length > 0 ? (
                      <p className="muted-text">
                        {selected.passive.modifiers
                          .map(
                            (row) =>
                              `${MODIFIER_KIND_LABELS[row.kind]} ${modifierAmountText(row.kind, row.amount)}`,
                          )
                          .join(" · ")}
                      </p>
                    ) : null}
                    {hooksTexts(selected.passive.hooks).length > 0 ? (
                      <p className="muted-text">{hooksTexts(selected.passive.hooks).join("；")}</p>
                    ) : null}
                    {selected.passive.weaponProficiencies.length > 0 ? (
                      <p className="muted-text">
                        武器熟练：
                        {selected.passive.weaponProficiencies
                          .map((type) => WEAPON_TYPE_LABELS[type])
                          .join(" / ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {selected.weaponTypes?.length ? (
                  <p className="muted-text">
                    需要武器：
                    {selected.weaponTypes.map((type) => WEAPON_TYPE_LABELS[type]).join(" / ")}
                  </p>
                ) : null}

                {linkTargets.length > 0 ? (
                  <div className="skill-tree-links">
                    <span className="eyebrow">连接至</span>
                    {linkTargets.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        className="skill-link-target"
                        onClick={() => focusSkill(target)}
                      >
                        <Link2 size={13} />
                        {target.treeWeaponType
                          ? `${WEAPON_TYPE_LABELS[target.treeWeaponType]} · `
                          : ""}
                        {target.name}
                      </button>
                    ))}
                  </div>
                ) : null}

                {!selected.unlocked && selected.requires.length + selected.requiresAny.length > 0 ? (
                  <p className="muted-text">
                    生长方向：
                    {[...selected.requires, ...selected.requiresAny]
                      .map((id) => allById.get(id)?.name ?? id)
                      .join(" / ")}
                  </p>
                ) : null}

                {selected.unlocked ? (
                  <>
                    {selected.kind !== "passive" ? (
                      <p className="muted-text">
                        技能等级在角色页面的「技能训练」中提升。
                      </p>
                    ) : (
                      <p className="muted-text">被动节点解锁即生效，不需要训练。</p>
                    )}
                    {selected.usable === false && selected.kind !== "passive" ? (
                      <p className="skill-warning">当前装备的武器不满足技能要求。</p>
                    ) : null}
                  </>
                ) : (
                  <div className="skill-tree-unlock">
                    <p className="muted-text">
                      {queued
                        ? "已加入解锁预览；保存时会按相邻关系依次解锁。"
                        : localReason ?? `需要 ${selected.cost} 技能点`}
                    </p>
                    <Button
                      variant={queued ? "primary" : "secondary"}
                      disabled={!queued && !canQueue(selected)}
                      onClick={() => onToggleUnlock(selected)}
                    >
                      {queued
                        ? "移出解锁预览"
                        : `加入解锁预览（${selected.cost} 点）`}
                    </Button>
                  </div>
                )}
              </>
            </aside>
          ) : null}
        </div>

        {error ? <p className="draft-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
