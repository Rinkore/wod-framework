import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { RARITY_LABELS, type ItemSlot, type ItemView, type Rarity } from "@wod/shared";
import { ItemCard } from "./ItemCard";
import { ListToolbar } from "./ListToolbar";
import { Modal, cx } from "./ui";

export function ItemPickerField({
  label,
  item,
  emptyText = "点击从背包选择",
  onOpen,
}: {
  label: string;
  item: ItemView | null;
  emptyText?: string;
  onOpen: () => void;
}) {
  return (
    <div className="hub-picker-field">
      <span className="hub-picker-label">{label}</span>
      <button
        type="button"
        className={cx("hub-picker-trigger", !item && "is-empty")}
        onClick={onOpen}
      >
        {item ? (
          <ItemCard item={item} compact />
        ) : (
          <span className="hub-picker-placeholder">
            <Plus size={16} />
            {emptyText}
          </span>
        )}
      </button>
    </div>
  );
}

export function ItemPickerModal({
  open,
  onClose,
  items,
  selectedId,
  onSelect,
  title = "选择物品",
}: {
  open: boolean;
  onClose: () => void;
  items: ItemView[];
  selectedId?: string;
  onSelect: (item: ItemView) => void;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState<"all" | ItemSlot>("all");
  const [rarity, setRarity] = useState<"all" | Rarity>("all");

  useEffect(() => {
    if (open) {
      setQuery("");
      setSlot("all");
      setRarity("all");
    }
  }, [open]);

  const normalized = query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (normalized && !item.name.toLowerCase().includes(normalized)) return false;
    if (slot !== "all" && item.slot !== slot) return false;
    if (rarity !== "all" && item.rarity !== rarity) return false;
    return true;
  });
  const slotCount = (value: "all" | ItemSlot) =>
    items.filter((item) => (value === "all" ? true : item.slot === value))
      .filter((item) => !normalized || item.name.toLowerCase().includes(normalized))
      .filter((item) => rarity === "all" || item.rarity === rarity).length;

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="搜索物品…"
        chips={[
          { value: "all" as const, label: "全部" },
          { value: "weapon" as const, label: "武器" },
          { value: "armor" as const, label: "护甲" },
          { value: "trinket" as const, label: "饰品" },
        ].map((entry) => ({ ...entry, count: slotCount(entry.value) }))}
        chip={slot}
        onChip={setSlot}
        count={`显示 ${filtered.length} / ${items.length} 件`}
        secondRow={
          <div className="hub-chips">
            {(["all", "common", "uncommon", "rare", "epic"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={cx("hub-chip", rarity === id && "hub-chip-active")}
                onClick={() => setRarity(id)}
              >
                {id === "all" ? "全部品质" : RARITY_LABELS[id]}
              </button>
            ))}
          </div>
        }
      />
      <div className="hub-picker-grid">
        {filtered.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            className={cx("hub-picker-option", item.id === selectedId && "is-selected")}
            onClick={() => {
              onSelect(item);
              onClose();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(item);
                onClose();
              }
            }}
          >
            <ItemCard item={item} compact />
            {item.id === selectedId ? <span className="hub-picker-badge">已选</span> : null}
          </div>
        ))}
      </div>
      {filtered.length === 0 ? <p className="muted-text">没有符合条件的物品。</p> : null}
    </Modal>
  );
}
