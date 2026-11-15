import { useEffect, useRef } from "react";
import { useNow } from "../hooks";
import { Bar } from "./ui";

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function Countdown({
  startAt,
  endAt,
  onDone,
  compact = false,
}: {
  startAt: number;
  endAt: number;
  onDone?: () => void;
  compact?: boolean;
}) {
  const now = useNow(1000);
  const remaining = Math.max(0, endAt - now);
  const total = Math.max(1, endAt - startAt);
  const elapsed = Math.min(total, Math.max(0, now - startAt));
  const fired = useRef(false);

  useEffect(() => {
    if (remaining === 0 && !fired.current) {
      fired.current = true;
      onDone?.();
    }
  }, [remaining, onDone]);

  return (
    <div className={compact ? "countdown countdown-compact" : "countdown"}>
      <div className="countdown-label">
        {remaining > 0 ? "队伍仍在废墟深处" : "战斗记录正在送回"}
      </div>
      <div className="countdown-time">{remaining > 0 ? clock(remaining) : "完成"}</div>
      <Bar value={elapsed} max={total} tone="gold" />
      {!compact ? (
        <div className="countdown-foot">
          <span>已行进 {Math.round((elapsed / total) * 100)}%</span>
          <span>{new Date(endAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 返回</span>
        </div>
      ) : null}
    </div>
  );
}
