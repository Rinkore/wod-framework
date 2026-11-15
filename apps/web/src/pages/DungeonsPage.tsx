import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Clock,
  Coins,
  HeartPulse,
  Skull,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";
import {
  formatDuration,
  withExtraRoutes,
  type Dungeon,
  type HeroCombatSettings,
  type HeroView,
  type Position,
} from "@wod/shared";
import {
  DUNGEON_LEVEL_TOLERANCE,
  UNDERLEVEL_PRESSURE,
  canChallengeMonsterLevel,
  roomMonsterLevel,
} from "@wod/engine";
import { api, errorMessage } from "../api";
import { useAuth, useContent } from "../context";
import { useApi, useNow } from "../hooks";

import {
  FloorFields,
  GeneralFields,
  MAX_FLOORS,
  cleanCombatSettings,
} from "../components/HeroPresets";
import { MazeMap, defaultPathFor, isPathValid } from "../components/MazeMap";
import {
  Badge,
  Button,
  ErrorNotice,
  Modal,
  PageHeader,
  Sigil,
  Spinner,
  cx,
  themeIcon,
} from "../components/ui";

const THEME_COLOR: Record<string, string> = {
  mine: "#b08a5a",
  crypt: "#7aa2e8",
  altar: "#d0704f",
  foundry: "#d08a4f",
  archive: "#8f8fd0",
  vault: "#77c6d8",
  throne: "#b07ad0",
};

const POSITION_LABEL: Record<Position, string> = {
  front: "前排",
  flank: "游走",
  back: "后排",
};

function partyLevel(party: HeroView[]): number {
  if (party.length === 0) return 0;
  return Math.floor(party.reduce((sum, hero) => sum + hero.level, 0) / party.length);
}

/** 路径上最高的怪物等级与是否全部可挑战。 */
function pathThreat(
  party: HeroView[],
  rooms: NonNullable<ReturnType<typeof useContent>>["dungeons"][number]["rooms"],
  content: NonNullable<ReturnType<typeof useContent>>,
): { maxLevel: number; eligible: boolean } {
  const level = partyLevel(party);
  let maxLevel = 0;
  let eligible = true;
  for (const room of rooms) {
    if (!room || room.monsters.length === 0) continue;
    const monsterLevel = roomMonsterLevel(content, room);
    maxLevel = Math.max(maxLevel, monsterLevel);
    if (!canChallengeMonsterLevel(level, monsterLevel)) eligible = false;
  }
  return { maxLevel, eligible };
}

export function DungeonsPage() {
  const content = useContent();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const heroesQ = useApi(() => api.heroes().then((data) => data.heroes), []);
  const presetsQ = useApi(() => api.presets().then((data) => data.presets), []);
  const preferencesQ = useApi(() => api.dungeonPreferences().then((data) => data.preferences), []);
  const regionsQ = useApi(() => api.personalMaze().then((data) => data.regions), []);
  const activeQ = useApi(
    () => api.activeExpeditions().then((data) => data.expeditions),
    [],
    4000,
  );
  const heroes = heroesQ.data ?? [];
  const presets = presetsQ.data ?? [];
  const preferences = preferencesQ.data ?? {};
  const regions = regionsQ.data ?? [];
  const runningDungeonIds = new Set((activeQ.data ?? []).map((row) => row.dungeonId));
  const now = useNow(1000);

  const [dungeon, setDungeon] = useState<Dungeon | null>(null);
  const [roomPath, setRoomPath] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedNpcs, setSelectedNpcs] = useState<string[]>([]);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [presetChoice, setPresetChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanding, setExpanding] = useState<string | null>(null);
  const [tempSettings, setTempSettings] = useState<Record<string, HeroCombatSettings>>({});
  const [configHero, setConfigHero] = useState<HeroView | null>(null);
  const [configSettings, setConfigSettings] = useState<HeroCombatSettings>({});
  const [configFloor, setConfigFloor] = useState(1);
  const [configBusy, setConfigBusy] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // 个人迷宫：按系列分组区域；每个系列可独立向更深处拓展。
  interface SeriesRegion {
    seriesId: string;
    depth: number;
    status: "frontier" | "cleared";
    exploredCount: number;
    dungeon: Dungeon;
    templateName: string;
    templateTheme?: string;
    running: boolean;
  }
  const seriesGroups = useMemo(() => {
    const groups = new Map<string, SeriesRegion[]>();
    for (const region of regions) {
      const template = content.dungeons.find((row) => row.seriesId === region.seriesId);
      const list = groups.get(region.seriesId) ?? [];
      list.push({
        seriesId: region.seriesId,
        depth: region.depth,
        status: region.status,
        exploredCount: region.exploredRoomIds.length,
        dungeon: region.dungeon,
        templateName: template?.name ?? region.dungeon.name.split(" · ")[0] ?? region.seriesId,
        templateTheme: template?.theme,
        running: runningDungeonIds.has(
          `pm-${region.seriesId}-d${region.depth}`,
        ),
      });
      groups.set(region.seriesId, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.depth - b.depth);
    }
    return [...groups.entries()].sort((a, b) =>
      (a[1][0]?.templateName ?? "").localeCompare(b[1][0]?.templateName ?? "", "zh-CN"),
    );
  }, [regions, content, runningDungeonIds]);
  const party = heroes.filter((hero) => selected.includes(hero.id));
  const partyHasSwift = Boolean(
    dungeon &&
      party.some((hero) => {
        const race = content.races.find((row) => row.id === hero.raceId);
        return (
          race?.dungeonAffinity?.perk === "swift" &&
          race.dungeonAffinity.tags.some((tag) => dungeon.tags.includes(tag))
        );
      }),
  );
  const activeDungeon = useMemo(
    () => (dungeon && partyHasSwift ? withExtraRoutes(dungeon) : dungeon),
    [dungeon, partyHasSwift],
  );
  const pathRooms = activeDungeon
    ? roomPath.flatMap((roomId) => activeDungeon.rooms.filter((room) => room.id === roomId))
    : [];
  // 站设置只覆盖战斗房（入口/宝箱不算站）；"第 N 站"永远是第 N 场战斗。
  const battleRooms = pathRooms.filter(
    (room) => room.kind === "combat" || room.kind === "boss",
  );
  const averageLevel = partyLevel(party);
  const threat = dungeon ? pathThreat(party, pathRooms, content) : { maxLevel: 0, eligible: false };
  const lastRoom = pathRooms[pathRooms.length - 1];
  const fullClear = lastRoom?.kind === "boss";
  const pathValid = activeDungeon ? isPathValid(activeDungeon, roomPath) : false;
  const estimatedSeconds = activeDungeon
    ? pathRooms.reduce(
        (sum, room, index) =>
          sum + (index === 0 ? 0 : room.durationSeconds ?? activeDungeon.roomSeconds),
        0,
      )
    : 0;
  const configFloorCount = Math.max(1, Math.min(battleRooms.length, MAX_FLOORS));

  const npcOptions = dungeon
    ? (dungeon.npcAssistIds ?? []).flatMap((id) => {
        const npc = content.npcs.find((row) => row.id === id);
        return npc ? [npc] : [];
      })
    : [];

  useEffect(() => {
    if (!dungeon) return;
    if (configFloor > configFloorCount) setConfigFloor(1);
  }, [dungeon, configFloorCount, configFloor]);

  useEffect(() => {
    if (!activeDungeon) return;
    setRoomPath((current) =>
      current.length > 0 && isPathValid(activeDungeon, current)
        ? current
        : defaultPathFor(activeDungeon),
    );
  }, [activeDungeon]);

  function presetsFor(heroId: string) {
    return presets.filter((preset) => preset.heroId === heroId);
  }

  function defaultPresetFor(heroId: string, dungeonId?: string) {
    const rows = presetsFor(heroId);
    const bound = dungeonId
      ? rows.find((preset) => preset.settings?.boundDungeonId === dungeonId)
      : undefined;
    return bound ?? rows.find((preset) => preset.isDefault) ?? rows[0];
  }

  function eligibility(hero: HeroView): string | null {
    if (hero.busyExpeditionId) return "远征中";
    if (hero.diedAt) return "已永久死亡";
    return null;
  }

  function pickPath(target: Dungeon): string[] {
    const remembered = preferences[target.id] as string[] | undefined;
    if (remembered && isPathValid(target, remembered)) return remembered;
    return defaultPathFor(target);
  }

  function openRegion(region: {
    seriesId: string;
    depth: number;
    dungeon: Dungeon;
  }) {
    const target = region.dungeon;
    setDungeon(target);
    setError(null);
    setNotice(null);
    setSelectedNpcs([]);
    setTempSettings({});
    setConfigHero(null);
    setRoomPath(pickPath(target));
    const eligible = heroes.filter((hero) => !eligibility(hero));
    const chosen = eligible.slice(0, 4);
    setSelected(chosen.map((hero) => hero.id));
    setPositions(
      Object.fromEntries(
        chosen.map((hero) => [
          hero.id,
          defaultPresetFor(hero.id, target.id)?.position ?? ("front" as Position),
        ]),
      ),
    );
    setPresetChoice(
      Object.fromEntries(
        chosen.map((hero) => [hero.id, defaultPresetFor(hero.id, target.id)?.id ?? ""]),
      ),
    );
  }

  async function expandSeries(seriesId: string) {
    setExpanding(seriesId);
    setError(null);
    setNotice(null);
    try {
      const data = await api.expandPersonalMaze(seriesId);
      await Promise.all([regionsQ.reload(), preferencesQ.reload()]);
      setNotice(`迷宫已拓展出新的区域（第 ${data.region.depth + 1} 区）。`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExpanding(null);
    }
  }

  function toggleHero(hero: HeroView) {
    if (!dungeon) return;
    if (eligibility(hero)) return;
    if (!selected.includes(hero.id) && selected.length + selectedNpcs.length >= 4) {
      return;
    }
    let nextSelected: string[];
    if (selected.includes(hero.id)) {
      nextSelected = selected.filter((id) => id !== hero.id);
      setTempSettings((current) => {
        const next = { ...current };
        delete next[hero.id];
        return next;
      });
    } else {
      nextSelected = [...selected, hero.id];
    }
    setSelected(nextSelected);
    const preset = defaultPresetFor(hero.id, dungeon.id);
    setPositions((current) =>
      current[hero.id] ? current : { ...current, [hero.id]: preset?.position ?? "front" },
    );
    setPresetChoice((current) =>
      current[hero.id] ? current : { ...current, [hero.id]: preset?.id ?? "" },
    );
  }

  function toggleNpc(npcId: string) {
    setSelectedNpcs((current) => {
      if (current.includes(npcId)) return current.filter((id) => id !== npcId);
      if (selected.length + current.length >= 4) return current;
      return [...current, npcId];
    });
  }

  function openConfig(hero: HeroView) {
    if (!dungeon) return;
    setConfigHero(hero);
    setConfigSettings(
      tempSettings[hero.id] ??
        defaultPresetFor(hero.id, dungeon.id)?.settings ??
        {},
    );
    setConfigFloor(1);
    setConfigError(null);
  }

  function resetConfig() {
    setConfigSettings({});
    setConfigFloor(1);
    setConfigError(null);
  }

  function applyConfig() {
    if (!configHero) return;
    setTempSettings((current) => ({
      ...current,
      [configHero.id]: cleanCombatSettings(configSettings),
    }));
    setConfigHero(null);
  }

  async function saveConfig() {
    if (!configHero || !dungeon) return;
    setConfigBusy(true);
    setConfigError(null);
    try {
      const position = positions[configHero.id] ?? "front";
      const settings = cleanCombatSettings(configSettings);
      const existing = defaultPresetFor(configHero.id, dungeon.id);
      const saved = existing
        ? (
            await api.updatePreset(configHero.id, existing.id, {
              position,
              settings,
            })
          ).preset
        : (await api.createPreset(configHero.id, { name: "默认预设", position, settings }))
            .preset;
      presetsQ.setData(
        existing
          ? (presets ?? []).map((preset) => (preset.id === saved.id ? saved : preset))
          : [...(presets ?? []), saved],
      );
      setPresetChoice((current) => ({ ...current, [configHero.id]: saved.id }));
      setTempSettings((current) => {
        const next = { ...current };
        delete next[configHero.id];
        return next;
      });
      setNotice(`已保存到预设「${saved.name}」。`);
      setConfigHero(null);
    } catch (err) {
      setConfigError(errorMessage(err));
    } finally {
      setConfigBusy(false);
    }
  }

  async function dispatch() {
    if (!dungeon) return;
    if (!pathValid) {
      setError("路线不合法：必须从入口出发、沿相邻房间前进且不重复");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const presetIds = Object.fromEntries(
        Object.entries(presetChoice).filter(([, presetId]) => Boolean(presetId)),
      );
      const data = await api.dispatch({
        dungeonId: dungeon.id,
        roomPath,
        heroIds: selected,
        positions,
        presetIds,
        npcIds: selectedNpcs,
        settingsByHero: tempSettings,
      });
      navigate(`/expeditions/${data.expedition.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="悬赏名录"
        title="迷宫"
        actions={
          <Badge tone="muted">
            <Users size={13} /> {heroes.length} 名英雄
          </Badge>
        }
      />

      {heroesQ.error ? <ErrorNotice message={heroesQ.error} /> : null}
      {heroesQ.loading && heroes.length === 0 ? <Spinner label="正在收集悬赏…" /> : null}

      <div className="dungeon-list">
        {seriesGroups.map(([seriesId, regionList]) => {
          const first = regionList[0];
          if (!first) return null;
          const highest = regionList[regionList.length - 1]!;
          const frontier = highest.status === "frontier" ? highest : null;
          const canExpand = Boolean(frontier);
          const template = content.dungeons.find((row) => row.seriesId === seriesId);
          const Icon = themeIcon(first.templateTheme ?? template?.theme);
          const color = THEME_COLOR[first.templateTheme ?? template?.theme ?? ""] ?? "#c9a227";
          return (
            <article
              key={seriesId}
              className="dungeon-card card"
              style={{ "--dungeon-color": color } as CSSProperties}
            >
              <div className="dungeon-head">
                <span className="dungeon-emblem">
                  <Icon size={24} />
                </span>
                <div className="dungeon-title">
                  <div className="eyebrow">{template?.subtitle ?? "专属迷宫"}</div>
                  <h2>{first.templateName}</h2>
                </div>
                <span className="dungeon-level">
                  <small>你的</small>
                  <strong>专属迷宫</strong>
                  <Badge tone="muted">已开拓 {regionList.length} 区</Badge>
                </span>
              </div>

              <p className="dungeon-desc">
                {template?.description ?? "依照你的探索记录展开的迷宫区域。"}
              </p>

              <div className="dungeon-meta">
                <span>
                  <Clock size={14} /> 每房约 {first.dungeon.roomSeconds}s
                </span>
                <span>
                  <Skull size={14} /> {highest.dungeon.rooms.length} 个房间 / 区域
                </span>
                <span>
                  <Coins size={14} /> 全通 {first.dungeon.completionReward.gold[0]}–
                  {first.dungeon.completionReward.gold[1]} 金币
                </span>
                <span>
                  <Sparkles size={14} /> {first.dungeon.completionReward.ep} 经验点
                </span>
                {first.dungeon.requiredLevel ? (
                  <span>准入 Lv{first.dungeon.requiredLevel}</span>
                ) : null}
              </div>

              <div className="route-summary">
                {(first.dungeon.tags ?? []).map((tag) => (
                  <span key={tag} className="route-pill route-pill-tag">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="region-chip-row" role="list" aria-label="迷宫区域">
                {regionList.map((region) => (
                  <button
                    key={region.depth}
                    type="button"
                    role="listitem"
                    className="region-chip"
                    title={`${region.dungeon.name} · 探索 ${region.exploredCount} 房`}
                    onClick={() => openRegion(region)}
                  >
                    <strong>第 {region.depth + 1} 区</strong>
                    {region.running ? (
                      <Badge tone="gold">远征中</Badge>
                    ) : region.status === "cleared" ? (
                      <Badge tone="green">已清理</Badge>
                    ) : (
                      <Badge tone="blue">待探索</Badge>
                    )}
                  </button>
                ))}
              </div>

              <div className="dungeon-foot">
                <span className="muted-text">
                  点击区域选择深度 · 3–4 人 · 自选路线
                </span>
                {canExpand ? (
                  <Button
                    variant="secondary"
                    loading={expanding === seriesId}
                    disabled={expanding !== null}
                    onClick={() => void expandSeries(seriesId)}
                  >
                    拓展第 {regionList.length + 1} 区
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled
                    title="清理当前最深处后可拓展"
                  >
                    拓展（先清理最深处）
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <Modal
        open={Boolean(dungeon)}
        onClose={() => {
          if (!configHero) setDungeon(null);
        }}
        title={dungeon ? `${dungeon.name} · 迷宫路线` : ""}
        wide
        footer={
          dungeon ? (
            <>
              <span className="modal-foot-info">
                已选 <strong>{selected.length}</strong> 名英雄（3–4 名可出发）
                {npcOptions.length > 0 ? <> · NPC <strong>{selectedNpcs.length}</strong> 人</> : null}
                {" · "}队伍均等级 <strong>Lv{averageLevel}</strong>
                {" · "}路线 <strong>{pathRooms.length}</strong> 站
                {lastRoom ? `（终点：${lastRoom.name}）` : ""}
              </span>
              <div className="modal-actions">
                <Button
                  variant="ghost"
                  onClick={() =>
                    setSelected(
                      heroes
                        .filter((hero) => !eligibility(hero))
                        .slice(0, Math.max(0, 4 - selectedNpcs.length))
                        .map((hero) => hero.id),
                    )
                  }
                >
                  全选可用
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelected([]);
                    setSelectedNpcs([]);
                  }}
                >
                  清空
                </Button>
                <Button
                  icon={ArrowRight}
                  loading={loading}
                  disabled={selected.length < 3 || !pathValid || !threat.eligible}
                  onClick={dispatch}
                >
                  {fullClear ? "全通出发" : "提前收队出发"}
                </Button>
              </div>
            </>
          ) : null
        }
      >
        {dungeon ? (
          <>
            <div className="dispatch-summary">
              <div>
                <span>预计用时</span>
                <strong>{formatDuration(estimatedSeconds)}</strong>
              </div>
              <div>
                <span>队伍平均等级</span>
                <strong>Lv{averageLevel}</strong>
              </div>
              <div>
                <span>路线最高怪物</span>
                <strong>Lv{threat.maxLevel}</strong>
              </div>
              <div>
                <span>路线</span>
                <strong>
                  {pathRooms.length} 站 · {fullClear ? "全通" : "提前收队"}
                </strong>
              </div>
              <div>
                <span>{fullClear ? "全通奖励" : "本次结算"}</span>
                <strong>
                  {fullClear
                    ? `${dungeon.completionReward.gold[0]}–${dungeon.completionReward.gold[1]} 金币`
                    : "保留已得掉落，无全通奖励"}
                </strong>
              </div>
            </div>

            <p className="muted-text">
              越级惩罚：队伍平均等级低于迷宫 {UNDERLEVEL_PRESSURE.freeLevels} 级以上时，
              怪物每差 1 级获得 +{Math.round(UNDERLEVEL_PRESSURE.hpPerLevel * 100)}% 生命、
              +{Math.round(UNDERLEVEL_PRESSURE.damagePerLevel * 100)}% 伤害。
            </p>

            <section className="route-picker-section">
              <div className="formation-head">
                <strong>选择路线</strong>
                <span className="muted-text">点击相邻房间延伸路线。</span>
                {partyHasSwift ? <Badge tone="gold">熟路往返：额外通路</Badge> : null}
              </div>
              <MazeMap
                dungeon={activeDungeon ?? dungeon}
                path={roomPath}
                onChange={setRoomPath}
                partyLevel={averageLevel}
              />
              <div className={cx("notice", fullClear ? "notice-success" : "notice-warn")}>
                {fullClear
                  ? "终点是 boss：清完后可领取全通奖励。"
                  : "终点不是 boss：清完路线后提前收队，保留已得物品/材料，但没有全通奖励。"}
              </div>
            </section>

            {error ? <ErrorNotice message={error} /> : null}
            {notice ? <div className="notice notice-success">{notice}</div> : null}

            {npcOptions.length > 0 ? (
              <div className="formation-panel">
                <div className="formation-head">
                  <strong>NPC 支援</strong>
                  <span className="muted-text">不获得经验与战利品，占用 6 人上限。</span>
                </div>
                <div className="hero-pick-list">
                  {npcOptions.map((npc) => {
                    const path = content.weapons.find((row) => row.id === npc.weaponType);
                    const picked = selectedNpcs.includes(npc.id);
                    const full = !picked && selected.length + selectedNpcs.length >= 4;
                    return (
                      <button
                        key={npc.id}
                        type="button"
                        className={cx(
                          "hero-pick",
                          picked && "hero-pick-active",
                          full && "hero-pick-disabled",
                        )}
                        onClick={() => toggleNpc(npc.id)}
                        disabled={full}
                      >
                        <Sigil weaponType={npc.weaponType} color={path?.color ?? "#c9a227"} size="md" />
                        <div className="hero-pick-main">
                          <strong>{npc.name}</strong>
                          <span>
                            等级 {npc.level} · {path?.name ?? npc.weaponType} · NPC 支援
                          </span>
                        </div>
                        <div className="hero-pick-meta">
                          <span>{POSITION_LABEL[npc.position]}</span>
                          <span>固定装备</span>
                        </div>
                        <Badge tone={picked ? "green" : "muted"}>
                          {picked ? "已加入" : full ? "队伍已满" : "可选"}
                        </Badge>
                        <span className={cx("pick-check", picked && "pick-check-on")}>
                          {picked ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {selected.length > 0 ? (
              <div className="formation-panel">
                <div className="formation-head">
                  <strong>站位</strong>
                  <span className="muted-text">近战只能攻击敌方前排；游走可绕后，但突袭后会暴露。</span>
                </div>
                <div className="formation-list">
                  {selected.map((heroId) => {
                    const hero = heroes.find((row) => row.id === heroId);
                    if (!hero) return null;
                    return (
                      <div key={heroId} className="formation-row">
                        <Sigil weaponType={hero.pathWeaponType} color={hero.weaponColor ?? "#c9a227"} size="sm" />
                        <span className="formation-name">{hero.name}</span>
                        <Badge tone="muted">战力 {hero.power}</Badge>
                        {tempSettings[heroId] ? <Badge tone="gold">本次</Badge> : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={SlidersHorizontal}
                          onClick={() => openConfig(hero)}
                          title="临时调整战前配置，默认不保存"
                        >
                          配置
                        </Button>
                        {presetsFor(heroId).length > 0 ? (
                          <select
                            className="formation-preset"
                            value={presetChoice[heroId] ?? ""}
                            onChange={(event) => {
                              const preset = presetsFor(heroId).find(
                                (row) => row.id === event.target.value,
                              );
                              if (!preset) return;
                              setPositions((current) => ({
                                ...current,
                                [heroId]: preset.position,
                              }));
                              setPresetChoice((current) => ({
                                ...current,
                                [heroId]: preset.id,
                              }));
                              setTempSettings((current) => {
                                const next = { ...current };
                                delete next[heroId];
                                return next;
                              });
                            }}
                            aria-label={`${hero.name} 预设`}
                          >
                            <option value="">预设</option>
                            {presetsFor(heroId).map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.name}（{POSITION_LABEL[preset.position]}）
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <select
                          value={positions[heroId] ?? "front"}
                          onChange={(event) => {
                            setPositions((current) => ({
                              ...current,
                              [heroId]: event.target.value as Position,
                            }));
                            setPresetChoice((current) => ({ ...current, [heroId]: "" }));
                          }}
                          aria-label={`${hero.name} 站位`}
                        >
                          {(["front", "flank", "back"] as Position[]).map((position) => (
                            <option key={position} value={position}>
                              {POSITION_LABEL[position]}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {heroes.length === 0 ? (
              <p className="muted-text">暂无英雄。</p>
            ) : (
              <div className="hero-pick-list">
                {heroes.map((hero) => {
                  const baseReason = eligibility(hero);
                  const picked = selected.includes(hero.id);
                  const full = !picked && selected.length + selectedNpcs.length >= 4;
                  const reason = baseReason ?? (full ? "队伍已满" : null);
                  return (
                    <div key={hero.id} className="hero-pick-stack">
                      <button
                        type="button"
                        className={cx(
                          "hero-pick",
                          picked && "hero-pick-active",
                          reason && "hero-pick-disabled",
                        )}
                        onClick={() => toggleHero(hero)}
                        disabled={Boolean(reason)}
                      >
                        <Sigil weaponType={hero.pathWeaponType} color={hero.weaponColor ?? "#c9a227"} size="md" />
                        <div className="hero-pick-main">
                          <strong>{hero.name}</strong>
                          <span>
                            等级 {hero.level} · {hero.raceName} {hero.weaponName}
                          </span>
                        </div>
                        <div className="hero-pick-meta">
                          <span>战力 {hero.power}</span>
                          <span>{hero.maxHp} 生命</span>
                        </div>
                        <Badge tone={reason ? "red" : "green"}>{reason ?? "可参战"}</Badge>
                        <span className={cx("pick-check", picked && "pick-check-on")}>
                          {picked ? "✓" : ""}
                        </span>
                      </button>
                      {hero.diedAt ? (
                        <div className="injury-inline">
                          <span>
                            <HeartPulse size={13} /> 已永久死亡
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {selected.length > 0 && !threat.eligible ? (
              <div className="notice notice-error">
                路线上有怪物高于队伍平均等级 {DUNGEON_LEVEL_TOLERANCE} 级以上（最高 Lv
                {threat.maxLevel}，队伍 Lv{averageLevel}）。请换一条路线或提升英雄等级。
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(configHero)}
        onClose={() => setConfigHero(null)}
        title={configHero ? `${configHero.name} · 战前配置` : ""}
        wide
        footer={
          configHero ? (
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setConfigHero(null)}>
                取消
              </Button>
              <Button variant="ghost" onClick={resetConfig}>
                重置
              </Button>
              <Button variant="secondary" loading={configBusy} onClick={applyConfig}>
                仅本次使用
              </Button>
              <Button loading={configBusy} onClick={saveConfig}>
                保存到预设
              </Button>
            </div>
          ) : null
        }
      >
        {configHero ? (
          <div className="preset-editor">
            <p className="preset-hint">
              站设置对应所选路线的 {configFloorCount} 场战斗（入口与宝箱不计站）。
              修改默认只作用于本次远征，不会自动写回预设；需要保留时点击“保存到预设”。
            </p>
            <GeneralFields
              settings={configSettings}
              skills={configHero.skills}
              onChange={setConfigSettings}
            />
            <section className="settings-section">
              <h3>站设置</h3>
              <div className="floor-tabs">
                {Array.from({ length: configFloorCount }, (_, index) => index + 1).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      className={configFloor === value ? "floor-tab floor-tab-active" : "floor-tab"}
                      onClick={() => setConfigFloor(value)}
                      title={battleRooms[value - 1]?.name}
                    >
                      第 {value} 站
                    </button>
                  ),
                )}
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={Boolean(configSettings.floors?.[String(configFloor)])}
                  onChange={(event) => {
                    const floorsMap = { ...(configSettings.floors ?? {}) };
                    if (event.target.checked) floorsMap[String(configFloor)] = {};
                    else delete floorsMap[String(configFloor)];
                    setConfigSettings({
                      ...configSettings,
                      floors: Object.keys(floorsMap).length > 0 ? floorsMap : undefined,
                    });
                  }}
                />
                <span>启用本层覆盖</span>
              </label>
              <FloorFields
                settings={configSettings}
                floor={configFloor}
                skills={configHero.skills}
                  onChange={setConfigSettings}
              />
            </section>
            {configError ? <ErrorNotice message={configError} /> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
