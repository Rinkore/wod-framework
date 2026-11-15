import { useState } from "react";
import {
  Award,
  Check,
  Coins,
  Lock,
  ScrollText,
  Sparkles,
} from "lucide-react";
import type { QuestView } from "@wod/shared";
import { api, errorMessage } from "../api";
import { useAuth, useContent } from "../context";
import { useApi } from "../hooks";
import {
  Badge,
  Bar,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Gold,
  PageHeader,
  Spinner,
} from "../components/ui";

const STATUS_LABEL: Record<QuestView["status"], string> = {
  locked: "未解锁",
  active: "进行中",
  completed: "可领取",
  claimed: "已完成",
};

const STATUS_TONE: Record<
  QuestView["status"],
  "muted" | "gold" | "green" | "red"
> = {
  locked: "muted",
  active: "gold",
  completed: "green",
  claimed: "muted",
};

export function QuestsPage() {
  const content = useContent();
  const { refreshUser } = useAuth();
  const questsQ = useApi(() => api.quests().then((data) => data.quests), []);
  const [filter, setFilter] = useState<"all" | QuestView["status"]>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const quests = questsQ.data ?? [];

  const counts = {
    all: quests.length,
    active: quests.filter((quest) => quest.status === "active").length,
    completed: quests.filter((quest) => quest.status === "completed").length,
    claimed: quests.filter((quest) => quest.status === "claimed").length,
    locked: quests.filter((quest) => quest.status === "locked").length,
  };
  const visible = quests.filter((quest) =>
    filter === "all" ? true : quest.status === filter,
  );

  function objectiveLabel(quest: QuestView, index: number): string {
    const objective = quest.objectives[index]!;
    switch (objective.type) {
      case "complete-dungeon": {
        const dungeon = content.dungeons.find(
          (row) => row.id === objective.targetId,
        );
        return `通关「${dungeon?.name ?? objective.targetId}」`;
      }
      case "win-expedition":
        return "赢得远征";
      case "defeat-monsters":
        return "击败怪物";
      case "win-duel":
        return "赢得决斗";
      case "earn-fame":
        return "获得声望";
      default:
        return objective.type;
    }
  }

  async function claim(quest: QuestView) {
    setBusy(quest.id);
    setError(null);
    setNotice(null);
    try {
      const data = await api.claimQuest(quest.id);
      questsQ.setData(
        quests.map((row) => (row.id === quest.id ? data.quest : row)),
      );
      await refreshUser();
      setNotice(
        `已领取「${quest.name}」奖励：${data.hero.name} 获得 ${quest.rewards.ep} EP、${quest.rewards.fame} 声望。`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="行会委托"
        title="任务"
        actions={
          <Badge tone="gold">
            <Award size={13} /> {counts.completed} 项可领取
          </Badge>
        }
      />

      {questsQ.error ? <ErrorNotice message={questsQ.error} /> : null}
      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}
      {questsQ.loading && quests.length === 0 ? (
        <Spinner label="正在读取委托…" />
      ) : null}

      <div className="filter-tabs">
        {(
          [
            ["all", `全部 ${counts.all}`],
            ["active", `进行中 ${counts.active}`],
            ["completed", `可领取 ${counts.completed}`],
            ["claimed", `已完成 ${counts.claimed}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "filter-tab filter-tab-active" : "filter-tab"}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="这一栏没有委托"
          text="换一个筛选，或者先去迷宫里制造一些进度。"
        />
      ) : (
        <div className="quest-list">
          {visible.map((quest) => {
            const lockedBy = quest.prerequisiteQuestIds
              .map((id) => quests.find((row) => row.id === id))
              .filter((row): row is QuestView => Boolean(row));
            const title = quest.rewards.titleId
              ? content.titles.find((row) => row.id === quest.rewards.titleId)
              : undefined;
            return (
              <Card key={quest.id} className="quest-card">
                <div className="quest-head">
                  <div>
                    <div className="eyebrow">
                      {quest.category === "main" ? "主线" : "支线"}
                    </div>
                    <h2>
                      {quest.status === "locked" ? <Lock size={15} /> : null}
                      {quest.name}
                    </h2>
                  </div>
                  <Badge tone={STATUS_TONE[quest.status]}>
                    {STATUS_LABEL[quest.status]}
                  </Badge>
                </div>
                <p className="quest-desc">{quest.description}</p>

                <div className="quest-objectives">
                  {quest.objectives.map((objective, index) => (
                    <div key={`${quest.id}-${index}`} className="quest-objective">
                      <div className="quest-objective-head">
                        <span>{objectiveLabel(quest, index)}</span>
                        <strong>
                          {Math.min(objective.current, objective.count)}/
                          {objective.count}
                        </strong>
                      </div>
                      <Bar
                        value={Math.min(objective.current, objective.count)}
                        max={objective.count}
                      />
                    </div>
                  ))}
                </div>

                {quest.status === "locked" && lockedBy.length > 0 ? (
                  <p className="muted-text">
                    需要先完成：{lockedBy.map((row) => row.name).join("、")}
                  </p>
                ) : null}

                <div className="quest-foot">
                  <div className="quest-rewards">
                    {quest.rewards.gold > 0 ? (
                      <span>
                        <Coins size={13} /> <Gold amount={quest.rewards.gold} />
                      </span>
                    ) : null}
                    {quest.rewards.ep > 0 ? (
                      <span>
                        <Sparkles size={13} /> {quest.rewards.ep} EP
                      </span>
                    ) : null}
                    {quest.rewards.fame > 0 ? (
                      <span>
                        <Award size={13} /> {quest.rewards.fame} 声望
                      </span>
                    ) : null}
                    {title ? (
                      <Badge tone="gold">{title.name}</Badge>
                    ) : null}
                  </div>
                  {quest.status === "completed" ? (
                    <Button
                      icon={Check}
                      loading={busy === quest.id}
                      onClick={() => void claim(quest)}
                    >
                      领取奖励
                    </Button>
                  ) : null}
                </div>
                {quest.status === "completed" ? (
                  <p className="muted-text">
                    奖励默认发放给等级最高的英雄。
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
