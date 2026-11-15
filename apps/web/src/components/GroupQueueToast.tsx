import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, LogOut, Map, Users, X } from "lucide-react";
import type { GroupView } from "@wod/shared";
import { api, errorMessage } from "../api";
import { useAuth } from "../context";

/** 队长发起组队通知后，队员在任意页面右下角看到的提醒弹窗。 */
export function GroupQueueToast() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupView | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastQueueAt = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const poll = async () => {
      try {
        const data = await api.myGroup();
        if (!alive) return;
        setGroup(data.group);
        const createdAt = data.group?.queue?.createdAt ?? null;
        if (createdAt !== lastQueueAt.current) {
          lastQueueAt.current = createdAt;
          setDismissedAt(null);
          setError(null);
        }
      } catch {
        // 未登录或网络问题：静默忽略
      }
    };
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  if (!user || !group || group.queue == null) return null;
  const me = group.members.find((member) => member.userId === user.id);
  if (!me || me.role === "leader") return null;
  if (me.readyState !== 0) return null;
  if (dismissedAt === group.queue.createdAt) return null;

  const hasDead = me.deadHeroes.length > 0;
  const queue = group.queue;

  async function run(key: string, task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="queue-toast" role="alertdialog" aria-label="组队邀请">
      <div className="queue-toast-head">
        <Users size={15} />
        <strong>组队邀请</strong>
        <button
          type="button"
          className="queue-toast-close"
          aria-label="稍后处理"
          onClick={() => setDismissedAt(queue.createdAt)}
        >
          <X size={14} />
        </button>
      </div>
      <p className="queue-toast-body">
        <strong>{group.name}</strong> 的队长 <b>{group.leaderUserId === user.id ? "" : ""}</b>
        通知前往 <b>{queue.dungeonName}</b> · {queue.roomNames.join(" → ")}。
      </p>
      {hasDead ? (
        <p className="queue-toast-warn">
          你的英雄 {me.deadHeroes.join("、")} 已永久死亡，无法参加本次迷宫：请到队伍页移出该英雄后再准备。
        </p>
      ) : null}
      {error ? <p className="queue-toast-error">{error}</p> : null}
      <div className="queue-toast-actions">
        <button type="button" onClick={() => navigate("/groups")}>
          <Map size={13} /> 查看
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run("ready", async () => {
              const data = await api.setMemberReady(group.id);
              setGroup(data.group);
            })
          }
        >
          <Check size={13} /> 准备
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run("decline", async () => {
              const data = await api.declineQueue(group.id);
              setGroup(data.group);
            })
          }
        >
          <X size={13} /> 拒绝
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() =>
            void run("leave", async () => {
              await api.leaveGroup(group.id);
              setGroup(null);
            })
          }
        >
          <LogOut size={13} /> 离队
        </button>
      </div>
    </div>
  );
}
