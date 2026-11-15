import { useEffect, useMemo, useState } from "react";
import { Award, Clock, Coins, Crown, Save, Swords, Trophy, Users } from "lucide-react";
import {
  formatDuration,
  POSITION_LABELS,
  type ArenaOpponentView,
  type ArenaTeamBattleResultView,
  type ArenaTeamMemberView,
  type Position,
} from "@wod/shared";
import { api, errorMessage } from "../api";
import { useAuth } from "../context";
import { useApi, useNow } from "../hooks";
import { BattleReport } from "../report/BattleReport";
import { buildReport } from "../report/model";
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, Sigil, Spinner } from "../components/ui";

const POSITIONS: Position[] = ["front", "flank", "back", "back"];
const POSITION_OPTIONS: Position[] = ["front", "flank", "back"];

function teamName(team: { playerName: string }): string {
  return `${team.playerName} 的战队`;
}

function MemberStrip({ members, enemy = false }: { members: ArenaTeamMemberView[]; enemy?: boolean }) {
  return (
    <div className="arena-team-members">
      {members.map((member) => (
        <div key={member.heroId} className="arena-team-member">
          <Sigil weaponType={member.weaponType} color={member.weaponColor} size="sm" />
          <div>
            <strong>{member.heroName}</strong>
            <span>
              {POSITION_LABELS[member.position]} · Lv.{member.level} · {member.power.toLocaleString("zh-CN")}
            </span>
          </div>
          {enemy ? <Badge tone="red">敌</Badge> : null}
        </div>
      ))}
    </div>
  );
}

function ResultTeam({ team, enemy = false }: { team: ArenaTeamBattleResultView["attacker"]; enemy?: boolean }) {
  return (
    <div className="arena-result-team">
      <div className="arena-result-team-head">
        <strong>{teamName(team)}</strong>
        <span>{enemy ? "对手战队" : "我的战队"}</span>
      </div>
      <MemberStrip members={team.members} enemy={enemy} />
    </div>
  );
}

export function ColosseumPage() {
  const { user, refreshUser } = useAuth();
  const heroesQ = useApi(() => api.heroes().then((data) => data.heroes), []);
  const teamQ = useApi(() => api.arenaTeam().then((data) => data.team), []);
  const opponentsQ = useApi(() => api.arenaTeamOpponents().then((data) => data.opponents), []);
  const historyQ = useApi(() => api.arenaTeamHistory().then((data) => data.battles), []);
  const leaderboardQ = useApi(() => api.arenaTeamLeaderboard().then((data) => data.entries), []);
  const seasonQ = useApi(() => api.arenaTeamSeason(), [], 30000);
  const now = useNow(1000);

  const [selectedIds, setSelectedIds] = useState<string[]>(["", "", "", ""]);
  const [positions, setPositions] = useState<Position[]>(POSITIONS);
  const [result, setResult] = useState<ArenaTeamBattleResultView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const heroes = heroesQ.data ?? [];
  const available = heroes.filter((hero) => !hero.busyExpeditionId && !hero.diedAt);
  const team = teamQ.data;
  const opponents = opponentsQ.data ?? [];
  const history = historyQ.data ?? [];
  const leaderboard = leaderboardQ.data ?? [];
  const season = seasonQ.data?.season;
  const seasonBoard = seasonQ.data?.leaderboard ?? [];
  const myBest = seasonQ.data?.myBest ?? null;
  const seasonRewards = seasonQ.data?.rewards ?? [];

  useEffect(() => {
    if (teamQ.loading || available.length === 0 || selectedIds.some(Boolean)) return;
    const saved = team?.members.filter((member) => available.some((hero) => hero.id === member.heroId)) ?? [];
    const members = saved.length > 0 ? saved : available.slice(0, 4).map((hero, index) => ({ heroId: hero.id, position: POSITIONS[index] ?? "back" }));
    setSelectedIds(Array.from({ length: 4 }, (_, index) => members[index]?.heroId ?? ""));
    setPositions(Array.from({ length: 4 }, (_, index) => members[index]?.position ?? POSITIONS[index] ?? "back"));
  }, [available.length, selectedIds, team, teamQ.loading]);

  const selectedHeroes = selectedIds.map((id) => available.find((hero) => hero.id === id) ?? null);
  const teamReady = selectedHeroes.every(Boolean) && new Set(selectedIds).size === 4;
  const draftPower = selectedHeroes.reduce((sum, hero) => sum + (hero?.power ?? 0), 0);

  async function saveTeam() {
    if (!teamReady) return;
    setSaveBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.saveArenaTeam({
        members: selectedIds.map((heroId, index) => ({ heroId, position: positions[index] ?? "back" })),
      });
      await Promise.all([teamQ.reload(), opponentsQ.reload(), leaderboardQ.reload(), seasonQ.reload()]);
      setNotice("竞技场战队已保存。");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaveBusy(false);
    }
  }

  async function challenge(opponent: ArenaOpponentView) {
    if (!team || !opponent.challenge.allowed) return;
    setBusy(opponent.id);
    setError(null);
    setNotice(null);
    try {
      const data = await api.challengeArenaTeam(opponent.id);
      setResult(data.battle);
      await Promise.all([teamQ.reload(), opponentsQ.reload(), historyQ.reload(), leaderboardQ.reload(), seasonQ.reload(), refreshUser()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function claimSeason() {
    setClaimBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.claimArenaTeamSeasonRewards();
      await Promise.all([seasonQ.reload(), teamQ.reload(), refreshUser()]);
      setNotice(data.claimed.length > 0 ? `领取了 ${data.claimed.length} 份战队赛季奖励。` : "当前没有可领取的赛季奖励。");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClaimBusy(false);
    }
  }

  const displayResult = useMemo(() => {
    if (!result) return null;
    const viewerIsAttacker = result.attacker.playerName === user?.username;
    return {
      attacker: viewerIsAttacker ? result.attacker : result.defender,
      defender: viewerIsAttacker ? result.defender : result.attacker,
      outcome: viewerIsAttacker ? result.outcome : result.outcome === "victory" ? "defeat" : "victory",
      ratingChange: viewerIsAttacker ? result.ratingChanges.attacker : result.ratingChanges.defender,
    } as const;
  }, [result, user?.username]);

  const resultFloors = useMemo(() => {
    if (!result || !displayResult) return [];
    const members = [...displayResult.attacker.members, ...displayResult.defender.members];
    return buildReport({
      encounters: [{
        name: `${teamName(displayResult.attacker)} 对 ${teamName(displayResult.defender)}`,
        rounds: result.rounds,
        victory: displayResult.outcome === "victory",
        timeout: false,
        log: result.log,
        combatants: result.combatants,
        energyRegen: result.energyRegen,
        damageDealt: result.damageDealt ?? 0,
        damageTaken: result.damageTaken ?? 0,
      }],
      heroes: members.map((member) => ({
        id: member.heroId,
        name: member.heroName,
        level: member.level,
        weaponType: member.weaponType,
        weaponName: member.weaponName,
        weaponColor: member.weaponColor,
      })),
      sideOverrides: Object.fromEntries([
        ...displayResult.attacker.members.map((member) => [member.heroId, "hero"] as const),
        ...displayResult.defender.members.map((member) => [member.heroId, "enemy"] as const),
      ]),
    });
  }, [result, displayResult]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="竞技场 · 战队赛"
        title="四人竞技场"
        description="编成一支固定战队，以阵位和战力挑战其他拾荒者。"
        actions={<Badge tone="gold">4v4 异步战斗</Badge>}
      />
      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}

      {season ? (
        <Card className="season-card">
          <div className="section-head compact">
            <h2><Award size={17} /> {season.name}</h2>
            <span className="muted-text"><Clock size={12} /> 剩余 {formatDuration((season.endAt - now) / 1000)}</span>
          </div>
          <div className="season-grid">
            <div className="season-my">
              <span className="eyebrow">我的赛季战队</span>
              {myBest ? <><strong>#{myBest.rank} · {myBest.playerName}</strong><span>{myBest.rating} 分 · {myBest.wins}胜 {myBest.losses}负</span></> : <span className="muted-text">本赛季尚未参赛</span>}
            </div>
            <div className="season-board">
              {seasonBoard.slice(0, 5).map((entry) => <div key={entry.teamId} className="season-board-row"><span className="arena-rank">{entry.rank}</span><strong>{entry.playerName}</strong><span>{entry.memberNames.join("、")}</span><span className="text-gold">{entry.rating}</span></div>)}
              {seasonBoard.length === 0 ? <p className="muted-text">本赛季还没有战队战绩。</p> : null}
            </div>
          </div>
          {seasonRewards.length > 0 ? <div className="season-rewards"><div className="section-head compact"><h2>待领取战队奖励</h2><Button size="sm" icon={Coins} loading={claimBusy} onClick={() => void claimSeason()}>全部领取</Button></div>{seasonRewards.map((reward) => <div key={`${reward.seasonId}-${reward.teamId}`} className="season-reward-row"><span>{reward.seasonName} · 第 {reward.placement} 名</span><span><Coins size={12} /> {reward.gold} 金币 · {reward.ep} EP · {reward.fame} 声望</span></div>)}</div> : null}
        </Card>
      ) : null}

      {result ? <Card className="duel-result-card duel-result-full arena-battle-result">
        <div className="arena-result-vs"><ResultTeam team={displayResult?.attacker ?? result.attacker} /><span className="duel-vs">VS</span><ResultTeam team={displayResult?.defender ?? result.defender} enemy /></div>
        <div className="duel-result-meta"><Badge tone={displayResult?.outcome === "victory" ? "green" : "red"}>{displayResult?.outcome === "victory" ? "战斗胜利" : "战斗失败"}</Badge><span>{result.rounds} 回合</span><span>积分 {(displayResult?.ratingChange ?? 0) >= 0 ? "+" : ""}{displayResult?.ratingChange ?? 0}</span></div>
        <BattleReport floors={resultFloors} meta={{ dungeonName: "竞技场 · 4v4 战报", startAt: result.createdAt }} />
      </Card> : null}

      <div className="colosseum-layout">
        <div className="colosseum-main">
          <Card className="arena-team-builder">
            <div className="section-head compact"><h2><Users size={17} /> 编成我的战队</h2><span className="muted-text">战力 {draftPower.toLocaleString("zh-CN")}</span></div>
            <div className="arena-slots">
              {selectedIds.map((selectedId, index) => {
                const hero = selectedHeroes[index];
                return <div key={index} className="arena-slot">
                  <div className="arena-slot-label">位置 {index + 1} · {POSITION_LABELS[positions[index] ?? "back"]}</div>
                  <select value={selectedId} onChange={(event) => setSelectedIds((current) => current.map((id, slot) => slot === index ? event.target.value : id))}>
                    <option value="">选择英雄</option>
                    {available.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={selectedIds.some((id, slot) => slot !== index && id === candidate.id)}>{candidate.name} · Lv.{candidate.level} · {candidate.power.toLocaleString("zh-CN")}</option>)}
                  </select>
                  {hero ? <span className="arena-slot-stats">{hero.weaponName} · {hero.maxHp} HP · {hero.armor} 护甲</span> : <span className="arena-slot-stats muted-text">尚未选择</span>}
                  <select value={positions[index] ?? "back"} onChange={(event) => setPositions((current) => current.map((position, slot) => slot === index ? event.target.value as Position : position))}>{POSITION_OPTIONS.map((position) => <option key={position} value={position}>{POSITION_LABELS[position]}</option>)}</select>
                </div>;
              })}
            </div>
            <div className="arena-builder-foot"><span className="muted-text">需要 4 名不同且未出征、未阵亡的英雄</span><Button icon={Save} loading={saveBusy} disabled={!teamReady} onClick={() => void saveTeam()}>保存战队</Button></div>
          </Card>

          <section>
            <div className="section-head"><h2><Trophy size={18} /> 可挑战的对手</h2><span className="muted-text">{opponents.length} 支战队</span></div>
            {opponentsQ.loading && opponents.length === 0 ? <Spinner label="正在收集对手…" /> : null}
            {opponents.length > 0 ? <div className="arena-opponent-grid">{opponents.map((opponent) => <Card key={opponent.id} className="arena-opponent-card"><div className="arena-opponent-head"><div><strong>{teamName(opponent)}</strong><span>{opponent.members.map((member) => member.heroName).join("、")}</span></div><Badge tone="purple">{opponent.power.toLocaleString("zh-CN")} 战力</Badge></div><MemberStrip members={opponent.members} enemy /><div className="arena-challenge-foot"><span className="muted-text">今日 {opponent.challenge.dailyUsed}/{opponent.challenge.dailyLimit} · 防守倍率 {Math.round(opponent.challenge.defenderMultiplier * 100)}%</span><Button size="sm" variant="secondary" icon={Swords} loading={busy === opponent.id} disabled={!team || !opponent.challenge.allowed} onClick={() => void challenge(opponent)}>{opponent.challenge.allowed ? "挑战" : opponent.challenge.reason ?? "暂不可挑战"}</Button></div></Card>)}</div> : (!opponentsQ.loading ? <EmptyState icon={Trophy} title="暂无可挑战的战队" text="先保存战队，或等待更多拾荒者加入竞技场。" /> : null)}
          </section>
        </div>

        <aside className="colosseum-side">
          <Card><div className="section-head compact"><h2><Crown size={17} /> 我的战队战绩</h2><span className="muted-text">{team ? `${team.rating} 分` : "未保存"}</span></div>{team ? <><MemberStrip members={team.members} /><div className="arena-record-line">{team.wins} 胜 · {team.losses} 负 · {team.power.toLocaleString("zh-CN")} 战力</div></> : <p className="muted-text">保存战队后即可参加 4v4 挑战。</p>}</Card>
          <Card><div className="section-head compact"><h2><Clock size={17} /> 最近战斗</h2><span className="muted-text">{history.length} 场</span></div>{history.length > 0 ? <div className="duel-history">{history.map((battle) => { const viewerAttacker = battle.attacker.playerName === user?.username; const victory = viewerAttacker ? battle.outcome === "victory" : battle.outcome === "defeat"; const opponent = viewerAttacker ? battle.defender : battle.attacker; return <button key={battle.id} className={`duel-history-row ${victory ? "duel-win" : "duel-loss"}`} onClick={() => setResult(battle)}><span className={`recent-dot ${victory ? "dot-green" : "dot-red"}`} /><div><strong>对 {teamName(opponent)}</strong><span>{victory ? "胜利" : "失败"} · {battle.rounds} 回合 · {new Date(battle.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div><Badge tone={victory ? "green" : "red"}>{victory ? "胜" : "负"}</Badge></button>; })}</div> : <p className="muted-text">还没有战斗记录。</p>}</Card>
          <Card><div className="section-head compact"><h2><Trophy size={17} /> 战队排行榜</h2><span className="muted-text">积分</span></div>{leaderboard.length > 0 ? <div className="arena-list">{leaderboard.slice(0, 10).map((entry) => <div key={entry.teamId} className="arena-row"><span className="arena-rank">{entry.rank}</span><div className="arena-main"><strong>{entry.playerName}</strong><span>{entry.memberNames.join("、")}</span></div><div className="arena-score"><strong>{entry.rating}</strong><span>{entry.wins}胜 {entry.losses}负</span></div></div>)}</div> : <p className="muted-text">还没有战队完成挑战。</p>}</Card>
        </aside>
      </div>
    </div>
  );
}
