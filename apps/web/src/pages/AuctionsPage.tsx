import { useRef, useState } from "react";
import {
  Clock,
  Coins,
  Gavel,
  History,
  Tag,
  X,
} from "lucide-react";
import {
  formatDuration,
  type AuctionDetailView,
  type AuctionListingView,
  RARITY_LABELS,
  type ItemSlot,
  type Rarity,
} from "@wod/shared";
import { api, errorMessage } from "../api";
import { useAuth } from "../context";
import { useApi, useNow } from "../hooks";
import { ItemCard } from "../components/ItemCard";
import { ItemPickerField, ItemPickerModal } from "../components/ItemPicker";
import { ListToolbar } from "../components/ListToolbar";
import { Pagination, useAdaptiveRowHeight, useGridColumns, usePagination } from "../components/Pagination";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Gold,
  Modal,
  PageHeader,
  Spinner,
  cx,
} from "../components/ui";

const SLOT_FILTERS: Array<{ value: "all" | ItemSlot; label: string }> = [
  { value: "all", label: "全部" },
  { value: "weapon", label: "武器" },
  { value: "armor", label: "护甲" },
  { value: "trinket", label: "饰品" },
];

const RARITY_FILTERS: Array<{ value: "all" | Rarity; label: string }> = [
  { value: "all", label: "全部品质" },
  ...(Object.keys(RARITY_LABELS) as Rarity[]).map((id) => ({ value: id, label: RARITY_LABELS[id] })),
];

export function AuctionsPage() {
  const { user, refreshUser } = useAuth();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState<"all" | ItemSlot>("all");
  const [rarity, setRarity] = useState<"all" | Rarity>("all");
  const auctionsQ = useApi(
    () => api.auctions(tab === "mine").then((data) => data.auctions),
    [tab],
    5000,
  );
  const inventoryQ = useApi(() => api.inventory().then((data) => data.items), []);
  const now = useNow(1000);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [startPrice, setStartPrice] = useState("");
  const [buyoutPrice, setBuyoutPrice] = useState("");
  const [durationHours, setDurationHours] = useState(24);
  const [bidInputs, setBidInputs] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridColumns = useGridColumns(gridRef, 290);
  const gridRows = useAdaptiveRowHeight(3, 2);
  const pageSize = Math.max(3, gridColumns * gridRows);
  const [detail, setDetail] = useState<AuctionDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const auctions = auctionsQ.data ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = auctions.filter((auction) => {
    if (normalizedQuery && !auction.item.name.toLowerCase().includes(normalizedQuery)) return false;
    if (slot !== "all" && auction.item.slot !== slot) return false;
    if (rarity !== "all" && auction.item.rarity !== rarity) return false;
    return true;
  });
  const { page, pageCount, setPage, slice } = usePagination(filtered, pageSize);
  const slotCount = (value: "all" | ItemSlot) =>
    auctions.filter((auction) => (value === "all" ? true : auction.item.slot === value))
      .filter((auction) => !normalizedQuery || auction.item.name.toLowerCase().includes(normalizedQuery))
      .filter((auction) => rarity === "all" || auction.item.rarity === rarity).length;
  const inventory = inventoryQ.data ?? [];
  const sellable = inventory.filter(
    (item) => !item.equippedBy,
  );
  const selectedItem =
    sellable.find((item) => item.id === selectedItemId) ?? sellable[0];

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

  async function refresh() {
    await auctionsQ.reload();
    await inventoryQ.reload();
    await refreshUser();
  }

  function timeLeft(auction: AuctionListingView): string {
    return formatDuration((auction.closesAt - now) / 1000);
  }

  async function openDetail(auction: AuctionListingView) {
    setError(null);
    try {
      setDetail(await api.auction(auction.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="page page-fit">
      <PageHeader
        eyebrow="荒原拍卖"
        title="拍卖行"
        actions={<Gold amount={user?.gold ?? 0} />}
      />

      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}

      <Card className="market-form-card">
        <div className="section-head compact">
          <h2>
            <Gavel size={17} /> 委托拍卖
          </h2>
          <span className="muted-text">{sellable.length} 件可上架</span>
        </div>
        {sellable.length > 0 ? (
          <div className="market-form">
            <ItemPickerField
              label="选择物品"
              item={selectedItem ?? null}
              onOpen={() => setPickerOpen(true)}
            />
            <label className="field">
              <span>起拍价</span>
              <input
                type="number"
                min={1}
                max={1000000}
                value={startPrice}
                onChange={(event) => setStartPrice(event.target.value)}
                placeholder="例如 50"
              />
            </label>
            <label className="field">
              <span>一口价（可选）</span>
              <input
                type="number"
                min={1}
                max={1000000}
                value={buyoutPrice}
                onChange={(event) => setBuyoutPrice(event.target.value)}
                placeholder="例如 200"
              />
            </label>
            <label className="field">
              <span>持续时间</span>
              <select
                value={durationHours}
                onChange={(event) => setDurationHours(Number(event.target.value))}
              >
                {[1, 6, 12, 24, 48, 72].map((hours) => (
                  <option key={hours} value={hours}>
                    {hours} 小时
                  </option>
                ))}
              </select>
            </label>
            <Button
              icon={Tag}
              loading={busy === "list"}
              disabled={!selectedItem || !startPrice || Number(startPrice) < 1}
              onClick={() =>
                act("list", async () => {
                  if (!selectedItem) return;
                  await api.listAuctionItem({
                    itemId: selectedItem.id,
                    startPrice: Number(startPrice),
                    buyoutPrice: buyoutPrice ? Number(buyoutPrice) : undefined,
                    durationHours,
                  });
                  setStartPrice("");
                  setBuyoutPrice("");
                  setSelectedItemId("");
                  await refresh();
                  setNotice("物品已委托拍卖。");
                })
              }
            >
              开始拍卖
            </Button>
          </div>
        ) : (
          <p className="muted-text">暂无可拍卖物品。</p>
        )}
      </Card>

      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="搜索拍卖物品…"
        chips={SLOT_FILTERS.map((entry) => ({ value: entry.value, label: entry.label, count: slotCount(entry.value) }))}
        chip={slot}
        onChip={setSlot}
        count={`显示 ${filtered.length} / ${auctions.length} 场（第 ${page}/${pageCount} 页）`}
        right={
          <div className="filter-tabs">
            <button className={cx("filter-tab", tab === "all" && "filter-tab-active")} onClick={() => setTab("all")}>
              全部拍卖
            </button>
            <button className={cx("filter-tab", tab === "mine" && "filter-tab-active")} onClick={() => setTab("mine")}>
              我的拍卖
            </button>
          </div>
        }
        secondRow={
          <div className="hub-chips">
            {RARITY_FILTERS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={cx("hub-chip", rarity === entry.value && "hub-chip-active")}
                onClick={() => setRarity(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        }
      />

      {auctionsQ.loading && auctions.length === 0 ? (
        <Spinner label="正在读取拍卖行…" />
      ) : null}

      {!auctionsQ.loading && auctions.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title={tab === "mine" ? "你还没有拍卖" : "拍卖行暂时空着"}
          text={
            tab === "mine"
              ? "委托一件用不上的装备，设置起拍价和一口价。"
              : "过一会儿再来，或者自己先开一场。"
          }
        />
      ) : null}

      <div className="market-grid" ref={gridRef}>
        {(slice as AuctionListingView[]).map((auction) => {
          const bidValue = Number(bidInputs[auction.id] ?? "");
          const canBid =
            !auction.mine &&
            auction.status === "active" &&
            Number.isFinite(bidValue) &&
            bidValue >= auction.minNextBid &&
            (user?.gold ?? 0) >= bidValue;
          const canBuyout =
            !auction.mine &&
            auction.status === "active" &&
            auction.buyoutPrice !== null &&
            (user?.gold ?? 0) >= auction.buyoutPrice;
          return (
            <div key={auction.id} className="market-listing">
              <ItemCard
                item={auction.item}
                footerText={
                  <>
                    <Coins size={12} /> 起拍 {auction.startPrice}
                    {auction.currentBid !== null
                      ? ` · 当前 ${auction.currentBid}`
                      : ""}
                    {auction.buyoutPrice !== null
                      ? ` · 一口价 ${auction.buyoutPrice}`
                      : ""}
                    {" · "}
                    {auction.sellerName}
                  </>
                }
                actions={
                  auction.mine ? (
                    auction.bidCount === 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={X}
                        loading={busy === `cancel-${auction.id}`}
                        onClick={() =>
                          act(`cancel-${auction.id}`, async () => {
                            await api.cancelAuction(auction.id);
                            await refresh();
                            setNotice("拍卖已取消，物品已退回背包。");
                          })
                        }
                      >
                        取消拍卖
                      </Button>
                    ) : (
                      <Badge tone="gold">已有 {auction.bidCount} 次出价</Badge>
                    )
                  ) : (
                    <div className="auction-actions">
                      <input
                        className="auction-bid-input"
                        type="number"
                        min={auction.minNextBid}
                        max={1000000}
                        value={bidInputs[auction.id] ?? ""}
                        onChange={(event) =>
                          setBidInputs((current) => ({
                            ...current,
                            [auction.id]: event.target.value,
                          }))
                        }
                        placeholder={`≥ ${auction.minNextBid}`}
                        aria-label={`对 ${auction.item.name} 出价`}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === `bid-${auction.id}`}
                        disabled={!canBid}
                        onClick={() =>
                          act(`bid-${auction.id}`, async () => {
                            const data = await api.bidAuction(
                              auction.id,
                              Number(bidInputs[auction.id]),
                            );
                            setBidInputs((current) => ({
                              ...current,
                              [auction.id]: "",
                            }));
                            await refresh();
                            setNotice(
                              `出价 ${data.auction.currentBid} 金币，当前由你领先。`,
                            );
                          })
                        }
                      >
                        出价
                      </Button>
                      {auction.buyoutPrice !== null ? (
                        <Button
                          size="sm"
                          loading={busy === `buyout-${auction.id}`}
                          disabled={!canBuyout}
                          onClick={() =>
                            act(`buyout-${auction.id}`, async () => {
                              const data = await api.buyoutAuction(auction.id);
                              await refresh();
                              setNotice(
                                `以 ${data.price} 金币一口价买下「${data.item.name}」，卖家到手 ${data.price - data.fee}。`,
                              );
                            })
                          }
                        >
                          一口价
                        </Button>
                      ) : null}
                    </div>
                  )
                }
              />
              <div className="auction-meta">
                <span>
                  <Clock size={12} /> 剩余 {timeLeft(auction)}
                </span>
                {auction.currentBidderName ? (
                  <span>领先：{auction.currentBidderName}</span>
                ) : (
                  <span>尚无出价</span>
                )}
                {auction.bidCount > 0 ? (
                  <button
                    type="button"
                    className="auction-history"
                    onClick={() => void openDetail(auction)}
                  >
                    <History size={12} /> 出价记录
                  </button>
                ) : null}
                {auction.mine ? <Badge tone="gold">我的拍卖</Badge> : null}
              </div>
            </div>
          );
        })}
      </div>

      <Pagination page={page} pageCount={pageCount} onPage={setPage} label={`共 ${filtered.length} 场`} />

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        items={sellable}
        selectedId={selectedItem?.id}
        onSelect={(item) => setSelectedItemId(item.id)}
        title="选择要拍卖的物品"
      />
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.auction.item.name} · 出价记录` : ""}
      >
        {detail ? (
          <div className="auction-detail">
            <p className="muted-text">
              起拍 {detail.auction.startPrice} · 当前{" "}
              {detail.auction.currentBid ?? "无"} · 一口价{" "}
              {detail.auction.buyoutPrice ?? "无"} · 剩余{" "}
              {timeLeft(detail.auction)}
            </p>
            <div className="auction-bid-list">
              {detail.bids.length === 0 ? (
                <p className="muted-text">还没有出价。</p>
              ) : (
                detail.bids.map((bid) => (
                  <div key={bid.id} className="auction-bid-row">
                    <strong>{bid.bidderName}</strong>
                    <span>{bid.amount} 金币</span>
                    <small>
                      {new Date(bid.createdAt).toLocaleString("zh-CN")}
                    </small>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
