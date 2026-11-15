import { RefreshCw, Trophy } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../context";
import { useApi } from "../hooks";
import { Badge, Button, ErrorNotice, PageHeader, Sigil, Spinner, cx } from "../components/ui";

export function RankingsPage() {
  const { user } = useAuth();
  const leaderboardQ = useApi(() => api.leaderboard().then((data) => data.entries), [], 30_000);
  const entries = leaderboardQ.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="世界排行"
        title="英雄榜"
        actions={
          <Button
            variant="ghost"
            icon={RefreshCw}
            loading={leaderboardQ.loading}
            onClick={() => void leaderboardQ.reload()}
          >
            刷新
          </Button>
        }
      />

      {leaderboardQ.error ? <ErrorNotice message={leaderboardQ.error} /> : null}
      {leaderboardQ.loading && entries.length === 0 ? <Spinner label="正在统计…" /> : null}

      {entries.length > 0 ? (
        <div className="rank-table card">
          <div className="rank-row rank-head">
            <span>名次</span>
            <span>英雄</span>
            <span>指挥官</span>
            <span>等级</span>
            <span>经验点</span>
          </div>
          {entries.map((entry) => {
            const mine = entry.playerName === user?.username;
            return (
              <div
                key={entry.heroId}
                className={cx(
                  "rank-row",
                  entry.rank <= 3 && `rank-top rank-top-${entry.rank}`,
                  mine && "rank-mine",
                )}
              >
                <span className="rank-number">
                  {entry.rank === 1 ? "Ⅰ" : entry.rank === 2 ? "Ⅱ" : entry.rank === 3 ? "Ⅲ" : entry.rank}
                </span>
                <span className="rank-hero">
                  <Sigil weaponType={entry.weaponType} color={entry.weaponColor} size="sm" />
                  <span>
                    <strong>{entry.heroName}</strong>
                    <small>{entry.weaponName}</small>
                  </span>
                </span>
                <span className="rank-player">
                  {entry.playerName}
                  {mine ? <Badge tone="gold">你</Badge> : null}
                </span>
                <span className="rank-level">等级 {entry.level}</span>
                <span className="rank-xp">{entry.epEarned.toLocaleString("zh-CN")}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {!leaderboardQ.loading && entries.length === 0 ? (
        <div className="empty-state">
          <Trophy size={30} />
          <strong>榜单还是空的</strong>
          <p>等第一支远征队回来，这里就会有名字。</p>
        </div>
      ) : null}

      <p className="muted-text rank-footnote">
        排行榜每 30 秒自动刷新，共收录前 50 名英雄。
      </p>
    </div>
  );
}
