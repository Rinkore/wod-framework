/** 重伤恢复与治疗费用的展示辅助。 */

export function remainingInjuryMs(until: number | null | undefined, now = Date.now()): number {
  return until ? Math.max(0, until - now) : 0;
}

/** 格式化为 m:ss，用于倒计时展示。 */
export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 与服务端 healHero 一致的立即治疗费用。 */
export function healCost(level: number): number {
  return 20 + level * 5;
}
