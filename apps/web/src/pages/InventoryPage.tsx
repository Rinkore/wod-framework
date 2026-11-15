import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Backpack, Coins, PackageOpen, Sparkles } from "lucide-react";
import { RARITY_LABELS, RARITY_ORDER, type Rarity, type ItemSlot, type ItemView } from "@wod/shared";
import { sellValue } from "@wod/engine";
import { api, errorMessage } from "../api";
import { useAuth } from "../context";
import { useApi } from "../hooks";
import { EquipmentWorkspace } from "../components/EquipmentWorkspace";
import { ListToolbar } from "../components/ListToolbar";
import { Pagination, useAdaptiveRowHeight, useGridColumns, usePagination } from "../components/Pagination";
import { ItemCard } from "../components/ItemCard";
import {
  Button,
  ErrorNotice,
  Gold,
  Modal,
  PageHeader,
  Spinner,
  cx,
} from "../components/ui";

const FILTERS: Array<{ id: "all" | ItemSlot; label: string }> = [
  { id: "all", label: "全部" },
  { id: "weapon", label: "武器" },
  { id: "armor", label: "护甲" },
  { id: "trinket", label: "饰品" },
];

const RARITY_FILTERS: Array<{ id: "all" | Rarity; label: string }> = [
  { id: "all", label: "全部品质" },
  ...(Object.keys(RARITY_LABELS) as Rarity[]).map((id) => ({ id, label: RARITY_LABELS[id] })),
];

export function InventoryPage() {
  const { user, refreshUser } = useAuth();
  const itemsQ = useApi(() => api.inventory().then((data) => data.items), []);
  const heroesQ = useApi(() => api.heroes().then((data) => data.heroes), []);
  const [filter, setFilter] = useState<"all" | ItemSlot>("all");
  const [rarity, setRarity] = useState<"all" | Rarity>("all");
  const [query, setQuery] = useState("");
  const [onlyUnequipped, setOnlyUnequipped] = useState(false);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [equipmentItemId, setEquipmentItemId] = useState<string | undefined>();
  const [sellTarget, setSellTarget] = useState<ItemView | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridColumns = useGridColumns(gridRef, 290);
  const gridRows = useAdaptiveRowHeight(3, 2);
  const pageSize = Math.max(3, gridColumns * gridRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = itemsQ.data ?? [];
  const heroes = heroesQ.data ?? [];
  const heroNames = new Map(heroes.map((hero) => [hero.id, hero.name]));

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (item: ItemView) =>
    !normalizedQuery ||
    item.name.toLowerCase().includes(normalizedQuery) ||
    item.affixes.some((affix) => affix.name.toLowerCase().includes(normalizedQuery));
  const matchesRarity = (item: ItemView) => rarity === "all" || item.rarity === rarity;
  const matchesOther = (item: ItemView) => (onlyUnequipped ? !item.equippedBy : true);
  const categoryCount = (slot: "all" | ItemSlot) =>
    items.filter((item) => (slot === "all" ? true : item.slot === slot)).filter(matchesQuery).filter(matchesRarity).filter(matchesOther).length;

  const filtered = items
    .filter((item) => (filter === "all" ? true : item.slot === filter))
    .filter(matchesQuery)
    .filter(matchesRarity)
    .filter(matchesOther)
    .sort((a, b) => {
      if (Boolean(a.equippedBy) !== Boolean(b.equippedBy)) return a.equippedBy ? 1 : -1;
      return RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || b.level - a.level;
    });
  const { page, pageCount, setPage, slice } = usePagination(filtered, pageSize);

  async function unequip(item: ItemView) {
    if (!item.equippedBy || !item.equippedSlot) return;
    setBusy(`unequip-${item.id}`);
    setError(null);
    try {
      await api.unequip(item.equippedBy, item.equippedSlot);
      await itemsQ.reload();
      await heroesQ.reload();
      setNotice(`已卸下「${item.name}」，物品回到背包。`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function sell() {
    if (!sellTarget) return;
    setBusy("sell");
    setError(null);
    try {
      const data = await api.sell(sellTarget.id);
      itemsQ.setData(items.filter((item) => item.id !== sellTarget.id));
      await refreshUser();
      setNotice(`已出售「${data.item.name}」，获得 ${data.price} 金币。`);
      setSellTarget(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function openEquipment(item?: ItemView) {
    setEquipmentItemId(item?.id);
    setEquipmentOpen(true);
    setError(null);
  }

  return (
    <div className="page page-fit">
      <PageHeader
        eyebrow="仓库"
        title="背包"
        actions={
          <div className="inline-actions">
            <Gold amount={user?.gold ?? 0} />
          </div>
        }
      />

      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="搜索物品或词缀…"
        chips={FILTERS.map((entry) => ({ value: entry.id, label: entry.label, count: categoryCount(entry.id) }))}
        chip={filter}
        onChip={setFilter}
        count={`显示 ${filtered.length} 件（第 ${page}/${pageCount} 页） · 已装备 ${items.filter((item) => item.equippedBy).length} 件`}
        right={
          <label className="toggle">
            <input
              type="checkbox"
              checked={onlyUnequipped}
              onChange={(event) => setOnlyUnequipped(event.target.checked)}
            />
            <span>只看未装备</span>
          </label>
        }
        secondRow={
          <div className="hub-chips">
            {RARITY_FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={cx("hub-chip", rarity === entry.id && "hub-chip-active")}
                onClick={() => setRarity(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        }
      />

      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}
      {itemsQ.loading && items.length === 0 ? <Spinner label="正在清点仓库…" /> : null}

      {!itemsQ.loading && items.length === 0 ? (
        <div className="empty-state">
          <PackageOpen size={30} />
          <strong>仓库是空的</strong>
          <p>派一支队伍去迷宫，战利品会出现在这里。</p>
          <Link to="/dungeons" className="btn btn-primary btn-md">
            查看迷宫
          </Link>
        </div>
      ) : null}

      <div className="inventory-grid" ref={gridRef}>
        {(slice as ItemView[]).map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            compact
            equippedName={item.equippedBy ? heroNames.get(item.equippedBy) : undefined}
            actions={
              item.equippedBy ? (
                <>
                  <Link to={`/heroes/${item.equippedBy}`} className="btn btn-ghost btn-sm">
                    查看英雄
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `unequip-${item.id}`}
                    onClick={() => unequip(item)}
                  >
                    卸下
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openEquipment(item)}
                  >
                    装备
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setError(null);
                      setSellTarget(item);
                    }}
                  >
                    出售
                  </Button>
                </>
              )
            }
          />
        ))}
      </div>

      <Pagination
        page={page}
        pageCount={pageCount}
        onPage={setPage}
        label={`共 ${filtered.length} 件`}
      />

      {items.length > 0 && filtered.length === 0 ? (
        <div className="empty-state">
          <Backpack size={28} />
          <strong>当前筛选下没有物品</strong>
          <p>换个关键词或分类试试。</p>
        </div>
      ) : null}

      <EquipmentWorkspace
        open={equipmentOpen}
        onClose={() => setEquipmentOpen(false)}
        initialItemId={equipmentItemId}
        onEquipped={() => {
          void itemsQ.reload();
          void heroesQ.reload();
        }}
      />

      <Modal
        open={Boolean(sellTarget)}
        onClose={() => setSellTarget(null)}
        title="出售物品"
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setSellTarget(null)}>
              取消
            </Button>
            <Button variant="danger" loading={busy === "sell"} onClick={sell} icon={Coins}>
              确认出售
            </Button>
          </div>
        }
      >
        {sellTarget ? (
          <div className="sell-preview">
            <ItemCard item={sellTarget} compact />
            <p>
              商人愿意支付 <strong className="text-gold">{sellValue(sellTarget)}</strong> 金币。
              出售后无法撤回。
            </p>
            {error ? <ErrorNotice message={error} /> : null}
          </div>
        ) : null}
      </Modal>

    </div>
  );
}
