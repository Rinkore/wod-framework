import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Coins,
  Flame,
  Hourglass,
  Map,
  Sparkles,
  Swords,
  Users,
} from "lucide-react";
import { MAX_HEROES_PER_ACCOUNT } from "@wod/shared";
import { api } from "../api";
import { useAuth } from "../context";
import { useApi } from "../hooks";
import { Countdown } from "../components/Countdown";
import { HeroCard } from "../components/HeroCard";
import {
  Badge,
  Card,
  EmptyState,
  ErrorNotice,
  Gold,
  PageHeader,
  Sigil,
  Spinner,
  cx,
  themeIcon,
} from "../components/ui";

export function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const heroesQ = useApi(() => api.heroes().then((data) => data.heroes), []);
  const activeQ = useApi(() => api.activeExpeditions().then((data) => data.expeditions), [], 4000);
  const recentQ = useApi(() => api.expeditions(5).then((data) => data.expeditions), []);
  const unreadQ = useApi(
    () => api.unreadExpeditions().then((data) => data.expeditions),
    [],
    8000,
  );

  const previousActive = useRef<string[] | null>(null);
  useEffect(() => {
    const ids = activeQ.data?.map((expedition) => expedition.id) ?? null;
    const previous = previousActive.current;
    const changed =
      previous !== null &&
      ids !== null &&
      (ids.length < previous.length || previous.some((id) => !ids.includes(id)));
    if (changed) {
      void recentQ.reload();
      void unreadQ.reload();
      void heroesQ.reload();
      void refreshUser();
    }
    previousActive.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQ.data]);

  const heroes = heroesQ.data ?? [];
  const active = activeQ.data ?? [];
  const recent = recentQ.data ?? [];
  const unreadIds = new Set((unreadQ.data ?? []).map((expedition) => expedition.id));
  const highestLevel = heroes.reduce((max, hero) => Math.max(max, hero.level), 0);
  const ready = heroes.filter((hero) => !hero.busyExpeditionId && !hero.diedAt).length;
  const dead = heroes.filter((hero) => hero.diedAt).length;
  const errors = [heroesQ.error, activeQ.error, recentQ.error].filter(Boolean);
  const loading = heroesQ.loading && activeQ.loading && recentQ.loading;

  const today = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow={`拾荒行会 · ${today}`}
        title={`${user?.username}，欢迎回来`}
        actions={
          <Link to="/dungeons" className="btn btn-primary btn-md">
            <Map size={16} /> 派出远征
          </Link>
        }
      />

      {errors.length > 0 ? <ErrorNotice message={errors[0] as string} /> : null}

      <section className="stat-strip">
        <Card className="stat-card">
          <span className="stat-icon">
            <Coins size={18} />
          </span>
          <div>
            <span className="stat-label">金币</span>
            <strong>{user?.gold.toLocaleString("zh-CN") ?? 0}</strong>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon">
            <Users size={18} />
          </span>
          <div>
            <span className="stat-label">英雄</span>
            <strong>
              {heroes.length} <em>/ {MAX_HEROES_PER_ACCOUNT}</em>
            </strong>
            <small>
              {ready} 人待命{dead > 0 ? ` · ${dead} 人死亡` : ""}
            </small>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon">
            <Hourglass size={18} />
          </span>
          <div>
            <span className="stat-label">进行中的远征</span>
            <strong>{active.length}</strong>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon">
            <Sparkles size={18} />
          </span>
          <div>
            <span className="stat-label">最高等级</span>
            <strong>{highestLevel || 1} 级</strong>
          </div>
        </Card>
      </section>

      {loading ? <Spinner label="正在读取档案…" /> : null}

      <section className="reports-section">
        <div className="section-head">
          <h2>
            <Swords size={18} /> 最近战报
            <Badge tone="muted">{recent.length}</Badge>
          </h2>
        </div>
        <Card className="reports-card">
          {recent.length > 0 ? (
            <div className="recent-list">
              {recent.map((expedition) => {
                const outcome = expedition.result?.outcome;
                const running = expedition.status === "running";
                return (
                  <Link
                    key={expedition.id}
                    to={`/expeditions/${expedition.id}`}
                    className={cx(
                      "recent-row",
                      unreadIds.has(expedition.id) && "recent-row-unread",
                    )}
                  >
                    <span
                      className={cx(
                        "recent-dot",
                        running
                          ? "dot-gold"
                          : outcome === "victory" || outcome === "evacuated"
                            ? "dot-green"
                            : "dot-red",
                      )}
                    />
                    <div className="recent-text">
                      <strong>{expedition.dungeonName}</strong>
                      <span>
                        {running
                          ? "进行中"
                          : outcome === "victory"
                            ? "凯旋"
                            : outcome === "evacuated"
                              ? "成功撤离"
                              : "战败"}{" "}
                        · {expedition.heroes.length} 人 ·{" "}
                        {new Date(running ? expedition.startAt : expedition.endAt).toLocaleString(
                          "zh-CN",
                          {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </span>
                    </div>
                    {unreadIds.has(expedition.id) ? <Badge tone="gold">未读</Badge> : null}
                    <Gold amount={expedition.result?.rewards.gold ?? 0} />
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="muted-text">暂无战报。</p>
          )}
        </Card>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section>
            <div className="section-head">
              <h2>
                <Flame size={18} /> 正在远征
              </h2>
              <Link to="/dungeons" className="text-link">
                派遣新队伍 <ArrowRight size={14} />
              </Link>
            </div>

            {active.length > 0 ? (
              <div className="active-grid">
                {active.map((expedition) => {
                  const Icon = themeIcon(expedition.dungeonTheme);
                  return (
                    <Link
                      key={expedition.id}
                      to={`/expeditions/${expedition.id}`}
                      className="active-expedition card"
                    >
                      <div className="active-head">
                        <span className="dungeon-icon">
                          <Icon size={20} />
                        </span>
                        <div>
                          <strong>{expedition.dungeonName}</strong>
                          <span>{expedition.heroes.length} 名英雄深入废墟</span>
                        </div>
                        <Badge tone="gold">进行中</Badge>
                      </div>
                      <div className="active-party">
                        {expedition.heroes.map((hero) => (
                          <span key={hero.id} className="party-chip">
                            <Sigil weaponType={hero.weaponType} color={hero.weaponColor} size="sm" />
                            {hero.name}
                          </span>
                        ))}
                      </div>
                      <Countdown compact startAt={expedition.startAt} endAt={expedition.endAt} />
                      <span className="active-link">
                        查看远征 <ArrowRight size={14} />
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Card className="cta-card">
                <div className="cta-sigil">
                  <Map size={26} />
                </div>
                <div>
                  <h3>没有队伍在外</h3>
                </div>
                <Link to="/dungeons" className="btn btn-primary btn-md">
                  查看迷宫
                </Link>
              </Card>
            )}
          </section>

          <section>
            <div className="section-head">
              <h2>
                <Swords size={18} /> 英雄名册
              </h2>
              <Link to="/heroes" className="text-link">
                全部英雄 <ArrowRight size={14} />
              </Link>
            </div>
            {heroes.length > 0 ? (
              <div className="roster-grid">
                {heroes.map((hero) => (
                  <HeroCard key={hero.id} hero={hero} compact />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Users}
                title="还没有英雄"
                text={`最多可以招募 ${MAX_HEROES_PER_ACCOUNT} 名英雄。先组一支能活着回来的队伍。`}
                action={
                  <Link to="/heroes/new" className="btn btn-primary btn-md">
                    <Sparkles size={16} /> 创建英雄
                  </Link>
                }
              />
            )}
          </section>
        </div>

      </div>
    </div>
  );
}
