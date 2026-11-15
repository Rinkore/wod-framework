import { useMemo, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import {
  MAX_HERO_PRESETS,
  SKILL_PHASES,
  SKILL_PHASE_LABELS,
  EVACUATION_TYPES,
  EVACUATION_TYPE_LABELS,
  TARGET_PRIORITIES,
  TARGET_PRIORITY_LABELS,
  type EvacuationType,
  type HeroCombatSettings,
  type HeroPresetView,
  type HeroSkillView,
  type Position,
  type SkillPhase,
} from "@wod/shared";
import { api, errorMessage } from "../api";
import { useContent } from "../context";
import { useApi } from "../hooks";
import { Badge, Button, Card, ErrorNotice, Modal, Spinner } from "./ui";

const POSITION_LABEL: Record<Position, string> = {
  front: "前排",
  flank: "游走",
  back: "后排",
};

export const MAX_FLOORS = 10;

function selectedSkillIds(settings: HeroCombatSettings, phase: SkillPhase): string[] {
  return settings.phases?.[phase]?.skillIds ?? [];
}

function setPhaseSkills(
  settings: HeroCombatSettings,
  phase: SkillPhase,
  skillIds: string[],
): HeroCombatSettings {
  const phases = { ...(settings.phases ?? {}) };
  if (skillIds.length === 0) delete phases[phase];
  else phases[phase] = { ...(phases[phase] ?? {}), skillIds };
  return {
    ...settings,
    phases: Object.keys(phases).length > 0 ? phases : undefined,
  };
}

/** 去掉空字段，避免把 undefined 写进预设 JSON。 */
export function cleanCombatSettings(value: HeroCombatSettings): HeroCombatSettings {
  const next: HeroCombatSettings = { ...value };
  if (!next.targetPriority) delete next.targetPriority;
  delete next.defenseSkillId;
  if (next.phases && Object.keys(next.phases).length === 0) delete next.phases;
  if (!next.evacuation) delete next.evacuation;
  if (next.floors && Object.keys(next.floors).length === 0) delete next.floors;
  if (!next.boundDungeonId) delete next.boundDungeonId;
  return next;
}

function PhaseSkillPicker({
  phase,
  settings,
  skills,
  onChange,
}: {
  phase: SkillPhase;
  settings: HeroCombatSettings;
  skills: HeroSkillView[];
  onChange: (skillIds: string[]) => void;
}) {
  const options = [
    ...new Map(
      skills
        .filter(
          (skill) =>
            skill.level > 0 &&
            skill.kind !== "passive" && skill.kind !== "trait" &&
            skill.source !== "basic" &&
            skill.phases.includes(phase),
        )
        .map((skill) => [skill.id, skill]),
    ).values(),
  ];
  const selected = selectedSkillIds(settings, phase);
  if (options.length === 0) {
    return <p className="muted-text">该阶段没有可用技能。</p>;
  }
  return (
    <div className="skill-pick-grid">
      {options.map((skill) => {
        const order = selected.indexOf(skill.id);
        return (
          <label
            key={skill.id}
            className={order >= 0 ? "skill-pick skill-pick-active" : "skill-pick"}
          >
            <input
              type="checkbox"
              checked={order >= 0}
              onChange={() => {
                const next =
                  order >= 0
                    ? selected.filter((id) => id !== skill.id)
                    : [...selected, skill.id];
                onChange(next);
              }}
            />
            <span>{skill.name}</span>
            {order >= 0 ? <em>{order + 1}</em> : null}
          </label>
        );
      })}
    </div>
  );
}

export function GeneralFields({
  settings,
  skills,
  onChange,
}: {
  settings: HeroCombatSettings;
  skills: HeroSkillView[];
  onChange: (next: HeroCombatSettings) => void;
}) {
  return (
    <section className="settings-section">
      <h3>一般设置</h3>
      <div className="settings-grid">
        <label>
          <span>目标优先级</span>
          <select
            value={settings.targetPriority ?? ""}
            onChange={(event) =>
              onChange({
                ...settings,
                targetPriority: event.target.value
                  ? (event.target.value as HeroCombatSettings["targetPriority"])
                  : undefined,
              })
            }
          >
            <option value="">默认（最近目标）</option>
            {TARGET_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {TARGET_PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="phase-block">
        <div className="phase-title">
          <strong>撤离条件</strong>
          <span className="muted-text">
            任意角色达成后全员成功撤离：保留已得掉落，无人死亡。
          </span>
        </div>
        <div className="settings-grid">
          <label>
            <span>触发方式</span>
            <select
              value={settings.evacuation?.type ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                onChange({
                  ...settings,
                  evacuation: value
                    ? {
                        type: value as EvacuationType,
                        value: value === "hp" ? 30 : value === "downed" ? 1 : 3,
                      }
                    : undefined,
                });
              }}
            >
              <option value="">不启用</option>
              {EVACUATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVACUATION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          {settings.evacuation ? (
            <label>
              <span>
                {settings.evacuation.type === "hp"
                  ? "生命低于（%）"
                  : settings.evacuation.type === "downed"
                    ? "倒地人数"
                    : "推进房间数"}
              </span>
              <input
                type="number"
                min={1}
                max={settings.evacuation.type === "hp" ? 99 : settings.evacuation.type === "downed" ? 3 : 23}
                value={settings.evacuation.value}
                onChange={(event) => {
                  const raw = Math.max(1, Math.floor(Number(event.target.value) || 1));
                  const capped = settings.evacuation?.type === "downed"
                    ? Math.min(3, raw)
                    : settings.evacuation?.type === "rooms"
                      ? Math.min(23, raw)
                      : Math.min(99, raw);
                  onChange({
                    ...settings,
                    evacuation: { type: settings.evacuation!.type, value: capped },
                  });
                }}
              />
            </label>
          ) : null}
        </div>
      </div>

      {SKILL_PHASES.map((phase) => (
        <div key={phase} className="phase-block">
          <div className="phase-title">
            <strong>{SKILL_PHASE_LABELS[phase]}</strong>
            <span className="muted-text">
              {phase === "pre" ? "每回合一次。" : phase === "initiative" ? "已并入主回合排序。" : "每回合一次主要行动。"}
            </span>
          </div>
          <PhaseSkillPicker
            phase={phase}
            settings={settings}
            skills={skills}
            onChange={(skillIds) => onChange(setPhaseSkills(settings, phase, skillIds))}
          />
        </div>
      ))}

    </section>
  );
}

export function FloorFields({
  settings,
  floor,
  skills,
  onChange,
}: {
  settings: HeroCombatSettings;
  floor: number;
  skills: HeroSkillView[];
  onChange: (next: HeroCombatSettings) => void;
}) {
  const floorKey = String(floor);
  const current = settings.floors?.[floorKey];
  const updateFloor = (next: NonNullable<typeof current>) => {
    const floors = { ...(settings.floors ?? {}), [floorKey]: next };
    onChange({ ...settings, floors });
  };
  if (!current) {
    return (
      <p className="muted-text">继承一般设置。</p>
    );
  }

  const phases = current.phases ?? {};
  const setFloorPhase = (phase: SkillPhase, skillIds: string[] | null) => {
    const nextPhases = { ...phases };
    if (skillIds === null) delete nextPhases[phase];
    else nextPhases[phase] = { ...(nextPhases[phase] ?? {}), skillIds };
    updateFloor({
      ...current,
      phases: Object.keys(nextPhases).length > 0 ? nextPhases : undefined,
    });
  };

  return (
    <div className="floor-fields">
      <div className="settings-grid">
        <label>
          <span>目标优先级</span>
          <select
            value={current.targetPriority ?? ""}
            onChange={(event) =>
              updateFloor({
                ...current,
                targetPriority: event.target.value
                  ? (event.target.value as HeroCombatSettings["targetPriority"])
                  : undefined,
              })
            }
          >
            <option value="">继承一般设置</option>
            {TARGET_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {TARGET_PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {SKILL_PHASES.map((phase) => {
        const overridden = phases[phase] !== undefined;
        return (
          <div key={phase} className="phase-block">
            <div className="phase-title">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={overridden}
                  onChange={(event) => setFloorPhase(phase, event.target.checked ? [] : null)}
                />
                <span>覆盖{SKILL_PHASE_LABELS[phase]}</span>
              </label>
            </div>
            {overridden ? (
              <PhaseSkillPicker
                phase={phase}
                settings={{ ...settings, phases: { [phase]: phases[phase] } }}
                skills={skills}
                onChange={(skillIds) => setFloorPhase(phase, skillIds)}
              />
            ) : null}
          </div>
        );
      })}

    </div>
  );
}

export function HeroPresets({
  heroId,
  onChanged,
  refreshToken,
}: {
  heroId: string;
  onChanged?: () => void;
  refreshToken?: string;
}) {
  const presetsQ = useApi(
    () => api.heroPresets(heroId).then((data) => data.presets),
    [heroId],
  );
  const heroQ = useApi(
    () => api.hero(heroId).then((data) => data.hero),
    [heroId, refreshToken],
  );
  const content = useContent();
  const presets = presetsQ.data ?? [];
  const hero = heroQ.data;
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "edit"; preset: HeroPresetView } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<HeroPresetView | null>(null);
  const [name, setName] = useState("");
  const [position, setPosition] = useState<Position>("front");
  const [settings, setSettings] = useState<HeroCombatSettings>({});
  const [floor, setFloor] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    if (presets.length >= MAX_HERO_PRESETS) return;
    setEditor({ mode: "create" });
    setName(`预设 ${presets.length + 1}`);
    setPosition("front");
    setSettings({});
    setFloor(1);
    setError(null);
  }

  function openEdit(preset: HeroPresetView) {
    setEditor({ mode: "edit", preset });
    setName(preset.name);
    setPosition(preset.position);
    setSettings(preset.settings ?? {});
    setFloor(1);
    setError(null);
  }

  async function save() {
    if (!editor || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        position,
        settings: cleanCombatSettings(settings),
      };
      if (editor.mode === "create") {
        await api.createPreset(heroId, payload);
      } else {
        await api.updatePreset(heroId, editor.preset.id, payload);
      }
      await presetsQ.reload();
      onChanged?.();
      setEditor(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(preset: HeroPresetView) {
    setBusy(true);
    setError(null);
    try {
      await api.setDefaultPreset(heroId, preset.id);
      await presetsQ.reload();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.deletePreset(heroId, deleteTarget.id);
      await presetsQ.reload();
      onChanged?.();
      setDeleteTarget(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="preset-card">
      <div className="section-head compact">
        <h2>战斗预设</h2>
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          disabled={presets.length >= MAX_HERO_PRESETS}
          onClick={openCreate}
        >
          新建
        </Button>
      </div>
      <p className="preset-hint">
        默认预设决定派遣站位；最多 {MAX_HERO_PRESETS} 套。
      </p>

      {presetsQ.loading && presets.length === 0 ? <Spinner label="正在读取预设…" /> : null}
      {error && !editor && !deleteTarget ? <ErrorNotice message={error} /> : null}

      <div className="preset-list">
        {presets.map((preset) => {
          const bound = preset.settings?.boundDungeonId
            ? content.dungeons.find(
                (dungeon) => dungeon.id === preset.settings.boundDungeonId,
              )
            : undefined;
          return (
            <div key={preset.id} className="preset-row">
              <div className="preset-main">
                <strong>{preset.name}</strong>
                <span>
                  {POSITION_LABEL[preset.position]}
                  {preset.isDefault ? " · 默认" : ""}
                  {bound ? ` · 绑定 ${bound.name}` : ""}
                  {preset.settings?.targetPriority
                    ? ` · ${TARGET_PRIORITY_LABELS[preset.settings.targetPriority]}`
                    : ""}
                  {preset.settings?.floors &&
                  Object.keys(preset.settings.floors).length > 0
                    ? ` · ${Object.keys(preset.settings.floors).length} 层覆盖`
                    : ""}
                </span>
              </div>
              <div className="preset-actions">
                {preset.isDefault ? (
                  <Badge tone="gold">
                    <Star size={11} /> 默认
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDefault(preset)}
                  >
                    设为默认
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => openEdit(preset)}>
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="删除预设"
                  aria-label={`删除预设 ${preset.name}`}
                  onClick={() => {
                    setDeleteTarget(preset);
                    setError(null);
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {!presetsQ.loading && presets.length === 0 ? (
        <p className="muted-text">还没有预设，先创建一套。</p>
      ) : null}

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.mode === "edit" ? "编辑战斗预设" : "新建战斗预设"}
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setEditor(null)}>
              取消
            </Button>
            <Button loading={busy} disabled={!name.trim()} onClick={save}>
              保存
            </Button>
          </div>
        }
      >
        {hero ? (
          <div className="preset-editor">
            <div className="settings-grid">
              <label>
                <span>预设名</span>
                <input
                  value={name}
                  maxLength={24}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：前排、后排、Boss"
                />
              </label>
              <label>
                <span>站位</span>
                <select
                  value={position}
                  onChange={(event) => setPosition(event.target.value as Position)}
                >
                  {(["front", "flank", "back"] as Position[]).map((value) => (
                    <option key={value} value={value}>
                      {POSITION_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>绑定迷宫</span>
                <select
                  value={settings.boundDungeonId ?? ""}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      boundDungeonId: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">不绑定</option>
                  {content.dungeons.map((dungeon) => (
                    <option key={dungeon.id} value={dungeon.id}>
                      {dungeon.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <GeneralFields
              settings={settings}
              skills={hero.skills}
              onChange={setSettings}
            />

            <section className="settings-section">
              <h3>层设置</h3>
              <div className="floor-tabs">
                {Array.from({ length: MAX_FLOORS }, (_, index) => index + 1).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        floor === value ? "floor-tab floor-tab-active" : "floor-tab"
                      }
                      onClick={() => setFloor(value)}
                    >
                      第 {value} 层
                    </button>
                  ),
                )}
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={Boolean(settings.floors?.[String(floor)])}
                  onChange={(event) => {
                    const floorsMap = { ...(settings.floors ?? {}) };
                    if (event.target.checked) floorsMap[String(floor)] = {};
                    else delete floorsMap[String(floor)];
                    setSettings({
                      ...settings,
                      floors:
                        Object.keys(floorsMap).length > 0 ? floorsMap : undefined,
                    });
                  }}
                />
                <span>启用本层覆盖</span>
              </label>
              <FloorFields
                settings={settings}
                floor={floor}
                skills={hero.skills}
                onChange={setSettings}
              />
            </section>

            {error ? <ErrorNotice message={error} /> : null}
          </div>
        ) : (
          <Spinner label="正在读取英雄技能…" />
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="删除战斗预设"
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="danger" loading={busy} onClick={remove}>
              删除
            </Button>
          </div>
        }
      >
        <p className="muted-text">确定删除「{deleteTarget?.name}」？</p>
        {error ? <ErrorNotice message={error} /> : null}
      </Modal>
    </Card>
  );
}
