import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Coins,
  Flame,
  Hourglass,
  Map,
  Skull,
  Sparkles,
  Swords,
  Users,
} from "lucide-react";
import {
  RARITY_ORDER,
  type ExpeditionHeroSnapshot,
  type ExpeditionResultView,
} from "@wod/shared";
import { api } from "../api";
import { useAuth, useContent } from "../context";
import { useApi } from "../hooks";
import { Countdown } from "../components/Countdown";
import { ItemCard } from "../components/ItemCard";
import { BattleReport } from "../report/BattleReport";
import { buildReport } from "../report/model";
import {
  Badge,
  Card,
  ErrorNotice,
  Gold,
  PageHeader,
  Sigil,
  Spinner,
  cx,
  themeIcon,
} from "../components/ui";

function heroOf(
  result: ExpeditionResultView,
  snapshots: ExpeditionHeroSnapshot[],
  heroId: string,
) {
  return {
    snapshot: snapshots.find((hero) => hero.id === heroId),
    line: result.perHero.find((hero) => hero.heroId === heroId),
  };
}

export function ExpeditionPage() {
  const { id } = useParams<{ id: string }>();
  const content = useContent();
  const { user, refreshUser } = useAuth();
  const [pollMs, setPollMs] = useState(2000);
  const [lootOwnerId, setLootOwnerId] = useState<string | null>(null);
  const expeditionQ = useApi(
    () =>
      id
        ? api.expedition(id).then((data) => data.expedition)
        : Promise.reject(new Error("缺少远征编号")),
    [id],
    pollMs,
  );
  const expedition = expeditionQ.data;
  const refreshed = useRef<string | null>(null);

  const reportFloors = useMemo(() => {
    const result = expedition?.result;
    if (!expedition || !result) return [];
    const dungeon = content.dungeons.find((row) => row.id === expedition.dungeonId);
    const pathRooms = (expedition.roomPath ?? []).flatMap((roomId) =>
      dungeon?.rooms.filter((room) => room.id === roomId) ?? [],
    );
    const routeEncounters = pathRooms
      .filter((room) => room.kind !== "start" && room.kind !== "treasure" && room.monsters.length > 0)
      .map((room) => ({
        name: room.name,
        monsters: room.monsters.flatMap((group) => {
          const monster = content.monsters.find((row) => row.id === group.monsterId);
          return monster ? [{ name: monster.name, monsterId: monster.id, count: group.count }] : [];
        }),
      }));
    const heroes = [
      ...expedition.heroes.map((hero) => ({
        id: hero.id,
        name: hero.name,
        level: hero.level,
        weaponType: hero.weaponType,
        weaponName: hero.weaponName,
        weaponColor: hero.weaponColor,
      })),
      ...(expedition.npcs ?? []).map((npc) => ({
        id: npc.id,
        name: npc.name,
        level: 1,
        weaponType: npc.weaponType,
        weaponName: npc.weaponName,
        weaponColor: npc.weaponColor,
      })),
    ];
    return buildReport({ encounters: result.encounters, heroes, routeEncounters });
  }, [expedition, content]);

  useEffect(() => {
    if (!expedition) return;
    if (expedition.status === "running") {
      setPollMs(2000);
    } else {
      setPollMs(0);
      if (refreshed.current !== expedition.id) {
        refreshed.current = expedition.id;
        void refreshUser();
        void api.markExpeditionRead(expedition.id).catch(() => {
          // 标记未读失败不阻塞战报展示。
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expedition?.status, expedition?.id]);

  useEffect(() => {
    setLootOwnerId(null);
  }, [id]);

  if (expeditionQ.loading && !expedition) return <Spinner label="正在接收远征信号…" />;
  if (!expedition) {
    return (
      <div className="page">
        <ErrorNotice message={expeditionQ.error ?? "远征记录不存在"} />
        <Link to="/" className="btn btn-ghost btn-md">
          <ArrowLeft size={16} /> 返回概览
        </Link>
      </div>
    );
  }

  const dungeon = content.dungeons.find((row) => row.id === expedition.dungeonId);
  const pathRooms = (expedition.roomPath ?? []).flatMap((roomId) =>
    dungeon?.rooms.filter((room) => room.id === roomId) ?? [],
  );
  const pathLabel = (expedition.roomNames ?? pathRooms.map((room) => room.name)).join(" → ");
  const Icon = themeIcon(dungeon?.theme);
  const result = expedition.result;

  if (expedition.status === "running") {
    return (
      <div className="page">
        <Link to="/" className="back-link">
          <ArrowLeft size={15} /> 返回概览
        </Link>
          <PageHeader
            eyebrow="远征进行中"
            title={expedition.dungeonName}
            description={pathLabel ? `${pathLabel} · 共 ${pathRooms.length} 站` : undefined}
            actions={<Badge tone="gold">进行中</Badge>}
          />

        <Card className="running-card">
          <div className="running-emblem">
            <span className="pulse-ring" />
            <span className="running-icon">
              <Icon size={34} />
            </span>
          </div>
          <Countdown
            startAt={expedition.startAt}
            endAt={expedition.endAt}
            onDone={() => {
              setPollMs(2000);
              void expeditionQ.reload();
            }}
          />
          <p className="running-copy">
            雨灯已经点起。队伍穿过第一道门，声音被黑暗吞掉。远征结束后，战报会自动送回行会。
          </p>
          <div className="running-party">
            {expedition.heroes.map((hero) => (
              <Link key={hero.id} to={`/heroes/${hero.id}`} className="party-chip big">
                <Sigil weaponType={hero.weaponType} color={hero.weaponColor} size="sm" />
                <span>
                  <strong>{hero.name}</strong>
                  <small>
                    等级 {hero.level} · {hero.weaponName}
                  </small>
                </span>
              </Link>
            ))}
            {(expedition.npcs ?? []).map((npc) => (
              <div key={npc.id} className="party-chip big">
                <Sigil weaponType={npc.weaponType} color={npc.weaponColor} size="sm" />
                <span>
                  <strong>{npc.name}</strong>
                  <small>
                    NPC 支援 · {npc.weaponName}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <div className="running-meta">
            <span>
              <Map size={14} /> {pathRooms.length} 站 · 终点 {pathRooms[pathRooms.length - 1]?.name ?? "?"}
            </span>
            <span>
              <Hourglass size={14} /> 预计{" "}
              {Math.max(1, Math.round((expedition.endAt - expedition.startAt) / 60000))} 分钟
            </span>
            <span>
              <Users size={14} /> {expedition.heroes.length} 人
              {(expedition.npcs?.length ?? 0) > 0
                ? ` + ${expedition.npcs?.length} NPC`
                : ""}
            </span>
          </div>
        </Card>

        <Card className="running-brief">
          <div className="section-head compact">
            <h2>
              <Swords size={17} /> 作战简报
            </h2>
            <span className="muted-text">
              {pathLabel ? `${pathLabel} · ` : ""}队伍将按顺序通过以下房间
            </span>
          </div>
          <div className="brief-chain">
            {pathRooms.map((room, index) => (
              <div key={room.id} className="brief-node">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{room.name}</strong>
                  <small>
                    {room.monsters.length === 0
                      ? room.kind === "start"
                        ? "安全入口"
                        : "无遭遇 · 可直接搜刮"
                      : room.monsters
                          .map((group) => {
                            const monster = content.monsters.find((row) => row.id === group.monsterId);
                            return `${monster?.name ?? group.monsterId} ×${group.count}`;
                          })
                          .join(" · ")}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="page">
        <ErrorNotice message="远征已经结束，但战报缺失。请联系服务器管理员。" />
        <Link to="/dungeons" className="btn btn-ghost btn-md">
          返回迷宫
        </Link>
      </div>
    );
  }

  // 撤离（含超时撤退）是"活着带回战利品"的成功结果，不是失败。
  const victory = result.outcome === "victory";
  const evacuated = result.outcome === "evacuated";
  const survived = victory || evacuated;
  const timedOut = result.encounters.some((encounter) => encounter.timeout);
  const fullClear = result.routeCleared ?? victory;
  const groupShares = result.groupShares ?? [];
  const defaultLootOwnerId =
    groupShares.find((share) => share.userId === user?.id)?.userId ??
    groupShares[0]?.userId ??
    null;
  const activeLootOwnerId = lootOwnerId ?? defaultLootOwnerId;
  const activeShare =
    groupShares.find((share) => share.userId === activeLootOwnerId) ?? null;
  const displayedItems = (
    activeShare
      ? result.rewards.items.filter(
          (item) =>
            item.ownerUserId === activeShare.userId ||
            (!item.ownerUserId && item.ownerName === activeShare.username),
        )
      : result.rewards.items
  )
    .slice()
    .sort(
      (a, b) =>
        RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || b.value - a.value,
    );
  const routeLabel = (result.roomNames ?? pathRooms.map((room) => room.name)).join(" → ") || "远征路线";
  const depthLabel = pathRooms.length || result.encounters.length;
  const routeLengthLabel = depthLabel;

  return (
    <div className="page">
      <Link to="/dungeons" className="back-link">
        <ArrowLeft size={15} /> 返回迷宫
      </Link>

      <PageHeader
        eyebrow={`${expedition.dungeonName} · ${routeLabel}`}
        title={fullClear
          ? "凯旋"
          : victory
            ? "提前收队"
            : timedOut
              ? "超时撤退"
              : "成功撤离"}
        actions={
          <div className="header-actions">
            <Link to="/dungeons" className="btn btn-primary btn-md">
              再次派遣 <ArrowRight size={15} />
            </Link>
            <Link to="/" className="btn btn-ghost btn-md">
              返回概览
            </Link>
          </div>
        }
      />

      {expeditionQ.error ? <ErrorNotice message={expeditionQ.error} /> : null}

      <div className={cx("result-banner", survived ? "result-victory" : "result-defeat")}>
        <div className="result-banner-main">
          <span className="result-emblem">
            {survived ? <Sparkles size={26} /> : <Skull size={26} />}
          </span>
          <div>
            <div className="eyebrow">
              {fullClear
                ? "线路全通"
                : victory
                  ? "提前收队"
                  : timedOut
                    ? "战斗超时 · 保留已得战利品"
                    : "成功撤离 · 保留已得战利品"}
              {" "}· 第 {depthLabel} /{" "}
              {routeLengthLabel} 站
            </div>
            <h2>
              {fullClear
                ? "荒原又少了一处威胁"
                : survived
                  ? "见好就收，也是一门手艺"
                  : "这次没有走完"}
            </h2>
            <p>
              种子 {result.seed} · {new Date(expedition.startAt).toLocaleString("zh-CN")}
            </p>
          </div>
        </div>
        <div className="result-stats">
          <div>
            <span>回合</span>
            <strong>{result.summary.rounds}</strong>
          </div>
          <div>
            <span>击杀</span>
            <strong>{result.summary.monstersSlain}</strong>
          </div>
          <div>
            <span>存活</span>
            <strong>
              {result.summary.survivors}/{expedition.heroes.length}
            </strong>
          </div>
          <div>
            <span>金币</span>
            <strong>
              <Coins size={14} /> {result.rewards.gold}
            </strong>
          </div>
        </div>
      </div>

      <div className="result-grid result-grid-stack">
        <Card className="rewards-card rewards-card-wide">
          <div className="section-head compact">
            <h2>
              战利品
              {activeShare ? (
                <span className="rewards-owner"> · {activeShare.username}</span>
              ) : null}
            </h2>
            <div className="rewards-head-meta">
              <span className="muted-text">{displayedItems.length} 件</span>
              <Gold amount={activeShare ? activeShare.gold : result.rewards.gold} />
            </div>
          </div>
          {(result.lotteryDrops ?? []).some((drop) => drop.userId === user?.id) ? (
            <div className="notice notice-success">获得库存彩票 ×1。可在彩票页自行选择投入日期，尚未参加任何奖池。</div>
          ) : null}
          <div className="reward-bonuses">
            <div className="reward-xp">
              <Sparkles size={15} /> 每名英雄获得 {result.rewards.ep} 经验点（倒下者减半）
            </div>
            {result.rewards.fame ? (
              <div className="reward-xp">
                <Award size={15} /> 每名英雄获得 {result.rewards.fame} 声望
              </div>
            ) : null}
          </div>
          {(victory || evacuated) && !fullClear ? (
            <div className="notice notice-warn">
              提前收队：已保留第 1–{depthLabel} 站的掉落，但没有线路全通奖励。
            </div>
          ) : null}
          {groupShares.length > 0 ? (
            <div className="group-shares group-shares-inline">
              <span className="eyebrow">组队分配 · 点击玩家查看战利品</span>
              {groupShares.map((share) => {
                const active = share.userId === activeShare?.userId;
                return (
                  <button
                    key={share.userId}
                    type="button"
                    className={cx(
                      "group-share-row",
                      "group-share-button",
                      active && "is-active",
                    )}
                    aria-pressed={active}
                    title={`查看 ${share.username} 的战利品`}
                    onClick={() => setLootOwnerId(share.userId)}
                  >
                    <span>{share.username}</span>
                    <span>
                      +{share.gold} 金币 · {share.itemCount} 件
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {displayedItems.length > 0 ? (
            <div className="reward-items reward-items-grid">
              {displayedItems.map((item) => (
                <ItemCard key={item.id} item={item} compact />
              ))}
            </div>
          ) : (
            <p className="muted-text">
              {activeShare
                ? `${activeShare.username} 这次没有带回物品或材料。`
                : "这次没有带回物品或材料。"}
            </p>
          )}
        </Card>

        <div className="result-main">
          <div className="section-head">
            <h2>
              <Swords size={18} /> 战斗记录
            </h2>
            <span className="muted-text">{result.encounters.length} 场战斗</span>
          </div>
          <BattleReport
            floors={reportFloors}
            meta={{
              dungeonName: expedition.dungeonName,
              routeName: result.roomNames?.join(" → "),
              seed: result.seed,
              startAt: expedition.startAt,
            }}
          />
        </div>

        {!survived ? (
          <Card className="result-note">
            <Flame size={18} />
            <p>倒下的英雄已永久死亡。在死亡名册中查看记录，或换一批人继续。</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
