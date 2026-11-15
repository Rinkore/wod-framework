import { useRef, useState } from "react";
import { Castle, Coins, Crown, LogOut, Plus, Shield, Trash2, Users } from "lucide-react";
import { ITEM_SLOT_LABELS, type ItemSlot, type Rarity } from "@wod/shared";
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
} from "../components/ui";

export function ClanPage() {
  const { user, refreshUser } = useAuth();
  const clanQ = useApi(() => api.myClan().then((data) => data.clan), []);
  const listQ = useApi(() => api.clans().then((data) => data.clans), []);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [joinTag, setJoinTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const clan = clanQ.data;
  const clans = listQ.data ?? [];
  const isLeader = Boolean(clan && user && clan.leaderUserId === user.id);
  const treasuryQ = useApi(
    () => (clan ? api.clanTreasury(clan.id) : Promise.resolve(null)),
    [clan?.id],
  );
  const inventoryQ = useApi(() => api.inventory().then((data) => data.items), []);
  const [goldAmount, setGoldAmount] = useState("10");
  const [depositItemId, setDepositItemId] = useState("");
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState<"all" | ItemSlot>("all");
  const [rarity, setRarity] = useState<"all" | Rarity>("all");
  const [depositQuery, setDepositQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const treasury = treasuryQ.data;
  const depositItems = (inventoryQ.data ?? []).filter(
    (item) => !item.equippedBy,
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const gridColumns = useGridColumns(gridRef, 260);
  const gridRows = useAdaptiveRowHeight(3, 2);
  const pageSize = Math.max(3, gridColumns * gridRows);
  const normalizedQuery = query.trim().toLowerCase();
  const treasuryItems = (treasury?.items ?? []).filter((entry) => {
    if (normalizedQuery && !entry.item.name.toLowerCase().includes(normalizedQuery)) return false;
    if (slot !== "all" && entry.item.slot !== slot) return false;
    if (rarity !== "all" && entry.item.rarity !== rarity) return false;
    return true;
  });
  const slotCount = (value: "all" | ItemSlot) =>
    (treasury?.items ?? []).filter((entry) => (value === "all" ? true : entry.item.slot === value))
      .filter((entry) => !normalizedQuery || entry.item.name.toLowerCase().includes(normalizedQuery))
      .filter((entry) => rarity === "all" || entry.item.rarity === rarity).length;
  const normalizedDepositQuery = depositQuery.trim().toLowerCase();
  const { page, pageCount, setPage, slice } = usePagination(treasuryItems, pageSize);
  const depositChoices = depositItems.filter(
    (item) => !normalizedDepositQuery || item.name.toLowerCase().includes(normalizedDepositQuery),
  );

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
    await clanQ.reload();
    await listQ.reload();
    await treasuryQ.reload();
    await inventoryQ.reload();
    await refreshUser();
  }

  if (clanQ.loading && !clan) return <Spinner label="正在查阅公会名册…" />;

  if (!clan) {
    return (
      <div className="page page-fit">
        <PageHeader
          eyebrow="公会"
          title="公会"
          actions={<Badge tone="muted">{clans.length} 个公会</Badge>}
        />
        {error ? <ErrorNotice message={error} /> : null}
        {notice ? <div className="notice notice-success">{notice}</div> : null}

        <div className="group-lobby">
          <Card className="group-create">
            <div className="eyebrow">创建公会</div>
            <h3>立下名号</h3>
            <p className="muted-text">仅字母和数字。</p>
            <div className="clan-create-form">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="公会名，例如：燃烬行会"
                maxLength={24}
              />
              <input
                value={tag}
                onChange={(event) => setTag(event.target.value.toUpperCase())}
                placeholder="标签，例如：ASH"
                maxLength={6}
              />
              <Button
                icon={Plus}
                loading={busy === "create"}
                disabled={name.trim().length < 2 || tag.trim().length < 2}
                onClick={() =>
                  act("create", async () => {
                    const data = await api.createClan(name.trim(), tag.trim());
                    clanQ.setData(data.clan);
                    await listQ.reload();
                    setNotice("公会已创建。");
                  })
                }
              >
                创建
              </Button>
            </div>
          </Card>

          <Card className="group-create">
            <div className="eyebrow">加入公会</div>
            <h3>凭标签入会</h3>
            <div className="inline-form">
              <input
                value={joinTag}
                onChange={(event) => setJoinTag(event.target.value.toUpperCase())}
                placeholder="例如：ASH"
                maxLength={6}
              />
              <Button
                icon={Castle}
                loading={busy === "join"}
                disabled={joinTag.trim().length < 2}
                onClick={() =>
                  act("join", async () => {
                    const data = await api.joinClan(joinTag.trim());
                    clanQ.setData(data.clan);
                    setNotice("已加入公会。");
                  })
                }
              >
                加入
              </Button>
            </div>
          </Card>
        </div>

        <section className="group-open">
          <div className="section-head">
            <h2>
              <Shield size={18} /> 已成立的公会
            </h2>
            <span className="muted-text">{clans.length} 个</span>
          </div>
          {clans.length > 0 ? (
            <div className="group-open-list">
              {clans.map((row) => (
                <div key={row.id} className="group-open-row">
                  <span className="group-open-icon">
                    <Castle size={18} />
                  </span>
                  <div className="group-open-main">
                    <strong>
                      {row.name} <span className="clan-tag">[{row.tag}]</span>
                    </strong>
                    <span>
                      会长 {row.leaderName} · {row.memberCount} 名成员
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Users}
                    loading={busy === `join-${row.id}`}
                    onClick={() =>
                      act(`join-${row.id}`, async () => {
                        const data = await api.joinClan(row.tag);
                        clanQ.setData(data.clan);
                        setNotice("已加入公会。");
                      })
                    }
                  >
                    加入
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Castle} title="还没有公会" text="成为第一个举起旗帜的人。" />
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={`[${clan.tag}]`}
        title={clan.name}
        description={`${clan.members.length} 名成员 · 会长 ${clan.members.find((member) => member.userId === clan.leaderUserId)?.username ?? "?"}`}
        actions={
          <div className="header-actions">
            <Badge tone="gold">
              <Castle size={13} /> 公会
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              icon={LogOut}
              loading={busy === "leave"}
              onClick={() =>
                act("leave", async () => {
                  await api.leaveClan();
                  await refresh();
                  setNotice("已离开公会。");
                })
              }
            >
              离开
            </Button>
            {isLeader ? (
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                loading={busy === "disband"}
                onClick={() =>
                  act("disband", async () => {
                    await api.disbandClan(clan.id);
                    await refresh();
                    setNotice("公会已解散。");
                  })
                }
              >
                解散
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}

      <Card>
        <div className="section-head compact">
          <h2>
            <Users size={17} /> 成员
          </h2>
          <span className="muted-text">{clan.members.length} 人</span>
        </div>
        <div className="group-member-list">
          {clan.members.map((member) => (
            <div key={member.userId} className="group-member-row">
              <span className="group-avatar">{member.username.slice(0, 1)}</span>
              <div className="group-member-main">
                <strong>
                  {member.username}
                  {member.role === "leader" ? <Crown size={13} className="inline-icon" /> : null}
                </strong>
                <span>{member.role === "leader" ? "会长" : "成员"}</span>
              </div>
              <Badge tone="muted">[{clan.tag}]</Badge>
              {member.userId === user?.id ? <Badge tone="gold">你</Badge> : null}
            </div>
          ))}
        </div>
      </Card>

      <Card className="clan-treasury-card">
        <div className="section-head compact">
          <h2>
            <Coins size={17} /> 公会金库
          </h2>
          <Gold amount={treasury?.gold ?? clan.gold} />
        </div>
        <p className="muted-text">成员可存入，会长可取用。</p>

        <div className="clan-treasury-actions">
          <label className="field">
            <span>金币数量</span>
            <input
              type="number"
              min={1}
              value={goldAmount}
              onChange={(event) => setGoldAmount(event.target.value)}
            />
            <small>你有 {user?.gold ?? 0} 金币</small>
          </label>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "deposit-gold"}
            disabled={Number(goldAmount) < 1}
            onClick={() =>
              act("deposit-gold", async () => {
                await api.depositClanGold(clan.id, Number(goldAmount));
                await refresh();
                setNotice("金币已存入公会金库。");
              })
            }
          >
            存入
          </Button>
          {isLeader ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "withdraw-gold"}
              disabled={Number(goldAmount) < 1 || (treasury?.gold ?? clan.gold) < Number(goldAmount)}
              onClick={() =>
                act("withdraw-gold", async () => {
                  await api.withdrawClanGold(clan.id, Number(goldAmount));
                  await refresh();
                  setNotice("金币已取出。");
                })
              }
            >
              取出
            </Button>
          ) : null}
        </div>

        <div className="section-head compact clan-treasury-sub">
          <h2>公会物品</h2>
          <span className="muted-text">{treasury?.items.length ?? 0} 件</span>
        </div>
        {treasury && treasury.items.length > 0 ? (
          <ListToolbar
            query={query}
            onQuery={setQuery}
            placeholder="搜索公会物品…"
            chips={[
              { value: "all" as const, label: "全部" },
              { value: "weapon" as const, label: "武器" },
              { value: "armor" as const, label: "护甲" },
              { value: "trinket" as const, label: "饰品" },
            ].map((entry) => ({ ...entry, count: slotCount(entry.value) }))}
            chip={slot}
            onChip={setSlot}
            count={`显示 ${treasuryItems.length} / ${treasury.items.length} 件（第 ${page}/${pageCount} 页）`}
            secondRow={
              <div className="hub-chips">
                {(["all", "common", "uncommon", "rare", "epic"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={"hub-chip" + (rarity === id ? " hub-chip-active" : "")}
                    onClick={() => setRarity(id)}
                  >
                    {id === "all" ? "全部品质" : { common: "普通", uncommon: "优良", rare: "稀有", epic: "史诗" }[id]}
                  </button>
                ))}
              </div>
            }
          />
        ) : null}
        {treasury && treasury.items.length > 0 ? (
          <>
          <div className="clan-treasury-items">
            {(slice as (typeof treasury.items)).map((entry) => (
              <ItemCard
                key={entry.id}
                item={entry.item}
                compact
                footerText={`由 ${entry.addedByName} 存入`}
                actions={
                  isLeader ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `withdraw-item-${entry.id}`}
                      onClick={() =>
                        act(`withdraw-item-${entry.id}`, async () => {
                          await api.withdrawClanItem(clan.id, entry.id);
                          await refresh();
                          setNotice("物品已取出到背包。");
                        })
                      }
                    >
                      取出
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
          <Pagination page={page} pageCount={pageCount} onPage={setPage} label={`共 ${treasuryItems.length} 件`} />
          </>
        ) : treasury && treasury.items.length > 0 ? (
          <p className="muted-text">当前筛选下没有物品。</p>
        ) : (
          <p className="muted-text">金库还没有物品。</p>
        )}

        {depositItems.length > 0 ? (
          <div className="inline-form clan-deposit-form">
            <label className="field">
              <span>筛选</span>
              <input
                value={depositQuery}
                onChange={(event) => setDepositQuery(event.target.value)}
                placeholder="搜索要存入的物品…"
              />
            </label>
            <select
              value={depositItemId}
              onChange={(event) => setDepositItemId(event.target.value)}
            >
              <option value="">选择要存入的物品…</option>
              {depositItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {ITEM_SLOT_LABELS[item.slot]}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "deposit-item"}
              disabled={!depositItemId}
              onClick={() =>
                act("deposit-item", async () => {
                  await api.depositClanItem(clan.id, depositItemId);
                  setDepositItemId("");
                  await refresh();
                  setNotice("物品已存入公会金库。");
                })
              }
            >
              存入物品
            </Button>
          </div>
        ) : null}

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        items={depositItems}
        selectedId={depositItemId}
        onSelect={(item) => setDepositItemId(item.id)}
        title="选择要存入的物品"
      />
      </Card>

      <Card className="group-rules clan-note">
        <Shield size={18} />
        <div>
          <strong>后续内容</strong>
          <p>公会仓库、公会战、公会任务与公会等级将在下一阶段接入。当前版本只提供身份与名册。</p>
        </div>
      </Card>
    </div>
  );
}
