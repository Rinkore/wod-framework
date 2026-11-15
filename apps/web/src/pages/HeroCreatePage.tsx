import { useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Sparkles } from "lucide-react";
import {
  AFFINITY_PERK_LABELS,
  AFFINITY_PERK_TEXTS,
  ITEM_SLOT_LABELS,
  RARITY_LABELS,
  containsSensitiveWord,
} from "@wod/shared";
import type { HeroDraftView } from "@wod/shared";
import { computeHeroDerived } from "@wod/engine";
import { api, errorMessage } from "../api";
import { useContent } from "../context";
import { useApi } from "../hooks";
import {
  Badge,
  Button,
  Card,
  ErrorNotice,
  Modal,
  PageHeader,
  Sigil,
  cx,
  weaponIcon,
} from "../components/ui";

export function HeroCreatePage() {
  const content = useContent();
  const navigate = useNavigate();
  const heroesQ = useApi(() => api.heroes().then((data) => data.heroes), []);
  const draftQ = useApi(() => api.heroDraft().then((data) => data.draft), []);
  const [draftOverride, setDraftOverride] = useState<HeroDraftView | null>(null);
  const [raceId, setRaceId] = useState<string>("");
  const [weaponType, setWeaponType] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const draft = draftOverride ?? draftQ.data;
  const races = useMemo(
    () =>
      (draft?.raceIds ?? [])
        .map((id) => content.races.find((row) => row.id === id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    [draft, content.races],
  );
  const weapons = useMemo(
    () =>
      (draft?.weaponTypes ?? [])
        .map((id) => content.weapons.find((row) => row.id === id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    [draft, content.weapons],
  );
  const race = races.find((row) => row.id === raceId) ?? races[0];
  const path = weapons.find((row) => row.id === weaponType) ?? weapons[0];
  const WeaponIcon = path ? weaponIcon(path.id) : Sparkles;
  const existingNames = new Set((heroesQ.data ?? []).map((hero) => hero.name.trim()));

  const preview = useMemo(() => {
    if (!race || !path) return null;
    try {
      return computeHeroDerived(content, {
        id: "preview",
        name: "预览",
        level: 1,
        epEarned: 500,
        raceId: race.id,
        weaponType: path.id,
        skillLevels: {
          "basic-attack": 1,
          "power-attack": 1,
          [path.rootSkillId]: 1,
        },
        equipment: path.startingItemIds.map((templateId) => ({ templateId, affixes: [] })),
      });
    } catch {
      return null;
    }
  }, [content, race, path]);

  const rootSkill = path ? content.skills.find((skill) => skill.id === path.rootSkillId) : undefined;
  const startSkills: string[] = ["普通攻击", "强力攻击"];
  if (rootSkill) startSkills.push(rootSkill.name);

  function validateName(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return "请填写英雄名";
    if (trimmed.length > 12) return "英雄名最多 12 个字符";
    if (/[\u0000-\u001f<>]/u.test(trimmed)) return "英雄名包含非法字符";
    if (containsSensitiveWord(trimmed)) return "英雄名包含敏感词，请换一个名字";
    if (existingNames.has(trimmed)) return "账号内已经有同名英雄，请换一个名字";
    return null;
  }

  function openNameDialog() {
    setError(null);
    setNameError(null);
    setNameOpen(true);
  }

  async function reroll() {
    if (!draft || draft.rerollsRemaining < 1 || rolling || loading) return;
    setRolling(true);
    setError(null);
    try {
      const data = await api.rerollHeroDraft();
      setDraftOverride(data.draft);
      setRaceId("");
      setWeaponType("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRolling(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!race || !path || !draft || rolling || loading) return;
    const invalid = validateName(name);
    if (invalid) {
      setNameError(invalid);
      return;
    }
    setError(null);
    setNameError(null);
    setLoading(true);
    try {
      const data = await api.createHero({
        name: name.trim(),
        raceId: race.id,
        weaponType: path.id,
        draftId: draft.draftId,
      });
      navigate(`/heroes/${data.hero.id}`);
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes("英雄名") || message.includes("敏感词")) setNameError(message);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (!draft) {
    return (
      <div className="page create-page">
        <Link to="/heroes" className="back-link">
          <ArrowLeft size={15} /> 返回名册
        </Link>
        <PageHeader eyebrow="招募" title="招募一名拾荒者" />
        {draftQ.error ? <ErrorNotice message={draftQ.error} /> : null}
        <Card>
          <p className="muted-text">
            {draftQ.error ? "暂时无法读取招募草稿，请重试。" : "正在读取本次招募的过往与武器…"}
          </p>
          {draftQ.error ? (
            <Button icon={RefreshCw} onClick={() => void draftQ.reload()}>
              重新加载
            </Button>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="page create-page">
        <Link to="/heroes" className="back-link">
          <ArrowLeft size={15} /> 返回名册
        </Link>

        <PageHeader
          eyebrow="招募"
          title="招募一名拾荒者"
          actions={
            <Button
              variant="ghost"
              icon={RefreshCw}
              loading={rolling}
              disabled={draft.rerollsRemaining < 1 || loading}
              onClick={() => void reroll()}
            >
              重新抽选（剩余 {draft.rerollsRemaining} 次）
            </Button>
          }
        />

        {error ? <ErrorNotice message={error} /> : null}
        <p className="muted-text">
          本次候选会自动保存，刷新页面或稍后回来仍可继续；每次招募可主动重抽一次。
        </p>

        <div className="create-grid">
          <div className="create-main">
            <Card className="create-big-card">
              <div className="section-head compact">
                <h2>过往 · 二选一</h2>
                <span className="muted-text">命运只给了两个可能的出身</span>
              </div>
              <div className="draft-grid draft-races">
                {races.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={cx("choice-card", race?.id === row.id && "choice-active")}
                    onClick={() => setRaceId(row.id)}
                  >
                    <div className="choice-head">
                      <strong>{row.name}</strong>
                      {race?.id === row.id ? (
                        <span className="pick-check pick-check-on">✓</span>
                      ) : null}
                    </div>
                    <span className="choice-sub">{row.subtitle}</span>
                    <p className="choice-desc">{row.description}</p>
                    <div className="trait-line">
                      <Sparkles size={13} /> 特质：{row.trait.name} — {row.trait.description}
                    </div>
                    {row.dungeonAffinity ? (
                      <>
                        <p className="choice-sub">
                          亲和：{AFFINITY_PERK_LABELS[row.dungeonAffinity.perk]} ·{" "}
                          {row.dungeonAffinity.tags.join(" / ")}
                        </p>
                        <p className="choice-sub">
                          {AFFINITY_PERK_TEXTS[row.dungeonAffinity.perk]}
                        </p>
                      </>
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="section-head compact">
                <h2>武器 · 三选一</h2>
                <span className="muted-text">决定整条技能树</span>
              </div>
              <div className="draft-grid draft-weapons">
                {weapons.map((row) => {
                  const Icon = weaponIcon(row.id);
                  const root = content.skills.find((skill) => skill.id === row.rootSkillId);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={cx("choice-card class-choice", path?.id === row.id && "choice-active")}
                      style={{ borderTopColor: row.color }}
                      onClick={() => setWeaponType(row.id)}
                    >
                      <div className="choice-head">
                        <span className="choice-icon" style={{ color: row.color }}>
                          <Icon size={20} />
                        </span>
                        <strong>{row.name}</strong>
                        {path?.id === row.id ? (
                          <span className="pick-check pick-check-on">✓</span>
                        ) : null}
                      </div>
                      <span className="choice-sub">{row.description}</span>
                      <div className="bonus-chips">
                        {row.startingItemIds.map((id) => {
                          const item = content.items.find((entry) => entry.id === id);
                          return item ? (
                            <span key={id} className="bonus-pos">
                              {item.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                      <p className="choice-desc">起始技能：{root?.name ?? row.rootSkillId}。</p>
                    </button>
                  );
                })}
              </div>

              <div className="section-head compact">
                <h2>初始技能</h2>
                <span className="muted-text">1 级 · 技能点 0</span>
              </div>
              <div className="skill-chips">
                {startSkills.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>

              <div className="create-confirm-row">
                <span className="muted-text">
                  {race ? `${race.name} · ${path?.name ?? ""}` : "请先从抽选中选择过往与武器"}
                </span>
                <Button
                  size="lg"
                  icon={Sparkles}
                  onClick={openNameDialog}
                  disabled={!race || !path || rolling || loading}
                >
                  确认招募
                </Button>
              </div>
            </Card>
          </div>

          <aside className="create-side">
            <Card className="preview-card">
              <div className="preview-head">
                {path ? (
                  <Sigil weaponType={path.id} color={path.color ?? "#c9a227"} size="lg" />
                ) : (
                  <Sparkles size={26} />
                )}
                <div>
                  <div className="eyebrow">预览</div>
                  <h3>{name.trim() || "待命名"}</h3>
                  <span>
                    {race ? race.name : "未选过往"} · {path ? path.name : "未选武器"}
                  </span>
                </div>
                {path ? (
                  <span className="hero-class-icon" style={{ color: path.color }}>
                    <WeaponIcon size={26} />
                  </span>
                ) : null}
              </div>

              {preview ? (
                <>
                  <div className="preview-metrics">
                    <div>
                      <span>生命</span>
                      <strong>{preview.maxHp}</strong>
                    </div>
                    <div>
                      <span>法力</span>
                      <strong>{preview.maxEnergy}</strong>
                    </div>
                    <div>
                      <span>攻击</span>
                      <strong>{Math.round(preview.attackPower)}</strong>
                    </div>
                    <div title="对同级标准物理攻击的减伤率">
                      <span>护甲</span>
                      <strong>
                        {Math.round(preview.armor)}（{Math.round(preview.physicalReduction * 100)}%）
                      </strong>
                    </div>
                    <div title="对同级标准怪物的命中率">
                      <span>命中</span>
                      <strong>
                        {Math.round(preview.hit)}（{Math.round(preview.hitRate * 100)}%）
                      </strong>
                    </div>
                    <div title="对同级标准怪物的闪避率">
                      <span>闪避</span>
                      <strong>
                        {Math.round(preview.evasion)}（{Math.round(preview.evasionRate * 100)}%）
                      </strong>
                    </div>
                    <div title="先攻决定行动顺序；每回合固定一次主要行动">
                      <span>先攻</span>
                      <strong>
                        {preview.initiative}（{preview.actionsPerRound} 行动）
                      </strong>
                    </div>
                    <div>
                      <span>暴击</span>
                      <strong>{Math.round(preview.critChance * 100)}%</strong>
                    </div>
                  </div>
                </>
              ) : null}

              <div className="preview-skills">
                <div className="eyebrow">初始技能 · 均为 1 级</div>
                {startSkills.map((label) => (
                  <div key={label} className="preview-skill">
                    <strong>{label}</strong>
                  </div>
                ))}
              </div>

              {path ? (
                <div className="preview-items">
                  <div className="eyebrow">初始装备</div>
                  {path.startingItemIds.map((id) => {
                    const item = content.items.find((row) => row.id === id);
                    if (!item) return null;
                    return (
                      <div key={id} className="preview-item">
                        <span>{item.name}</span>
                        <small>
                          {ITEM_SLOT_LABELS[item.slot]} · {RARITY_LABELS[item.rarity]}
                        </small>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </Card>
          </aside>
        </div>
      </div>

      <Modal
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        title="给拾荒者起个名字"
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setNameOpen(false)}>
              返回调整
            </Button>
            <Button
              type="submit"
              form="hero-name-form"
              icon={Sparkles}
              loading={loading}
              disabled={name.trim().length === 0}
            >
              确认招募
            </Button>
          </div>
        }
      >
        <form id="hero-name-form" onSubmit={submit} className="hero-name-form">
          <div className="name-summary">
            <span>
              {race?.name} · {path?.name}
            </span>
            <span className="muted-text">{startSkills.join(" / ")}</span>
          </div>
          <label className="field">
            <span>英雄名</span>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="例如：雨里的拾荒者"
              maxLength={12}
              autoFocus
              required
            />
            <small>最多 12 个字符，账号内不可重复；提交时会检查敏感词。</small>
          </label>
          {nameError ? <p className="name-error">{nameError}</p> : null}
          <p className="allocation-note">新英雄拥有 500 经验点，可在英雄面板训练。</p>
        </form>
      </Modal>

      {createPortal(
        <div className="mobile-create-bar">
          <span className="mobile-points">
            {race?.name} · {path?.name}
          </span>
          <Button
            size="lg"
            icon={Sparkles}
            onClick={openNameDialog}
            disabled={!race || !path || rolling || loading}
          >
            确认招募
          </Button>
        </div>,
        document.body,
      )}
    </>
  );
}
