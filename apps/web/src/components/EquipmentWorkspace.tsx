import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Backpack, Search } from "lucide-react";
import {
  DAMAGE_TYPE_LABELS,
  MODIFIER_KINDS,
  MODIFIER_KIND_LABELS,
  RARITY_ORDER,
  SLOT_LABELS,
  WEAPON_TYPE_LABELS,
  isEquipmentSlot,
  modifierAmountText,
  type ContentPack,
  type EquipResultView,
  type HeroView,
  type ItemView,
  type Slot,
} from "@wod/shared";
import { computeHeroDerived, type HeroRunSpec } from "@wod/engine";
import { api, errorMessage } from "../api";
import { heroActions, heroPhysicalReduction } from "../heroStats";
import { useContent } from "../context";
import { ItemCard } from "./ItemCard";
import { Pagination, useGridColumns, usePagination } from "./Pagination";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Modal,
  Spinner,
  cx,
  slotIcon,
} from "./ui";

const SLOT_ORDER: Slot[] = ["weapon", "armor", "trinket"];

interface EquipmentWorkspaceProps {
  open: boolean;
  onClose: () => void;
  initialHeroId?: string;
  initialSlot?: Slot;
  initialItemId?: string;
  onEquipped?: (result: EquipResultView) => void;
}

function equipmentItems(hero: HeroView): ItemView[] {
  return SLOT_ORDER.map((slot) => hero.equipment[slot]).filter(
    (item): item is ItemView => Boolean(item),
  );
}

function buildSpec(hero: HeroView, equipment: ItemView[]): HeroRunSpec {
  return {
    id: hero.id,
    name: hero.name,
    level: hero.level,
    epEarned: hero.epEarned,
    raceId: hero.raceId,
    weaponType: hero.pathWeaponType,
    skillLevels: Object.fromEntries(
      hero.skills
        .filter((skill) => skill.level > 0)
        .map((skill) => [skill.id, skill.level]),
    ),
    equipment: equipment.map((item) => ({
      templateId: item.templateId,
      affixes: item.affixes,
    })),
  };
}

function weaponRequirement(
  content: ContentPack,
  hero: HeroView,
  item: ItemView,
): { ok: boolean; reason: string | null } {
  const template = content.items.find((row) => row.id === item.templateId);
  if (!template || template.slot !== "weapon") return { ok: true, reason: null };
  const weaponType = template.weaponType ?? item.weaponType;
  if (!weaponType) return { ok: true, reason: null };
  if (hero.weaponProficiencies.includes(weaponType)) return { ok: true, reason: null };
  return { ok: false, reason: `尚未掌握${WEAPON_TYPE_LABELS[weaponType]}` };
}

function weaponCompatible(content: ContentPack, hero: HeroView, item: ItemView): boolean {
  return weaponRequirement(content, hero, item).ok;
}

function toneFor(before: number, after: number): "up" | "down" | "flat" {
  if (after > before) return "up";
  if (after < before) return "down";
  return "flat";
}

function DeltaRow({
  label,
  before,
  after,
  tone = "flat",
}: {
  label: string;
  before: string | number;
  after: string | number;
  tone?: "up" | "down" | "flat";
}) {
  if (before === after) return null;
  return (
    <div className="equipment-delta">
      <span>{label}</span>
      <strong className={cx(tone === "up" && "delta-up", tone === "down" && "delta-down")}>
        {before}
        <ArrowRight size={11} />
        {after}
      </strong>
    </div>
  );
}

export function EquipmentWorkspace({
  open,
  onClose,
  initialHeroId,
  initialSlot,
  initialItemId,
  onEquipped,
}: EquipmentWorkspaceProps) {
  const content = useContent();
  const [heroes, setHeroes] = useState<HeroView[]>([]);
  const [items, setItems] = useState<ItemView[]>([]);
  const [selectedHeroId, setSelectedHeroId] = useState(initialHeroId ?? "");
  const [activeSlot, setActiveSlot] = useState<Slot>(initialSlot ?? "weapon");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null);
  const [search, setSearch] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const candidateGridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setSearch("");
    setShowUnavailable(false);

    Promise.all([api.heroes(), api.inventory()])
      .then(([heroResponse, itemResponse]) => {
        if (!alive) return;
        const nextHeroes = heroResponse.heroes;
        const nextItems = itemResponse.items;
        setHeroes(nextHeroes);
        setItems(nextItems);

        const initialItem = initialItemId
          ? nextItems.find((item) => item.id === initialItemId)
          : undefined;
        const initialItemSlot = initialItem?.slot;
        const preferredSlot =
          initialSlot ??
          (initialItemSlot && isEquipmentSlot(initialItemSlot) ? initialItemSlot : "weapon");
        let preferredHeroId =
          initialHeroId && nextHeroes.some((hero) => hero.id === initialHeroId)
            ? initialHeroId
            : "";

        if (!preferredHeroId) {
          preferredHeroId = initialItem
            ? (nextHeroes.find(
                (hero) => !hero.busyExpeditionId && weaponCompatible(content, hero, initialItem),
              )?.id ??
              nextHeroes.find((hero) => weaponCompatible(content, hero, initialItem))?.id ??
              nextHeroes[0]?.id ??
              "")
            : (nextHeroes.find((hero) => !hero.busyExpeditionId)?.id ??
              nextHeroes[0]?.id ??
              "");
        }

        setSelectedHeroId(preferredHeroId);
        setActiveSlot(preferredSlot);
        setSelectedItemId(initialItem?.id ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(errorMessage(err));
        setLoading(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialHeroId, initialSlot, initialItemId, content]);

  const selectedHero = heroes.find((hero) => hero.id === selectedHeroId);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const slotItem = selectedHero?.equipment[activeSlot] ?? null;

  function ownerFor(item: ItemView): HeroView | null {
    return item.equippedBy
      ? (heroes.find((hero) => hero.id === item.equippedBy) ?? null)
      : null;
  }

  function availability(item: ItemView): {
    available: boolean;
    reason: string | null;
    owner: HeroView | null;
  } {
    if (!selectedHero) {
      return { available: false, reason: "请选择英雄", owner: null };
    }
    const owner = ownerFor(item);
    if (selectedHero.busyExpeditionId) {
      return { available: false, reason: "英雄远征中", owner };
    }
    const classCheck = weaponRequirement(content, selectedHero, item);
    if (!classCheck.ok) {
      return { available: false, reason: classCheck.reason, owner };
    }
    if (item.level > selectedHero.level) {
      return { available: false, reason: `需要等级 ${item.level}`, owner };
    }
    if (owner && owner.id !== selectedHero.id && owner.busyExpeditionId) {
      return { available: false, reason: `${owner.name} 远征中`, owner };
    }
    return { available: true, reason: null, owner };
  }

  const candidates = useMemo(() => {
    if (!selectedHero) return [];
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => item.slot === activeSlot)
      .filter((item) => item.id !== selectedHero.equipment[activeSlot]?.id)
      .filter((item) => item.equippedBy !== selectedHero.id)
      .filter((item) => {
        if (!query) return true;
        return (
          item.name.toLowerCase().includes(query) ||
          item.affixes.some((affix) => affix.name.toLowerCase().includes(query))
        );
      })
      .sort((a, b) => {
        const aAvailable = availability(a).available;
        const bAvailable = availability(b).available;
        if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;
        return RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || b.level - a.level;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedHero, activeSlot, search, heroes, content]);

  const visibleCandidates = candidates.filter(
    (item) => showUnavailable || availability(item).available || item.id === selectedItemId,
  );

  const candidateColumns = useGridColumns(
    candidateGridRef,
    280,
    8,
    open && Boolean(selectedHero),
  );
  const pageSize = Math.max(2, candidateColumns * 2);
  const { page, pageCount, setPage, slice } = usePagination(visibleCandidates, pageSize);

  useEffect(() => {
    setPage(1);
  }, [activeSlot, search, showUnavailable, selectedHeroId, setPage]);

  useEffect(() => {
    if (!selectedItemId) return;
    const index = visibleCandidates.findIndex((item) => item.id === selectedItemId);
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId, items.length, pageSize, setPage]);

  const preview = useMemo(() => {
    if (!selectedHero || !selectedItem) return null;
    const currentEquipment = equipmentItems(selectedHero);
    const nextEquipment = SLOT_ORDER.map((slot) =>
      slot === selectedItem.slot ? selectedItem : selectedHero.equipment[slot],
    ).filter((item): item is ItemView => Boolean(item));
    return {
      current: computeHeroDerived(content, buildSpec(selectedHero, currentEquipment)),
      next: computeHeroDerived(content, buildSpec(selectedHero, nextEquipment)),
    };
  }, [content, selectedHero, selectedItem]);

  const selectedState = selectedItem ? availability(selectedItem) : null;
  const fromOwner =
    selectedState?.owner && selectedHero && selectedState.owner.id !== selectedHero.id
      ? selectedState.owner
      : null;

  async function refreshData(preferredHeroId: string, preferredSlot: Slot) {
    const [heroResponse, itemResponse] = await Promise.all([api.heroes(), api.inventory()]);
    setHeroes(heroResponse.heroes);
    setItems(itemResponse.items);
    setSelectedHeroId(
      heroResponse.heroes.some((hero) => hero.id === preferredHeroId)
        ? preferredHeroId
        : (heroResponse.heroes[0]?.id ?? ""),
    );
    setActiveSlot(preferredSlot);
  }

  async function confirmEquip() {
    if (!selectedHero || !selectedItem || !selectedState?.available || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.equip(selectedHero.id, selectedItem.id);
      const messages = [
        result.fromHero
          ? `已从 ${result.fromHero.name} 身上转移「${selectedItem.name}」`
          : `已装备「${selectedItem.name}」`,
      ];
      if (result.replacedItem) messages.push(`「${result.replacedItem.name}」已回到背包`);
      setNotice(messages.join("；"));
      setSelectedItemId(null);
      onEquipped?.(result);
      await refreshData(result.hero.id, activeSlot);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const confirmLabel = !selectedItem
    ? "选择装备"
    : !selectedState?.available
      ? "无法装备"
      : fromOwner
        ? "转移并装备"
        : slotItem
          ? "确认替换"
          : "确认装备";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`装备工作台${selectedHero ? ` · ${selectedHero.name}` : ""}`}
      full
      footer={
        <div className="equipment-footer">
          <span className="modal-foot-info">
            装备等级不能高于英雄等级；从其他英雄转移会先卸下原装备。
          </span>
          <Button
            icon={ArrowRight}
            loading={busy}
            disabled={!selectedItem || !selectedState?.available}
            onClick={confirmEquip}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {loading ? <Spinner label="正在整理装备…" /> : null}
      {!loading && error ? <ErrorNotice message={error} /> : null}
      {!loading && notice ? <div className="notice notice-success">{notice}</div> : null}

      {!loading && heroes.length === 0 ? (
        <EmptyState icon={Backpack} title="还没有英雄" text="先创建一名英雄，再来整理装备。" />
      ) : null}

      {!loading && selectedHero ? (
        <div className="equipment-workspace">
          <div className="equipment-hero-bar">
            <label className="equipment-hero-select">
              <span>英雄</span>
              <select
                value={selectedHeroId}
                onChange={(event) => {
                  setSelectedHeroId(event.target.value);
                  setSelectedItemId(null);
                }}
              >
                {heroes.map((hero) => (
                  <option key={hero.id} value={hero.id}>
                    {hero.name} · 等级 {hero.level} · {hero.weaponName}
                    {hero.busyExpeditionId ? " · 远征中" : ""}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted-text">
              生命 {selectedHero.maxHp} · 护甲 {Math.round(selectedHero.armor * 10) / 10}
              {heroPhysicalReduction(selectedHero) !== undefined
                ? `（${Math.round(heroPhysicalReduction(selectedHero)! * 100)}%）`
                : ""}
              · 先攻 {selectedHero.initiative}（{heroActions(selectedHero)} 行动）
            </span>
          </div>

          {selectedHero.busyExpeditionId ? (
            <div className="notice notice-info">英雄正在远征中，只能查看装备，不能更换。</div>
          ) : null}

          <div className="equipment-slot-row">
            {SLOT_ORDER.map((slot) => {
              const item = selectedHero.equipment[slot];
              const SlotIcon = slotIcon(slot);
              return (
                <button
                  key={slot}
                  type="button"
                  className={cx(
                    "equipment-slot",
                    activeSlot === slot && "equipment-slot-active",
                  )}
                  onClick={() => {
                    setActiveSlot(slot);
                    setSelectedItemId(null);
                  }}
                >
                  <span className="equipment-slot-head">
                    <SlotIcon size={14} /> {SLOT_LABELS[slot]}
                  </span>
                  <strong>{item?.name ?? "空"}</strong>
                  <small>{item ? `等级 ${item.level}` : "点击选择"}</small>
                </button>
              );
            })}
          </div>

          <div className="equipment-body">
            <div className="equipment-candidates">
              <div className="equipment-candidate-toolbar">
                <label className="equipment-search">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索物品或词缀"
                  />
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={showUnavailable}
                    onChange={(event) => setShowUnavailable(event.target.checked)}
                  />
                  <span>显示不可用</span>
                </label>
              </div>

              <div className="equipment-candidate-list" ref={candidateGridRef}>
                {visibleCandidates.length === 0 ? (
                  <p className="muted-text">
                    {candidates.length > 0 && !showUnavailable
                      ? `暂无可用装备（${candidates.length} 件不可用）。`
                      : "此槽位暂无物品。"}
                  </p>
                ) : null}
                {(slice as ItemView[]).map((item) => {
                  const state = availability(item);
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selectedItemId === item.id}
                      aria-label={`${item.name} · 等级 ${item.level} · ${state.available ? "可用" : state.reason}`}
                      className={cx(
                        "equipment-candidate-card",
                        `equipment-rarity-${item.rarity}`,
                        selectedItemId === item.id && "is-selected",
                        !state.available && "is-unavailable",
                      )}
                      onClick={() => setSelectedItemId(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedItemId(item.id);
                        }
                      }}
                    >
                      <ItemCard item={item} compact />
                      <div className="equipment-candidate-foot">
                        <span>
                          {state.available ? (
                            <Badge tone="green">可用</Badge>
                          ) : (
                            <Badge tone="red">{state.reason}</Badge>
                          )}
                        </span>
                        <span className="equipment-candidate-meta">
                          {state.owner && state.owner.id !== selectedHero.id
                            ? `在 ${state.owner.name} 身上 · `
                            : ""}
                          价值 {item.value} 金币
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Pagination
                page={page}
                pageCount={pageCount}
                onPage={setPage}
                label={`共 ${visibleCandidates.length} 件`}
              />
            </div>

            <div className="equipment-compare">
              {selectedItem ? (
                <>
                  <div className="equipment-compare-head">
                    <strong>装备对比</strong>
                    <span className="muted-text">{SLOT_LABELS[activeSlot]}</span>
                  </div>

                  <div className="equipment-compare-items">
                    <div>
                      <span className="equipment-compare-label">当前</span>
                      {slotItem ? (
                        <ItemCard item={slotItem} compact />
                      ) : (
                        <div className="equipment-empty-slot">空</div>
                      )}
                    </div>
                    <div>
                      <span className="equipment-compare-label">候选</span>
                      <ItemCard item={selectedItem} compact />
                    </div>
                  </div>

                  {preview ? (
                    <div className="equipment-deltas">
                      <DeltaRow
                        label="生命"
                        before={preview.current.maxHp}
                        after={preview.next.maxHp}
                        tone={toneFor(preview.current.maxHp, preview.next.maxHp)}
                      />
                      <DeltaRow
                        label="法力"
                        before={preview.current.maxEnergy}
                        after={preview.next.maxEnergy}
                        tone={toneFor(preview.current.maxEnergy, preview.next.maxEnergy)}
                      />
                      <DeltaRow
                        label="攻击"
                        before={Math.round(preview.current.attackPower)}
                        after={Math.round(preview.next.attackPower)}
                        tone={toneFor(preview.current.attackPower, preview.next.attackPower)}
                      />
                      <DeltaRow
                        label="先攻"
                        before={`${preview.current.initiative}（${preview.current.actionsPerRound} 行动）`}
                        after={`${preview.next.initiative}（${preview.next.actionsPerRound} 行动）`}
                        tone={toneFor(preview.current.initiative, preview.next.initiative)}
                      />
                      <DeltaRow
                        label="护甲"
                        before={`${Math.round(preview.current.armor * 10) / 10}（${Math.round(preview.current.physicalReduction * 100)}%）`}
                        after={`${Math.round(preview.next.armor * 10) / 10}（${Math.round(preview.next.physicalReduction * 100)}%）`}
                        tone={toneFor(preview.current.armor, preview.next.armor)}
                      />
                      <DeltaRow
                        label="命中"
                        before={`${Math.round(preview.current.hit * 10) / 10}（${Math.round(preview.current.hitRate * 100)}%）`}
                        after={`${Math.round(preview.next.hit * 10) / 10}（${Math.round(preview.next.hitRate * 100)}%）`}
                        tone={toneFor(preview.current.hit, preview.next.hit)}
                      />
                      <DeltaRow
                        label="闪避"
                        before={`${Math.round(preview.current.evasion * 10) / 10}（${Math.round(preview.current.evasionRate * 100)}%）`}
                        after={`${Math.round(preview.next.evasion * 10) / 10}（${Math.round(preview.next.evasionRate * 100)}%）`}
                        tone={toneFor(preview.current.evasion, preview.next.evasion)}
                      />
                      <DeltaRow
                        label="暴击"
                        before={`${Math.round(preview.current.critChance * 100)}%`}
                        after={`${Math.round(preview.next.critChance * 100)}%`}
                        tone={toneFor(preview.current.critChance, preview.next.critChance)}
                      />
                      <DeltaRow
                        label="武器伤害"
                        before={preview.current.weaponDamage}
                        after={preview.next.weaponDamage}
                        tone={toneFor(
                          preview.current.weaponDamage,
                          preview.next.weaponDamage,
                        )}
                      />
                      {MODIFIER_KINDS.filter(
                        (kind) =>
                          !["hit", "evasion", "crit", "armor", "initiative"].includes(kind),
                      ).map((kind) => {
                        const before = preview.current.modifiers
                          .filter((row) => row.kind === kind)
                          .reduce((sum, row) => sum + row.amount, 0);
                        const after = preview.next.modifiers
                          .filter((row) => row.kind === kind)
                          .reduce((sum, row) => sum + row.amount, 0);
                        if (before === after) return null;
                        return (
                          <DeltaRow
                            key={kind}
                            label={MODIFIER_KIND_LABELS[kind]}
                            before={modifierAmountText(kind, before)}
                            after={modifierAmountText(kind, after)}
                            tone={toneFor(before, after)}
                          />
                        );
                      })}
                      {preview.current.weaponDamageType !== preview.next.weaponDamageType ? (
                        <DeltaRow
                          label="伤害类型"
                          before={DAMAGE_TYPE_LABELS[preview.current.weaponDamageType]}
                          after={DAMAGE_TYPE_LABELS[preview.next.weaponDamageType]}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {!selectedState?.available ? (
                    <div className="notice notice-error">
                      {selectedState?.reason ?? "这件装备当前无法使用"}
                    </div>
                  ) : (
                    <p className="equipment-replace-note">
                      {fromOwner
                        ? `将从 ${fromOwner.name} 身上卸下「${selectedItem.name}」。`
                        : null}
                      {slotItem ? `「${slotItem.name}」将回到背包。` : null}
                      {!fromOwner && !slotItem ? "该槽位当前为空。" : null}
                    </p>
                  )}

                </>
              ) : (
                <div className="equipment-compare-empty">
                  <Backpack size={24} />
                  <strong>选择一件候选装备</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
