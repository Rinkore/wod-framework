import { useState } from "react";
import { Award, Sparkles } from "lucide-react";
import { api, errorMessage } from "../api";
import { useContent } from "../context";
import { useApi } from "../hooks";
import { Badge, Bar, Button, Card, ErrorNotice, Spinner } from "./ui";

export function HeroTitlesCard({
  heroId,
  onChanged,
}: {
  heroId: string;
  onChanged?: () => void;
}) {
  const content = useContent();
  const titlesQ = useApi(
    () => api.heroTitles(heroId),
    [heroId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = titlesQ.data;
  const titles = data?.titles ?? [];
  const fame = data?.fame ?? 0;
  const next = [...content.titles]
    .filter((title) => title.fameThreshold > fame && title.fameThreshold < 9999)
    .sort((a, b) => a.fameThreshold - b.fameThreshold)[0];

  async function select(titleId: string | null) {
    setBusy(titleId ?? "clear");
    setError(null);
    try {
      await api.setHeroTitle(heroId, titleId);
      await titlesQ.reload();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="hero-titles-card">
      <div className="section-head compact">
        <h2>
          <Award size={18} /> 声望与称号
        </h2>
        <Badge tone="gold">{fame} 声望</Badge>
      </div>
      {titlesQ.loading && !data ? <Spinner label="正在读取称号…" /> : null}
      {error ? <ErrorNotice message={error} /> : null}
      {next ? (
        <div className="fame-progress">
          <div className="quest-objective-head">
            <span>下一个称号：{next.name}</span>
            <strong>
              {fame}/{next.fameThreshold}
            </strong>
          </div>
          <Bar value={fame} max={next.fameThreshold} />
        </div>
      ) : (
        <p className="muted-text">暂无新称号。</p>
      )}

      {titles.length > 0 ? (
        <div className="title-list">
          {titles.map((title) => {
            const active = data?.activeTitleId === title.id;
            return (
              <div
                key={title.id}
                className={active ? "title-row title-row-active" : "title-row"}
              >
                <div className="title-main">
                  <strong style={{ color: title.color }}>{title.name}</strong>
                  <span>{title.description}</span>
                  <small>
                    {title.source === "quest"
                      ? "任务奖励"
                      : `声望 ${title.fameThreshold}`}
                  </small>
                </div>
                <Button
                  size="sm"
                  variant={active ? "ghost" : "secondary"}
                  loading={busy === title.id || (active && busy === "clear")}
                  onClick={() => void select(active ? null : title.id)}
                >
                  {active ? "取消展示" : "展示"}
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
