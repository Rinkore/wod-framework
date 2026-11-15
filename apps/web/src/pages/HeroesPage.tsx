import { useState } from "react";
import { Link } from "react-router-dom";
import { HeartPulse, Plus, Skull, Sparkles, Swords, Trash2 } from "lucide-react";
import {
  HERO_DELETE_COST,
  MAX_HEROES_PER_ACCOUNT,
  WEAPON_TYPE_LABELS,
  type DeathRosterView,
} from "@wod/shared";
import { api, errorMessage } from "../api";
import { useApi } from "../hooks";
import { HeroCard } from "../components/HeroCard";
import { useAuth } from "../context";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Modal,
  PageHeader,
  Spinner,
} from "../components/ui";

export function HeroesPage() {
  const { user, refreshUser } = useAuth();
  const heroesQ = useApi(() => api.heroes().then((data) => data.heroes), []);
  const rosterQ = useApi(() => api.deathRoster(), []);
  const heroes = heroesQ.data ?? [];
  const roster = rosterQ.data;
  const living = heroes.filter((hero) => !hero.diedAt);
  const full = living.length >= MAX_HEROES_PER_ACCOUNT;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 输入全名确认：删除存活英雄，或免费归档死者。
  const [deleteTarget, setDeleteTarget] = useState<
    { heroId: string; name: string; dead: boolean } | null
  >(null);
  const [confirmName, setConfirmName] = useState("");

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function refreshAll() {
    await Promise.all([heroesQ.reload(), rosterQ.reload(), refreshUser()]);
  }

  async function submitDelete() {
    if (!deleteTarget) return;
    await run("delete", async () => {
      await api.deleteHero(deleteTarget.heroId, confirmName.trim());
      setDeleteTarget(null);
      setConfirmName("");
      await refreshAll();
      setNotice(deleteTarget.dead ? `已免费归档「${deleteTarget.name}」，墓碑已保留，装备已回到背包。` : `已永久删除「${deleteTarget.name}」。`);
    });
  }

  async function revive(heroId: string, name: string, token: "pardon" | "redemption") {
    await run(`revive-${heroId}`, async () => {
      const data = await api.reviveHero(heroId, token);
      await refreshAll();
      setNotice(`「${name}」已复活为 ${data.hero.name}。`);
    });
  }

  const dead = roster?.dead ?? [];
  const tombstones = roster?.tombstones ?? [];
  const pardonCount = roster?.tokens.find((row) => row.type === "pardon")?.count ?? 0;
  const redemptionCount = roster?.tokens.find((row) => row.type === "redemption")?.count ?? 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="行会名册"
        title="英雄"
        actions={
          full ? (
            <Badge tone="gold">名册已满（{MAX_HEROES_PER_ACCOUNT}）</Badge>
          ) : (
            <Link to="/heroes/new" className="btn btn-primary btn-md">
              <Plus size={16} /> 创建英雄
            </Link>
          )
        }
      />

      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}

      {heroesQ.error ? <ErrorNotice message={heroesQ.error} /> : null}
      {heroesQ.loading && heroes.length === 0 ? <Spinner label="正在翻阅名册…" /> : null}

      {!heroesQ.loading && heroes.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="名册还是空的"
          text="先招募第一名英雄。一个可靠的战士通常是个不错的开始。"
          action={
            <Link to="/heroes/new" className="btn btn-primary btn-md">
              <Sparkles size={16} /> 招募英雄
            </Link>
          }
        />
      ) : null}

      {heroes.length > 0 ? (
        <div className="hero-grid">
          {heroes.map((hero) => (
            <div key={hero.id} className="hero-grid-cell">
              <HeroCard hero={hero} />
              {hero.diedAt ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  loading={busy === `delete-${hero.id}`}
                  className="hero-delete-btn"
                  onClick={() => {
                    setDeleteTarget({ heroId: hero.id, name: hero.name, dead: false });
                    setConfirmName("");
                  }}
                >
                  删除（{HERO_DELETE_COST} 金币）
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {roster && (dead.length > 0 || tombstones.length > 0 || pardonCount + redemptionCount > 0) ? (
        <Card className="death-roster-card">
          <div className="section-head compact">
            <h2>
              <Skull size={17} /> 死亡名册
            </h2>
            <span className="muted-text">
              {dead.length} 名死者 · 不占存活英雄名额
            </span>
          </div>
          <div className="death-token-row">
            <Badge tone="gold">死亡赦免券 ×{pardonCount}</Badge>
            <Badge tone="red">死亡赎回券 ×{redemptionCount}</Badge>
            <span className="muted-text">
              死亡不会移除角色或装备，也不影响创建与派遣。可免费归档死者，装备回背包并保留墓碑。已有赦免券可复活死者，赎回券可复活墓碑角色，均需空余名额。
            </span>
          </div>
          {dead.length > 0 ? (
            <div className="death-roster-list">
              {dead.map((entry) => (
                <div key={entry.heroId} className="death-roster-row">
                  <div className="death-roster-main">
                    <strong>{entry.name}</strong>
                    <span>
                      {WEAPON_TYPE_LABELS[entry.weaponType]} · 等级{" "}
                      {entry.level} · 死于{" "}
                      {new Date(entry.diedAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <div className="death-roster-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={HeartPulse}
                      loading={busy === `revive-${entry.heroId}`}
                      disabled={pardonCount < 1 || full || busy != null}
                      onClick={() => void revive(entry.heroId, entry.name, "pardon")}
                    >
                      赦免复活
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      disabled={busy != null}
                      onClick={() => {
                        setDeleteTarget({ heroId: entry.heroId, name: entry.name, dead: true });
                        setConfirmName("");
                      }}
                    >
                      免费归档
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">还没有角色死亡。保持这份幸运。</p>
          )}
          {tombstones.length > 0 ? (
            <>
              <div className="section-head compact">
                <h3>墓碑与历史归档</h3>
              </div>
              <div className="death-roster-list">
                {tombstones.map((entry) => (
                  <div key={entry.tombstoneId} className="death-roster-row">
                    <div className="death-roster-main">
                      <strong>{entry.name}</strong>
                      <span>
                        {WEAPON_TYPE_LABELS[entry.weaponType]} · 等级 {entry.level} · 归档于{" "}
                        {new Date(entry.deletedAt).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <div className="death-roster-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={HeartPulse}
                        loading={busy === `revive-${entry.tombstoneId}`}
                        disabled={redemptionCount < 1 || full || busy != null}
                        onClick={() => void revive(entry.tombstoneId, entry.name, "redemption")}
                      >
                        赎回复活
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={`${deleteTarget?.dead ? "归档" : "删除"}「${deleteTarget?.name ?? ""}」`}
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy === "delete"}
              disabled={
                confirmName.trim() !== (deleteTarget?.name ?? "") ||
                (!deleteTarget?.dead && (user?.gold ?? 0) < HERO_DELETE_COST)
              }
              onClick={() => void submitDelete()}
            >
              {deleteTarget?.dead ? "免费归档并保留墓碑" : `支付 ${HERO_DELETE_COST} 金币并删除`}
            </Button>
          </div>
        }
      >
        <p className="muted-text">
          {deleteTarget?.dead
            ? "免费归档将保留该英雄的墓碑、技能与声望，装备回到背包。之后可用已有赎回券恢复角色。请输入英雄全名以确认。"
            : `删除不可撤销：该英雄的等级、技能与声望将被删除，装备会回到背包。请输入英雄全名以确认。当前金币 ${user?.gold ?? 0}。`}
        </p>
        <label className="field">
          <span>输入英雄名确认</span>
          <input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={deleteTarget?.name}
            maxLength={12}
          />
        </label>
      </Modal>
    </div>
  );
}
