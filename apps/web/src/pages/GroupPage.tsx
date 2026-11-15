import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Copy,
  Crown,
  HeartPulse,
  KeyRound,
  LogOut,
  Map,
  Plus,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Swords,
} from "lucide-react";
import {
  GROUP_VISIBILITIES,
  GROUP_VISIBILITY_LABELS,
  dungeonScheduleLabel,
  formatDuration,
  isDungeonOpen,
  withExtraRoutes,
  type GroupHeroView,
  type GroupVisibility,
  type HeroCombatSettings,
  type GroupView,
  type Position,
} from "@wod/shared";
import {
  DUNGEON_LEVEL_TOLERANCE,
  canChallengeMonsterLevel,
  dungeonMonsterLevel,
  roomMonsterLevel,
} from "@wod/engine";
import { MazeMap, defaultPathFor, isPathValid } from "../components/MazeMap";
import { api, errorMessage } from "../api";
import { useAuth, useContent } from "../context";
import { useApi, useNow } from "../hooks";

import {
  FloorFields,
  GeneralFields,
  MAX_FLOORS,
  cleanCombatSettings,
} from "../components/HeroPresets";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Modal,
  PageHeader,
  Sigil,
  Spinner,
  cx,
  themeIcon,
} from "../components/ui";

const POSITION_LABEL: Record<Position, string> = {
  front: "前排",
  flank: "游走",
  back: "后排",
};

const GROUP_VISIBILITY_HINTS: Record<GroupVisibility, string> = {
  public: "所有玩家都能在招募列表看到并加入。",
  invite: "不会出现在招募列表，只能凭邀请码加入。",
  friends: "只有你的好友能在招募列表看到并加入。",
  guild: "只有同公会成员能在招募列表看到并加入。",
  "guild-friends": "你的好友或同公会成员能看到并加入。",
};

function groupAverageLevel(heroes: GroupHeroView[]): number {
  if (heroes.length === 0) return 0;
  return Math.floor(heroes.reduce((sum, hero) => sum + hero.level, 0) / heroes.length);
}

export function GroupPage() {
  const content = useContent();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const groupQ = useApi(() => api.myGroup().then((data) => data.group), [], 3000);
  const heroesQ = useApi(() => api.heroes().then((data) => data.heroes), []);
  const openQ = useApi(() => api.openGroups().then((data) => data.groups), []);
  const presetsQ = useApi(() => api.presets().then((data) => data.presets), []);
  const preferencesQ = useApi(
    () => api.dungeonPreferences().then((data) => data.preferences),
    [],
  );
  const preferences = preferencesQ.data ?? {};
  const now = useNow(1000);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("public");
  const [code, setCode] = useState("");
  const [dungeonId, setDungeonId] = useState("");
  const [roomPath, setRoomPath] = useState<string[]>([]);
  const [routeDirty, setRouteDirty] = useState(false);
  const [dungeonOpen, setDungeonOpen] = useState(false);
  const [presetChoice, setPresetChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [configHero, setConfigHero] = useState<
    GroupView["heroes"][number] | null
  >(null);
  const [configSettings, setConfigSettings] = useState<HeroCombatSettings>({});
  const [configFloor, setConfigFloor] = useState(1);
  const [configBusy, setConfigBusy] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);


  const group = groupQ.data;
  const heroes = heroesQ.data ?? [];
  const openGroups = openQ.data ?? [];
  const presets = presetsQ.data ?? [];
  const configHeroSkills =
    heroes.find((hero) => hero.id === configHero?.heroId)?.skills ?? [];

  function presetsFor(heroId: string) {
    return presets.filter((preset) => preset.heroId === heroId);
  }

  function defaultPresetFor(heroId: string, targetDungeonId?: string) {
    const rows = presetsFor(heroId);
    const bound = targetDungeonId
      ? rows.find((preset) => preset.settings?.boundDungeonId === targetDungeonId)
      : undefined;
    return bound ?? rows.find((preset) => preset.isDefault) ?? rows[0];
  }
  const isLeader = Boolean(group && user && group.leaderUserId === user.id);
  const myHeroes = group?.heroes.filter((hero) => hero.userId === user?.id) ?? [];
  // 队长未改动路线时跟随已通知的队列；改动后以本地路线为准。队员始终只读队列。
  const groupQueue = group?.queue ?? null;
  const memberQueue = !isLeader ? groupQueue : null;
  const leaderQueue = isLeader && !routeDirty ? groupQueue : null;
  const viewedDungeonId =
    memberQueue?.dungeonId ?? leaderQueue?.dungeonId ?? dungeonId;
  const viewedRoomPath =
    memberQueue?.roomPath ?? leaderQueue?.roomPath ?? roomPath;

  useEffect(() => {
    if (group?.status === "completed") {
      void heroesQ.reload();
      void refreshUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.status]);

  useEffect(() => {
    if (group && !dungeonId) setDungeonId(group.dungeonId ?? content.dungeons[0]?.id ?? "");
  }, [group, dungeonId, content.dungeons]);

  useEffect(() => {
    const targetDungeon = content.dungeons.find((row) => row.id === dungeonId);
    if (!targetDungeon) return;
    const remembered = preferences[targetDungeon.id] as string[] | undefined;
    setRoomPath(
      remembered && isPathValid(targetDungeon, remembered)
        ? remembered
        : defaultPathFor(targetDungeon),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeonId, content.dungeons]);

  async function act(key: string, task: () => Promise<void>) {
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

  async function refreshAfterAction() {
    await groupQ.reload();
    await heroesQ.reload();
    await openQ.reload();
  }

  function groupHeroBaseSettings(
    hero: GroupView["heroes"][number],
  ): HeroCombatSettings {
    if (Object.keys(hero.settings ?? {}).length > 0) return hero.settings;
    const preset = presetsFor(hero.heroId).find(
      (row) => row.id === (presetChoice[hero.heroId] ?? hero.presetId ?? ""),
    );
    return (
      preset?.settings ??
      defaultPresetFor(hero.heroId, viewedDungeonId)?.settings ??
      {}
    );
  }

  function openConfig(hero: GroupView["heroes"][number]) {
    const own = heroes.find((row) => row.id === hero.heroId);
    if (!own) return;
    setConfigHero(hero);
    setConfigSettings(structuredClone(groupHeroBaseSettings(hero)));
    setConfigFloor(1);
    setConfigError(null);
  }

  async function saveConfig(clear: boolean) {
    if (!configHero || !group) return;
    setConfigBusy(true);
    setConfigError(null);
    try {
      const data = await api.setGroupHeroSettings(
        group.id,
        configHero.heroId,
        clear ? {} : cleanCombatSettings(configSettings),
      );
      groupQ.setData(data.group);
      setNotice(
        clear
          ? "已清除临时配置，出发时将使用预设。"
          : "战前配置已保存到本次组队。",
      );
      setConfigHero(null);
    } catch (err) {
      setConfigError(errorMessage(err));
    } finally {
      setConfigBusy(false);
    }
  }

  async function copyJoinCode() {
    if (!group) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(group.joinCode);
      } else {
        // HTTP 内测环境下 Clipboard API 不可用，退回 execCommand。
        const input = document.createElement("textarea");
        input.value = group.joinCode;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(input);
        if (!copied) throw new Error("copy failed");
      }
      setNotice("邀请码已复制。");
      setError(null);
    } catch {
      setError(`复制失败，请手动记录邀请码：${group.joinCode}`);
    }
  }

  if (groupQ.loading && !group) return <Spinner label="正在寻找队伍…" />;

  if (!group) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="队伍大厅"
          title="组队"
        />
        {error ? <ErrorNotice message={error} /> : null}
        {notice ? <div className="notice notice-success">{notice}</div> : null}

        <div className="group-lobby">
          <Card className="group-create">
            <div className="eyebrow">创建队伍</div>
            <h3>举起一面旗</h3>
            <label className="field group-visibility-field">
              <span>队伍可见性</span>
              <select
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as GroupVisibility)
                }
              >
                {GROUP_VISIBILITIES.map((value) => (
                  <option key={value} value={value}>
                    {GROUP_VISIBILITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted-text group-create-hint">
              {GROUP_VISIBILITY_HINTS[visibility]}
            </p>
            <div className="inline-form">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="队伍名，例如：燃烬行者"
                maxLength={24}
              />
              <Button
                icon={Plus}
                loading={busy === "create"}
                disabled={name.trim().length < 2}
                onClick={() =>
                  act("create", async () => {
                    const data = await api.createGroup(name.trim(), visibility);
                    groupQ.setData(data.group);
                    await openQ.reload();
                    setNotice(`队伍已创建，邀请码：${data.group.joinCode}。`);
                  })
                }
              >
                创建
              </Button>
            </div>
          </Card>

          <Card className="group-create">
            <div className="eyebrow">加入队伍</div>
            <h3>用邀请码入队</h3>
            <div className="inline-form">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="例如：K7M2QX"
                maxLength={8}
              />
              <Button
                icon={KeyRound}
                loading={busy === "join"}
                disabled={code.trim().length < 4}
                onClick={() =>
                  act("join", async () => {
                    const data = await api.joinGroup(code.trim());
                    groupQ.setData(data.group);
                    setNotice("已加入队伍。");
                  })
                }
              >
                加入
              </Button>
            </div>
          </Card>
        </div>

        <section className="group-open">
          <div className="section-head">
            <h2>
              <Users size={18} /> 正在招募
            </h2>
            <span className="muted-text">{openGroups.length} 支队伍</span>
          </div>
          {openGroups.length > 0 ? (
            <div className="group-open-list">
              {openGroups.map((row) => (
                <div key={row.id} className="group-open-row">
                  <span className="group-open-icon">
                    <Shield size={18} />
                  </span>
                  <div className="group-open-main">
                    <strong>{row.name}</strong>
                    <span>
                      队长 {row.leaderName} · {row.memberCount} 人 · {row.heroCount}/4 英雄
                    </span>
                  </div>
                  {row.visibility !== "public" ? (
                    <Badge tone="muted">
                      {GROUP_VISIBILITY_LABELS[row.visibility]}
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={UserPlus}
                    loading={busy === `join-${row.id}`}
                    onClick={() =>
                      act(`join-${row.id}`, async () => {
                        const data = await api.joinGroupById(row.id);
                        groupQ.setData(data.group);
                        setNotice("已加入队伍。");
                      })
                    }
                  >
                    加入
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Users} title="目前没有可加入的队伍" text="创建一个，或者等别人举起旗。" />
          )}
        </section>
      </div>
    );
  }

  const availableHeroes = heroes.filter(
    (hero) =>
      !hero.busyExpeditionId &&
      !group.heroes.some((row) => row.heroId === hero.id),
  );
  const canAdd = group.status === "recruiting" && group.heroes.length < 6;
  const selectedDungeon = content.dungeons.find((row) => row.id === viewedDungeonId);
  const groupHasSwift = Boolean(
    selectedDungeon &&
      group.heroes.some((hero) => {
        const race = content.races.find((row) => row.id === hero.raceId);
        return (
          race?.dungeonAffinity?.perk === "swift" &&
          race.dungeonAffinity.tags.some((tag) => selectedDungeon.tags.includes(tag))
        );
      }),
  );
  const activeDungeon =
    selectedDungeon && groupHasSwift ? withExtraRoutes(selectedDungeon) : selectedDungeon;
  const orderedPathRooms = viewedRoomPath.flatMap(
    (roomId) => activeDungeon?.rooms.filter((room) => room.id === roomId) ?? [],
  );
  const averageLevel = groupAverageLevel(group.heroes);
  const pathMonsterLevels = orderedPathRooms
    .filter((room) => room.monsters.length > 0)
    .map((room) => roomMonsterLevel(content, room));
  const maxPathLevel = pathMonsterLevels.length > 0 ? Math.max(...pathMonsterLevels) : 0;
  const selectedDepthEligible = Boolean(
    activeDungeon &&
      isPathValid(activeDungeon, viewedRoomPath) &&
      pathMonsterLevels.every((level) => canChallengeMonsterLevel(averageLevel, level)),
  );
  const pathFullClear =
    orderedPathRooms[orderedPathRooms.length - 1]?.kind === "boss";
  const deathProblems = group.heroes.filter((hero) => hero.diedAt);
  const queue = groupQueue;
  const queueMatchesSelection =
    queue != null &&
    selectedDungeon != null &&
    queue.dungeonId === viewedDungeonId &&
    queue.roomPath.length === viewedRoomPath.length &&
    queue.roomPath.every((roomId, index) => roomId === viewedRoomPath[index]);
  const otherMembers = group.members.filter((member) => member.userId !== group.leaderUserId);
  const allMembersReady =
    otherMembers.length === 0 ||
    otherMembers.every((member) => member.readyState === 1);
  const queueIsCurrent = queue != null && queueMatchesSelection;
  const canStart =
    isLeader &&
    group.status === "recruiting" &&
    group.heroes.length > 0 &&
    selectedDepthEligible &&
    queueIsCurrent &&
    allMembersReady &&
    Boolean(selectedDungeon && isDungeonOpen(selectedDungeon));
  const readyCount = otherMembers.filter((member) => member.readyState === 1).length;
  const myReadyState =
    group.members.find((member) => member.userId === user?.id)?.readyState ?? 0;

  function notifyQueue() {
    if (!group || !selectedDungeon) return;
    void act(
      "queue",
      async () => {
        const data = await api.queueGroupExpedition(group.id, {
          dungeonId: selectedDungeon.id,
          roomPath: viewedRoomPath,
        });
        groupQ.setData(data.group);
        setRouteDirty(false);
        setNotice(
          `已通知队友：${selectedDungeon.name} · ${orderedPathRooms
            .map((room) => room.name)
            .join(" → ")}。等待全员准备后即可出发。`,
        );
      },
    );
  }

  function cancelQueue() {
    if (!group) return;
    void act("queue-cancel", async () => {
      const data = await api.cancelGroupQueue(group.id);
      groupQ.setData(data.group);
      setNotice("已取消本次组队通知。");
    });
  }

  function setReady() {
    if (!group) return;
    void act("ready", async () => {
      const data = await api.setMemberReady(group.id);
      groupQ.setData(data.group);
      setNotice("已准备，等待队长出发。");
    });
  }

  function decline() {
    if (!group) return;
    void act("decline", async () => {
      const data = await api.declineQueue(group.id);
      groupQ.setData(data.group);
      setNotice("已拒绝本次组队邀请，仍在队伍中。");
    });
  }

  function changeDungeon(nextId: string) {
    const next = content.dungeons.find((row) => row.id === nextId);
    setRouteDirty(true);
    setDungeonId(nextId);
    if (!next) {
      setRoomPath([]);
      return;
    }
    const remembered = preferences[next.id] as string[] | undefined;
    setRoomPath(
      remembered && isPathValid(next, remembered) ? remembered : defaultPathFor(next),
    );
  }

  function changePath(next: string[]) {
    setRouteDirty(true);
    setRoomPath(next);
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={`邀请码 ${group.joinCode}`}
        title={group.name}
        description={`${group.members.length} 名玩家 · ${group.heroes.length}/4 名英雄 · 队长 ${group.members.find((member) => member.userId === group.leaderUserId)?.username ?? "?"}`}
        actions={
          <div className="header-actions">
            <Badge tone={group.status === "recruiting" ? "green" : group.status === "running" ? "gold" : "muted"}>
              {group.status === "recruiting" ? "招募中" : group.status === "running" ? "远征中" : "已完成"}
            </Badge>
            <Badge tone="muted">{GROUP_VISIBILITY_LABELS[group.visibility]}</Badge>
            {group.expeditionId && group.status === "running" ? (
              <Link
                to={`/expeditions/${group.expeditionId}`}
                className="btn btn-ghost btn-sm"
              >
                查看远征
              </Link>
            ) : group.expeditionId && group.status === "completed" ? (
              <Link
                to={`/expeditions/${group.expeditionId}`}
                className="btn btn-ghost btn-sm"
              >
                查看战报
              </Link>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={Map}
                onClick={() => setDungeonOpen(true)}
              >
                {isLeader ? "选择迷宫" : "查看迷宫"}
              </Button>
            )}
            <Link to="/chat?channel=group" className="btn btn-ghost btn-sm">
              队伍频道
            </Link>
            {group.status !== "running" ? (
              <Button
                variant="ghost"
                size="sm"
                icon={LogOut}
                loading={busy === "leave"}
                onClick={() =>
                  act("leave", async () => {
                    await api.leaveGroup(group.id);
                    await refreshAfterAction();
                    setNotice("已离开队伍。");
                  })
                }
              >
                离开
              </Button>
            ) : null}
            {isLeader && group.status !== "running" ? (
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                loading={busy === "disband"}
                onClick={() =>
                  act("disband", async () => {
                    await api.disbandGroup(group.id);
                    await refreshAfterAction();
                    setNotice("队伍已解散。");
                  })
                }
              >
                解散
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}

      {group.status === "recruiting" ? (
        <Card className="group-invite-card">
          <div className="group-invite-main">
            <span className="eyebrow">队伍邀请码</span>
            <strong className="group-invite-code">{group.joinCode}</strong>
            <span className="group-invite-hint">
              {group.visibility === "invite"
                ? "仅限邀请：队伍不会出现在招募列表，把邀请码发给同伴。"
                : "符合可见性条件的玩家可在“正在招募”列表加入；也可以直接使用邀请码。"}
            </span>
          </div>
          <Button variant="secondary" size="sm" icon={Copy} onClick={copyJoinCode}>
            复制邀请码
          </Button>
        </Card>
      ) : null}

      <div className="group-main">
          <Card>
            <div className="section-head compact">
              <h2>
                <Users size={17} /> 成员
              </h2>
              <span className="muted-text">队伍最多 4 名英雄</span>
            </div>
            <div className="group-member-list">
              {group.members.map((member) => (
                <div key={member.userId} className="group-member-row">
                  <span className="group-avatar">{member.username.slice(0, 1)}</span>
                  <div className="group-member-main">
                    <strong>
                      {member.username}
                      {member.role === "leader" ? <Crown size={13} className="inline-icon" /> : null}
                    </strong>
                    <span>已派 {member.heroCount} 名英雄</span>
                    {member.deadHeroes.length > 0 ? (
                      <span className="group-member-injury">
                        死亡：{member.deadHeroes.join("、")}
                      </span>
                    ) : null}
                  </div>
                  {group.status === "recruiting" && group.queue && member.role !== "leader" ? (
                    member.readyState === 1 ? (
                      <Badge tone="green">已准备</Badge>
                    ) : member.readyState === 2 ? (
                      <Badge tone="red">已拒绝</Badge>
                    ) : (
                      <Badge tone="muted">未响应</Badge>
                    )
                  ) : null}
                  {member.userId === user?.id ? <Badge tone="gold">你</Badge> : null}
                  {group.status === "recruiting" &&
                  group.leaderUserId === user?.id &&
                  member.role !== "leader" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => void act(`remove-member-${member.userId}`, async () => {
                        await api.removeGroupMember(group.id, member.userId);
                        await refreshAfterAction();
                        setNotice(`已移除「${member.username}」`);
                      })}
                    >
                      移除
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="section-head compact">
              <h2>
                <Sparkles size={17} /> 队伍英雄
              </h2>
              <span className="muted-text">{group.heroes.length}/4</span>
            </div>
            {group.heroes.length > 0 ? (
              <div className="group-hero-list">
                {group.heroes.map((hero) => {
                  const editable =
                    group.status === "recruiting" &&
                    (isLeader || hero.userId === user?.id);
                  const dead = Boolean(hero.diedAt);
                  return (
                    <div key={hero.heroId} className="group-hero-row">
                      <Sigil weaponType={hero.weaponType} color={hero.weaponColor ?? "#c9a227"} size="md" />
                      <div className="group-hero-main">
                        <strong>{hero.heroName}</strong>
                        <span>
                          {hero.weaponName} · 等级 {hero.level} · {hero.playerName}
                        </span>
                        {dead ? (
                          <span className="group-hero-injury">
                            <HeartPulse size={12} /> 已永久死亡
                          </span>
                        ) : null}
                      </div>
                      {hero.userId === user?.id ? (
                        <>
                          {Object.keys(hero.settings ?? {}).length > 0 ? (
                            <Badge tone="gold">临时</Badge>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={SlidersHorizontal}
                            disabled={group.status !== "recruiting"}
                            onClick={() => openConfig(hero)}
                            title="临时调整战前配置，出发前有效"
                          >
                            配置
                          </Button>
                        </>
                      ) : null}
                      {presetsFor(hero.heroId).length > 0 ? (
                        <select
                          className="group-hero-preset"
                          value={presetChoice[hero.heroId] ?? hero.presetId ?? ""}
                          disabled={!editable}
                          onChange={(event) => {
                            const preset = presetsFor(hero.heroId).find(
                              (row) => row.id === event.target.value,
                            );
                            if (!preset) return;
                            void act(`preset-${hero.heroId}`, async () => {
                              if (hero.userId === user?.id) {
                                await api.setGroupHeroSettings(
                                  group.id,
                                  hero.heroId,
                                  {},
                                );
                              }
                              const data = await api.setGroupPosition(
                                group.id,
                                hero.heroId,
                                preset.position,
                                preset.id,
                              );
                              groupQ.setData(data.group);
                              setPresetChoice((current) => ({
                                ...current,
                                [hero.heroId]: preset.id,
                              }));
                            });
                          }}
                          aria-label={`${hero.heroName} 预设`}
                        >
                          <option value="">预设</option>
                          {presetsFor(hero.heroId).map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name}（{POSITION_LABEL[preset.position]}）
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <select
                        value={hero.position}
                        disabled={!editable}
                        onChange={(event) => {
                          setPresetChoice((current) => ({
                            ...current,
                            [hero.heroId]: "",
                          }));
                          act(`pos-${hero.heroId}`, async () => {
                            const data = await api.setGroupPosition(
                              group.id,
                              hero.heroId,
                              event.target.value as Position,
                            );
                            groupQ.setData(data.group);
                          });
                        }}
                        aria-label={`${hero.heroName} 站位`}
                      >
                        {(["front", "flank", "back"] as Position[]).map((position) => (
                          <option key={position} value={position}>
                            {POSITION_LABEL[position]}
                          </option>
                        ))}
                      </select>
                      {editable ? (
                        <button
                          className="icon-btn"
                          title="移除英雄"
                          disabled={busy === `remove-${hero.heroId}`}
                          onClick={() =>
                            act(`remove-${hero.heroId}`, async () => {
                              const data = await api.removeGroupHero(group.id, hero.heroId);
                              groupQ.setData(data.group);
                              await heroesQ.reload();
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted-text">暂无英雄。</p>
            )}
          </Card>

          {canAdd ? (
            <Card>
              <div className="section-head compact">
                <h2>
                  <UserPlus size={17} /> 加入我的英雄
                </h2>
                <span className="muted-text">
                  队伍 {group.heroes.length}/4 · 我的英雄 {myHeroes.length} 名
                </span>
              </div>
              {availableHeroes.length > 0 ? (
                <div className="group-add-list">
                  {availableHeroes.map((hero) => {
                    const dead = Boolean(hero.diedAt);
                    return (
                      <div key={hero.id} className="group-add-row">
                        <Sigil weaponType={hero.pathWeaponType} color={hero.weaponColor ?? "#c9a227"} size="sm" />
                        <div className="group-add-main">
                          <strong>{hero.name}</strong>
                          <span>
                            {hero.raceName} · {hero.weaponName} · 等级 {hero.level}
                          </span>
                          {dead ? (
                            <span className="group-hero-injury">
                              <HeartPulse size={12} /> 已永久死亡
                            </span>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={Plus}
                          loading={busy === `add-${hero.id}`}
                          disabled={!canAdd || dead}
                          onClick={() =>
                            act(`add-${hero.id}`, async () => {
                              const preset = defaultPresetFor(hero.id, viewedDungeonId);
                              const data = await api.addGroupHero(
                                group.id,
                                hero.id,
                                preset?.position ?? "front",
                              );
                              groupQ.setData(data.group);
                              await heroesQ.reload();
                            })
                          }
                        >
                          加入队伍
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted-text">暂无可加入英雄。</p>
              )}
            </Card>
          ) : null}

          <Card className="group-rules">
            <Shield size={18} />
            <div>
              <strong>组队规则</strong>
              <p>队伍最多 4 名英雄；远征期间不能离队或调整英雄。</p>
            </div>
          </Card>
      </div>

      <Modal
        open={dungeonOpen}
        onClose={() => setDungeonOpen(false)}
        title={isLeader && group.status === "recruiting" ? "选择迷宫" : "查看迷宫"}
        full
        footer={
          group.status === "recruiting" ? (
            <>
              <span className="modal-foot-info">
                {isLeader
                  ? queue
                    ? `已通知 ${queue.dungeonName} · 已准备 ${readyCount}/${otherMembers.length}`
                    : "选择路线后通知队友。"
                  : queue
                    ? `队长已选择 ${queue.dungeonName}。`
                    : "等待队长选择迷宫。"}
              </span>
              <div className="modal-actions">
                {isLeader ? (
                  <>
                    <Button
                      variant="secondary"
                      icon={Map}
                      disabled={
                        !selectedDepthEligible ||
                        !selectedDungeon ||
                        !isDungeonOpen(selectedDungeon) ||
                        busy === "queue"
                      }
                      loading={busy === "queue"}
                      onClick={notifyQueue}
                    >
                      {queue ? "重新通知队友" : "通知队友组队"}
                    </Button>
                    <Button
                      icon={Swords}
                      loading={busy === "start"}
                      disabled={!canStart}
                      onClick={() =>
                        act("start", async () => {
                          const data = await api.startGroupExpedition(group.id);
                          navigate(`/expeditions/${data.expeditionId}`);
                        })
                      }
                    >
                      出发
                    </Button>
                  </>
                ) : queue ? (
                  <Button
                    variant="secondary"
                    disabled={myReadyState === 1}
                    onClick={() => setReady()}
                  >
                    {myReadyState === 1
                      ? "已准备"
                      : `准备（${queue.dungeonName} · 第 ${queue.roomNames.length} 层）`}
                  </Button>
                ) : null}
              </div>
            </>
          ) : undefined
        }
      >
        <div className="group-dungeon-card">
          {group.status === "running" && group.expeditionId ? (
            <>
              <h3>队伍正在远征</h3>
              <Link
                to={`/expeditions/${group.expeditionId}`}
                className="btn btn-primary btn-md full-width"
              >
                查看远征
              </Link>
            </>
          ) : group.status === "completed" && group.expeditionId ? (
            <>
              <h3>远征已完成</h3>
              <Link
                to={`/expeditions/${group.expeditionId}`}
                className="btn btn-primary btn-md full-width"
              >
                查看战报
              </Link>
            </>
          ) : !isLeader && !queue ? (
            <div className="notice notice-info">队长还没有通知迷宫与路线。</div>
          ) : (
            <>
              {isLeader ? (
                <label className="field">
                  <span>迷宫</span>
                  <select
                    value={viewedDungeonId}
                    onChange={(event) => changeDungeon(event.target.value)}
                  >
                    {content.dungeons.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} · 怪物等级 {dungeonMonsterLevel(content, row)} ·{" "}
                        {row.rooms.length} 个房间
                        {row.kind === "appointment" ? " · 预约" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="field">
                  <span>队长选择的迷宫</span>
                  <strong>{queue?.dungeonName ?? selectedDungeon?.name ?? "?"}</strong>
                  <span className="muted-text">
                    {queue?.roomNames.join(" → ") ?? "暂无路线"}
                  </span>
                </label>
              )}
              {selectedDungeon ? (
                <>
                  <div className="group-dungeon-info">
                    <span>
                      <Map size={14} /> {orderedPathRooms.length} 站
                    </span>
                    <span>路线最高怪物 Lv{maxPathLevel}</span>
                    {groupHasSwift ? <span className="bonus-pos">熟路往返：额外通路</span> : null}
                    <span>{selectedDungeon.completionReward.ep} 经验点</span>
                    <span>
                      {selectedDungeon.completionReward.gold[0]}–
                      {selectedDungeon.completionReward.gold[1]} 金币
                    </span>
                    <span>{dungeonScheduleLabel(selectedDungeon)}</span>
                  </div>
                  <MazeMap
                    dungeon={activeDungeon ?? selectedDungeon}
                    path={viewedRoomPath}
                    onChange={changePath}
                    partyLevel={averageLevel}
                    readOnly={!isLeader}
                  />
                  <div className={cx("notice", pathFullClear ? "notice-success" : "notice-warn")}>
                    队伍平均等级 Lv{averageLevel} · 路线 {orderedPathRooms.length} 站
                    （终点 {orderedPathRooms[orderedPathRooms.length - 1]?.name ?? "?"}）。
                    {pathFullClear
                      ? " 全通可获得迷宫通关奖励。"
                      : " 提前收队保留已得掉落，但没有全通奖励。"}
                  </div>
                </>
              ) : null}
              {selectedDungeon && !isDungeonOpen(selectedDungeon) ? (
                <div className="notice notice-error">该预约迷宫当前未开放。</div>
              ) : null}
              {selectedDungeon && pathMonsterLevels.length > 0 && !selectedDepthEligible && group.heroes.length > 0 ? (
                <div className="notice notice-error">
                  当前队伍平均等级 Lv{averageLevel}，路线最高怪物 Lv{maxPathLevel}，
                  超出可挑战范围（最多可高于队伍平均等级 {DUNGEON_LEVEL_TOLERANCE}{" "}
                  级）。请换一条路线或提升英雄等级。
                </div>
              ) : null}
              {deathProblems.length > 0 ? (
                <div className="notice notice-error">
                  {deathProblems.map((hero) => hero.heroName).join("、")}{" "}
                  已永久死亡，无法参加迷宫：请由队长/本人将其移出队伍。
                </div>
              ) : null}
              {isLeader && queue ? (
                <div className="queue-banner">
                  <span className="queue-banner-text">
                    已通知 <strong>{queue.dungeonName}</strong> ·{" "}
                    {queue.roomNames.join(" → ")} — 已准备 {readyCount}/{otherMembers.length}
                  </span>
                  <Button size="sm" variant="ghost" onClick={cancelQueue}>
                    取消通知
                  </Button>
                </div>
              ) : null}
              {isLeader && !allMembersReady && queue ? (
                <div className="notice notice-info">
                  等待队员准备：{otherMembers.filter((m) => m.readyState !== 1).map((m) => m.username).join("、")}
                  {otherMembers.some((m) => m.readyState === 2) ? "（有人已拒绝，可重新通知）" : ""}
                </div>
              ) : null}
              <p className="muted-text group-start-note">全员准备后队长出发。</p>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(configHero)}
        onClose={() => setConfigHero(null)}
        title={configHero ? `${configHero.heroName} · 战前配置` : ""}
        wide
        footer={
          configHero ? (
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setConfigHero(null)}>
                取消
              </Button>
              <Button
                variant="ghost"
                loading={configBusy}
                onClick={() => void saveConfig(true)}
              >
                恢复预设
              </Button>
              <Button loading={configBusy} onClick={() => void saveConfig(false)}>
                保存本次配置
              </Button>
            </div>
          ) : null
        }
      >
        {configHero ? (
          <div className="preset-editor">
            <p className="preset-hint">
              这里的修改只对本次组队生效，出发时优先于预设；不会写回英雄预设。
            </p>
            <GeneralFields
              settings={configSettings}
              skills={configHeroSkills}
              onChange={setConfigSettings}
            />
            <section className="settings-section">
              <h3>层设置</h3>
              <div className="floor-tabs">
                {Array.from(
                  {
                    length: Math.min(
                      orderedPathRooms.length || 1,
                      MAX_FLOORS,
                    ),
                  },
                  (_, index) => index + 1,
                ).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      configFloor === value
                        ? "floor-tab floor-tab-active"
                        : "floor-tab"
                    }
                    onClick={() => setConfigFloor(value)}
                  >
                    第 {value} 层
                  </button>
                ))}
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
                      floors:
                        Object.keys(floorsMap).length > 0 ? floorsMap : undefined,
                    });
                  }}
                />
                <span>启用本层覆盖</span>
              </label>
              <FloorFields
                settings={configSettings}
                floor={configFloor}
                skills={configHeroSkills}
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
