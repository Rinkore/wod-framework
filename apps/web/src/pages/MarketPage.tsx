import { useRef, useState } from "react";
import { Coins, Store, Tag, X } from "lucide-react";
import { RARITY_LABELS, type ItemSlot, type Rarity } from "@wod/shared";
import { api, errorMessage } from "../api";
import { useAuth } from "../context";
import { useApi } from "../hooks";
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

export function MarketPage() {
  const { user, refreshUser } = useAuth();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState<"all" | ItemSlot>("all");
  const [rarity, setRarity] = useState<"all" | Rarity>("all");
  const marketQ = useApi(() => api.market(tab === "mine").then((data) => data.listings), [tab]);
  const inventoryQ = useApi(() => api.inventory().then((data) => data.items), []);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [price, setPrice] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridColumns = useGridColumns(gridRef, 290);
  const gridRows = useAdaptiveRowHeight(3, 2);
  const pageSize = Math.max(3, gridColumns * gridRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const listings = marketQ.data ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = listings.filter((listing) => {
    if (normalizedQuery && !listing.item.name.toLowerCase().includes(normalizedQuery)) return false;
    if (slot !== "all" && listing.item.slot !== slot) return false;
    if (rarity !== "all" && listing.item.rarity !== rarity) return false;
    return true;
  });
  const { page, pageCount, setPage, slice } = usePagination(filtered, pageSize);
  const slotCount = (value: "all" | ItemSlot) =>
    listings.filter((listing) => (value === "all" ? true : listing.item.slot === value))
      .filter((listing) => !normalizedQuery || listing.item.name.toLowerCase().includes(normalizedQuery))
      .filter((listing) => rarity === "all" || listing.item.rarity === rarity).length;
  const inventory = inventoryQ.data ?? [];
  const sellable = inventory.filter(
    (item) => !item.equippedBy,
  );
  const selectedItem = sellable.find((item) => item.id === selectedItemId) ?? sellable[0];

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
    await marketQ.reload();
    await inventoryQ.reload();
    await refreshUser();
  }

  return (
    <div className="page page-fit">
      <PageHeader
        eyebrow="荒原集市"
        title="市场"
        actions={<Gold amount={user?.gold ?? 0} />}
      />

      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}

      <Card className="market-form-card">
        <div className="section-head compact">
          <h2>
            <Tag size={17} /> 上架物品
          </h2>
          <span className="muted-text">{sellable.length} 件可出售</span>
        </div>
        {sellable.length > 0 ? (
          <div className="market-form">
            <ItemPickerField
              label="选择物品"
              item={selectedItem ?? null}
              onOpen={() => setPickerOpen(true)}
            />
            <label className="field">
              <span>售价（金币）</span>
              <input
                type="number"
                min={1}
                max={1000000}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="例如 120"
              />
              {Number(price) >= 1 ? (
                <small className="muted-text">
                  成交后收取 5% 手续费，你实收 {Math.floor(Number(price) * 0.95)} 金币
                </small>
              ) : null}
            </label>
            <Button
              icon={Store}
              loading={busy === "list"}
              disabled={!selectedItem || !price || Number(price) < 1}
              onClick={() =>
                act("list", async () => {
                  if (!selectedItem) return;
                  await api.listMarketItem(selectedItem.id, Number(price));
                  setPrice("");
                  setSelectedItemId("");
                  await refresh();
                  setNotice("物品已上架。");
                })
              }
            >
              上架
            </Button>
          </div>
        ) : (
          <p className="muted-text">暂无可上架物品。</p>
        )}
      </Card>

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        items={sellable}
        selectedId={selectedItem?.id}
        onSelect={(item) => setSelectedItemId(item.id)}
        title="选择要上架的物品"
      />
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="搜索在售物品…"
        chips={SLOT_FILTERS.map((entry) => ({ value: entry.value, label: entry.label, count: slotCount(entry.value) }))}
        chip={slot}
        onChip={setSlot}
        count={`显示 ${filtered.length} / ${listings.length} 条（第 ${page}/${pageCount} 页）`}
        right={
          <div className="filter-tabs">
            <button className={cx("filter-tab", tab === "all" && "filter-tab-active")} onClick={() => setTab("all")}>
              市场
            </button>
            <button className={cx("filter-tab", tab === "mine" && "filter-tab-active")} onClick={() => setTab("mine")}>
              我的挂单
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

      {marketQ.loading && listings.length === 0 ? <Spinner label="正在逛集市…" /> : null}

      {!marketQ.loading && listings.length === 0 ? (
        <EmptyState
          icon={Store}
          title={tab === "mine" ? "你还没有挂单" : "市场上没有物品"}
          text={tab === "mine" ? "上架一件用不上的装备，等别人出价。" : "过一会儿再来，或者换个关键词、自己先挂一件。"}
        />
      ) : null}

      <div className="market-grid" ref={gridRef}>
        {(slice as typeof listings).map((listing) => (
          <div key={listing.id} className="market-listing">
            <ItemCard
              item={listing.item}
              footerText={
                <>
                  <Coins size={12} /> {listing.price} 金币 · {listing.sellerName}
                </>
              }
              actions={
                listing.mine ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={X}
                    loading={busy === `cancel-${listing.id}`}
                    onClick={() =>
                      act(`cancel-${listing.id}`, async () => {
                        await api.cancelListing(listing.id);
                        await refresh();
                        setNotice("挂单已下架，物品已退回背包。");
                      })
                    }
                  >
                    下架
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Coins}
                    disabled={(user?.gold ?? 0) < listing.price}
                    loading={busy === `buy-${listing.id}`}
                    onClick={() =>
                      act(`buy-${listing.id}`, async () => {
                        const data = await api.buyListing(listing.id);
                        await refresh();
                        setNotice(
                          `以 ${data.price} 金币买下了「${data.item.name}」。`,
                        );
                      })
                    }
                  >
                    购买
                  </Button>
                )
              }
            />
            {listing.mine ? <Badge tone="gold">我的挂单</Badge> : null}
          </div>
        ))}
      </div>

      <Pagination page={page} pageCount={pageCount} onPage={setPage} label={`共 ${filtered.length} 条`} />
    </div>
  );
}
