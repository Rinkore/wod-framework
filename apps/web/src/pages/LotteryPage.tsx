import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, Coins, RefreshCw, Ticket, Timer } from "lucide-react";
import {
  LOTTERY_DRAW_COUNT,
  LOTTERY_NUMBER_MAX,
  type HeroView,
  type LotteryStateView,
} from "@wod/shared";
import { api, errorMessage } from "../api";
import { useApi, useNow } from "../hooks";
import { useAuth } from "../context";
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, Spinner, cx } from "../components/ui";

const PRIZE_ROWS = [
  { hits: 0, probability: "24.05332", shards: 1, manuals: 0, title: "—" },
  { hits: 1, probability: "43.29597", shards: 1, manuals: 0, title: "—" },
  { hits: 2, probability: "25.77141", shards: 3, manuals: 0, title: "—" },
  { hits: 3, probability: "6.24761", shards: 10, manuals: 0, title: "—" },
  { hits: 4, probability: "0.61118", shards: 40, manuals: 1, title: "—" },
  { hits: 5, probability: "0.02037", shards: 200, manuals: 3, title: "拾光者（重复 +40 碎片）" },
  { hits: 6, probability: "0.00014", shards: 1000, manuals: 3, title: "雨幕见证者（重复 +200 碎片）" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function manualUnavailable(hero: HeroView): string | null {
  if (hero.diedAt != null) return "已死亡";
  if (hero.busyExpeditionId) return "正在远征";
  if (hero.epEarned > 5000) return "累计 EP 超过 5000";
  return null;
}

function DrawCountdown({ endAt }: { endAt: number }) {
  const now = useNow();
  const seconds = Math.max(0, Math.ceil((endAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return (
    <div className="lottery-countdown" role="timer" aria-label="距离本期开奖">
      <Timer size={15} aria-hidden />
      {seconds > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)} 后开奖` : "本期已截止，正在刷新开奖结果…"}
    </div>
  );
}

export function LotteryPage() {
  const { user, refreshUser } = useAuth();
  const heroesQ = useApi(() => api.heroes(), []);
  const [state, setState] = useState<LotteryStateView | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [countInput, setCountInput] = useState("1");
  const [heroId, setHeroId] = useState("");
  const requestVersion = useRef(0);
  const actionInFlight = useRef(false);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const next = await api.lottery(page);
      if (version !== requestVersion.current) return;
      setState(next);
      setPageInput(String(next.page));
      setLoadError(null);
    } catch (err) {
      if (version === requestVersion.current) setLoadError(errorMessage(err));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  // Refresh on return to the page, including after a suspended background tab.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden" && !actionInFlight.current) {
        void load();
        void heroesQ.reload();
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, heroesQ.reload]);

  const endAt = state?.currentPeriod.endAt;
  useEffect(() => {
    if (endAt == null) return;
    const refreshAfterDraw = () => {
      if (Date.now() >= endAt && !actionInFlight.current) void load();
    };
    refreshAfterDraw();
    const timer = window.setInterval(refreshAfterDraw, 5000);
    return () => window.clearInterval(timer);
  }, [endAt, load]);

  const count = Number(countInput);
  const maxBatch = Math.min(10000, state?.stockCount ?? 0);
  const validCount = countInput.trim() !== "" && Number.isInteger(count) && count >= 1 && count <= maxBatch;
  const selectedHero = heroesQ.data?.heroes.find((hero) => hero.id === heroId);
  const heroReason = selectedHero ? manualUnavailable(selectedHero) : null;
  const totalPages = state ? Math.max(1, Math.ceil(state.totalTickets / state.pageSize)) : 1;
  const locked = busy !== null || loading;

  async function run(key: string, task: () => Promise<string>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      setNotice(await task());
      const results = await Promise.allSettled([load(), heroesQ.reload(), refreshUser()]);
      if (results.some((result) => result.status === "rejected")) {
        setError("操作已成功，但部分账户信息刷新失败，请点击刷新核对最新状态。");
      }
    } catch (err) {
      setError(errorMessage(err));
      await Promise.allSettled([load(), heroesQ.reload()]);
    } finally {
      actionInFlight.current = false;
      setBusy(null);
    }
  }

  function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || locked || !validCount || Date.now() >= state.currentPeriod.endAt) return;
    void run("enter", async () => {
      const result = await api.enterLottery(count);
      return `已投入 ${result.entered} 张至第 ${result.periodNumber} 期，每张已生成 6 个随机号码，投入不可撤销。`;
    });
  }

  function jumpPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = Number(pageInput);
    if (!locked && Number.isInteger(target) && target >= 1 && target <= totalPages) {
      if (target === page) void load();
      else setPage(target);
    }
  }

  return (
    <div className="page page-fit lottery-page">
      <PageHeader
        eyebrow="荒原赌局 · 每日主动投入"
        title="雨蚀彩票"
        description="库存留给未来，投入参与今日。每日开奖，奖励自动到账。"
        actions={
          <Button variant="ghost" icon={RefreshCw} loading={loading} disabled={busy !== null}
            onClick={() => {
              void load();
              void heroesQ.reload();
            }}>
            刷新
          </Button>
        }
      />

      {error ? <div role="alert"><ErrorNotice message={error} /></div> : null}
      {loadError ? <div role="alert"><ErrorNotice message={`彩票信息刷新失败：${loadError}`} /></div> : null}
      {notice ? <div className="notice notice-success" role="status">{notice}</div> : null}
      {loading && !state ? <Spinner label="正在翻开奖箱…" /> : null}

      {state ? (
        <>
          <Card className="lottery-period-card" as="section">
            <div className="lottery-period-head">
              <div>
                <h2>第 {state.currentPeriod.number} 期 · 每日奖池</h2>
                <DrawCountdown endAt={state.currentPeriod.endAt} />
              </div>
              <Badge tone="gold">主动投入后参与</Badge>
            </div>
            <div className="lottery-copy muted-text">
              <p>服务器当地时间每日 00:00 截止并开奖，离线也会自动结算。</p>
              <p>本期截止 / 开奖对应你的本地时间：<time dateTime={new Date(state.currentPeriod.endAt).toISOString()}>
                {new Date(state.currentPeriod.endAt).toLocaleString("zh-CN", { hour12: false, timeZoneName: "long" })}
              </time>。</p>
              <p>服务器给定的开奖绝对时刻（UTC）：<time dateTime={new Date(state.currentPeriod.endAt).toISOString()}>
                {new Date(state.currentPeriod.endAt).toISOString()}
              </time>。以此时刻为准；服务器未提供时区名称。</p>
            </div>
            <dl className="lottery-summary" aria-label="奖券统计">
              <div><dt>库存奖券</dt><dd>{state.stockCount.toLocaleString("zh-CN")} 张</dd></div>
              <div><dt>本期已投入</dt><dd>{state.enteredCount.toLocaleString("zh-CN")} 张</dd></div>
              <div><dt>近 7 天获得</dt><dd>{state.weeklyTickets.toLocaleString("zh-CN")} 张</dd></div>
            </dl>
            <form className="lottery-entry-form" onSubmit={enter} aria-label="投入每日彩票">
              <label className="field" htmlFor="lottery-count">
                <span>投入张数</span>
                <input id="lottery-count" type="number" inputMode="numeric" min={1} max={Math.max(1, maxBatch)} step={1}
                  required value={countInput} disabled={locked || state.stockCount === 0}
                  aria-describedby="lottery-entry-help" aria-invalid={state.stockCount > 0 && !validCount}
                  onChange={(event) => setCountInput(event.target.value)} />
              </label>
              <Button type="button" variant="secondary" disabled={locked || maxBatch === 0}
                onClick={() => setCountInput(String(maxBatch))}>
                本批最多 {maxBatch.toLocaleString("zh-CN")} 张
              </Button>
              <Button type="submit" icon={Ticket} loading={busy === "enter"}
                disabled={locked || !validCount || Date.now() >= state.currentPeriod.endAt}>
                投入本期（不可撤销）
              </Button>
            </form>
            <p id="lottery-entry-help" className="muted-text">
              库存券没有号码，可跨日保留。每次投入 1–10000 张，可分批投入，本期投入总量不限。
              投入后每张生成 {LOTTERY_DRAW_COUNT} 个 00–{pad(LOTTERY_NUMBER_MAX)} 中不重复的随机号码，不可选号或撤回。
              {state.stockCount === 0 ? " 当前没有库存奖券，可在迷宫远征中获得。" : !validCount ? ` 请输入 1–${maxBatch} 的整数。` : ""}
            </p>
            {state.lastDrawn ? (
              <div className="lottery-last-draw">
                <h3>最近开奖 · 第 {state.lastDrawn.number} 期</h3>
                <div className="lottery-draw-numbers" aria-label={`第 ${state.lastDrawn.number} 期开奖号码`}>
                  {(state.lastDrawn.numbers ?? []).map((n) => <span key={n} className="lottery-ball">{pad(n)}</span>)}
                </div>
              </div>
            ) : <p className="muted-text lottery-foot-note">暂无每日开奖记录，首次开奖后在此公布号码。</p>}
          </Card>

          <Card className="lottery-rewards-card" as="section">
            <div className="section-head compact"><h2>奖档与概率</h2><Badge tone="green">每日奖励自动到账</Badge></div>
            <p className="muted-text">
              每张票与开奖号码都从 31 个数字中无放回抽取 6 个，只比数字、不分顺序。
              恰好命中 k 个的概率为 C(6,k) × C(25,6−k) ÷ C(31,6)，共有 736281 种等可能的六号组合。
              下表为每张票的命中概率（四舍五入），多投增加参与次数，不保证高奖档。
            </p>
            <div className="lottery-table-scroll" role="region" aria-label="每日奖档概率表" tabIndex={0}>
              <table className="lottery-prize-table">
                <caption>每日六号票 · 单张票的奖励和命中概率</caption>
                <thead><tr><th scope="col">命中数</th><th scope="col">概率</th><th scope="col">遗产碎片</th><th scope="col">训练手记</th><th scope="col">纪念称号收藏</th></tr></thead>
                <tbody>{PRIZE_ROWS.map((row) => (
                  <tr key={row.hits}><th scope="row">{row.hits} 个</th><td>{row.probability}%</td><td>{row.shards}</td><td>{row.manuals || "—"}</td><td>{row.title}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="muted-text">表中奖励按行一并发放；重复纪念称号额外折为碎片。每日票开奖后无需兑奖。</p>
          </Card>

          <Card className="lottery-rewards-card" as="section">
            <div className="section-head compact"><h2><BookOpen size={17} aria-hidden /> 遗产传承</h2></div>
            <div className="death-token-row">
              <Badge tone="gold">遗产碎片 ×{state.legacyShards}</Badge>
              <Badge tone="blue">训练手记 ×{state.manuals}</Badge>
              <Button variant="secondary" loading={busy === "exchange"} disabled={locked || state.legacyShards < 10}
                onClick={() => void run("exchange", async () => {
                  await api.exchangeLegacyManual();
                  return "已消耗 10 枚遗产碎片，兑换训练手记 ×1。";
                })}>
                10 碎片兑换 1 本手记
              </Button>
            </div>
            <p className="muted-text lottery-foot-note" id="lottery-manual-help">
              每本手记给予 250 可用训练 EP，不增加等级。仅累计 EP ≤5000、存活且未在远征中的英雄可用，每英雄最多使用 3 次。
              历史使用次数由服务器校验。
            </p>
            {heroesQ.error ? <div role="alert"><ErrorNotice message={`英雄列表加载失败：${heroesQ.error}`} /></div> : null}
            {heroesQ.loading && !heroesQ.data ? <Spinner label="正在读取英雄…" /> : null}
            <div className="lottery-entry-form">
              <label className="field" htmlFor="lottery-manual-hero">
                <span>使用手记的英雄</span>
                <select id="lottery-manual-hero" value={heroId} disabled={locked || !heroesQ.data || !!heroesQ.error}
                  aria-describedby="lottery-manual-help lottery-hero-detail"
                  onChange={(event) => setHeroId(event.target.value)}>
                  <option value="">请选择英雄</option>
                  {(heroesQ.data?.heroes ?? []).map((hero) => {
                    const reason = manualUnavailable(hero);
                    return <option key={hero.id} value={hero.id} disabled={reason !== null}>{hero.name} · 累计 EP {hero.epEarned}{reason ? ` · ${reason}` : ""}</option>;
                  })}
                </select>
              </label>
              <Button icon={BookOpen} loading={busy === "manual"}
                disabled={locked || !!heroesQ.error || state.manuals < 1 || !selectedHero || heroReason !== null}
                onClick={() => {
                  if (!selectedHero || manualUnavailable(selectedHero)) return;
                  void run("manual", async () => {
                    await api.useLegacyManual(selectedHero.id);
                    return `已为「${selectedHero.name}」消耗 1 本训练手记，增加 250 可用训练 EP。`;
                  });
                }}>
                使用 1 本手记（+250 训练 EP）
              </Button>
            </div>
            <p className="muted-text" id="lottery-hero-detail">
              {selectedHero ? `${selectedHero.name}：当前可用训练 EP ${selectedHero.ep}，累计 EP ${selectedHero.epEarned}。${heroReason ?? "符合基础条件，使用时将校验 3 次上限。"}`
                : heroesQ.data?.heroes.length === 0 ? "暂无英雄，请先创建英雄。" : "选择英雄后可查看当前 EP；不可用英雄会显示原因。"}
            </p>
            <div className="lottery-last-draw">
              <h3>纪念称号收藏</h3>
              <div className="death-token-row" aria-label="已收藏的纪念称号">
                {state.cosmetics.length > 0 ? state.cosmetics.map((title) => <Badge key={title} tone="purple">{title}</Badge>) : <span className="muted-text">暂无收藏，命中 5 或 6 个号码可获得对应纪念称号。</span>}
              </div>
            </div>
          </Card>

          <Card className="lottery-tokens-card lottery-rewards-card" as="section">
            <div className="section-head compact"><h2>历史复活券</h2></div>
            <div className="death-token-row">
              <Badge tone="gold">死亡赦免券 ×{state.deathTokens.find((t) => t.type === "pardon")?.count ?? 0}</Badge>
              <Badge tone="red">死亡赎回券 ×{state.deathTokens.find((t) => t.type === "redemption")?.count ?? 0}</Badge>
              <span className="muted-text">在英雄页的死亡名册中使用。历史奖券保留原兑奖规则。</span>
            </div>
          </Card>

          <section aria-labelledby="lottery-tickets-heading" aria-busy={loading}>
            <div className="section-head compact">
              <h2 id="lottery-tickets-heading"><Ticket size={17} aria-hidden /> 我的奖券</h2>
              <span className="muted-text">共 {state.totalTickets.toLocaleString("zh-CN")} 张 · 每页 {state.pageSize} 张</span>
            </div>
            {state.tickets.length === 0 ? (
              <EmptyState icon={Ticket} title="背包里还没有奖券" text="迷宫远征会掉落库存券；获得后在此主动投入，参与每日开奖。" />
            ) : (
              <div className="lottery-ticket-list">
                {state.tickets.slice(0, Math.min(30, state.pageSize)).map((ticket) => {
                  const settled = ticket.status === "drawn" || ticket.status === "redeemed";
                  const redeemable = ticket.legacy && ticket.status === "drawn";
                  const statusLabel = ticket.status === "stock" ? "库存 · 未投入"
                    : ticket.status === "entered" ? "已投入 · 待开奖"
                      : ticket.legacy ? ticket.status === "redeemed" ? "历史 · 已兑奖" : "历史 · 待兑奖"
                        : "已开奖 · 自动到账";
                  return (
                    <Card key={ticket.id} as="article" className={cx("lottery-ticket", !ticket.legacy && settled && ticket.matchedCount >= 4 && "lottery-ticket-win", ticket.status === "redeemed" && "lottery-ticket-used")}>
                      <div className="lottery-ticket-head">
                        <span className="eyebrow">{ticket.legacy ? "历史奖券 · " : ""}{ticket.periodNumber == null ? "未分配期次" : `第 ${ticket.periodNumber} 期`}</span>
                        <Badge tone={redeemable ? "gold" : settled && !ticket.legacy ? "green" : "muted"}>{statusLabel}</Badge>
                      </div>
                      {ticket.status === "stock" ? <p className="muted-text">尚无号码 · 可跨日保留</p> : (
                        <div className="lottery-ticket-digits" aria-label="本张奖券号码">
                          {ticket.digits.map((digit) => <span key={digit} className={cx("lottery-digit", ticket.matchedDigits?.includes(digit) && "lottery-digit-hit")}>{pad(digit)}</span>)}
                        </div>
                      )}
                      {settled ? <p className="muted-text">命中 {ticket.matchedCount} 个号码{ticket.matchedDigits?.length ? `：${ticket.matchedDigits.map(pad).join("、")}` : ""}</p> : null}
                      <div className="lottery-ticket-foot">
                        <span className="muted-text">
                          {ticket.status === "stock" ? "在上方按数量投入本期"
                            : ticket.status === "entered" ? "等待所属期次开奖"
                              : ticket.legacy ? `${ticket.status === "redeemed" ? "已领取" : "可领取"}：${ticket.prize ?? `${ticket.consolationGold} 金币安慰金`}`
                                : `已自动发放：遗产碎片 ×${ticket.prizeShards}${ticket.matchedCount >= 4 ? ` · 训练手记 ×${ticket.matchedCount >= 5 ? 3 : 1}` : ""}${ticket.matchedCount >= 5 ? " · 纪念称号或重复折算碎片" : ""}`}
                        </span>
                        {redeemable ? (
                          <Button size="sm" variant="secondary" icon={Coins} loading={busy === ticket.id} disabled={locked}
                            aria-label={`领取历史奖券 ${ticket.id} 的奖励`}
                            onClick={() => void run(ticket.id, async () => {
                              const result = await api.redeemTicket(ticket.id);
                              return result.prize ? `历史兑奖成功：${result.prize}。` : `历史兑奖成功：获得 ${result.gold} 金币安慰金。`;
                            })}>
                            领取历史奖励
                          </Button>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
            <nav className="lottery-pagination" aria-label="奖券分页">
              <Button size="sm" variant="ghost" disabled={locked || state.page <= 1} onClick={() => setPage(1)}>首页</Button>
              <Button size="sm" variant="ghost" disabled={locked || state.page <= 1} onClick={() => setPage(state.page - 1)}>上一页</Button>
              <span className="muted-text" role="status">第 {state.page} / {totalPages} 页</span>
              <Button size="sm" variant="ghost" disabled={locked || state.page >= totalPages} onClick={() => setPage(state.page + 1)}>下一页</Button>
              <Button size="sm" variant="ghost" disabled={locked || state.page >= totalPages} onClick={() => setPage(totalPages)}>末页</Button>
              <form onSubmit={jumpPage} className="lottery-page-jump">
                <label htmlFor="lottery-page-number">跳至页码</label>
                <input id="lottery-page-number" type="number" inputMode="numeric" required min={1} max={totalPages} step={1}
                  value={pageInput} disabled={locked} onChange={(event) => setPageInput(event.target.value)} />
                <Button size="sm" variant="secondary" type="submit" disabled={locked}>跳转</Button>
              </form>
            </nav>
          </section>
          <p className="muted-text lottery-foot-note">当前金币 <strong>{user?.gold ?? 0}</strong>。每日票奖励已自动到账；只有已开奖的历史奖券需要手动领取。</p>
        </>
      ) : null}
    </div>
  );
}
