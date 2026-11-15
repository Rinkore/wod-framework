import type {
  AuthUser,
  ArenaSeasonStateView,
  ArenaTeamBattleResultView,
  ArenaTeamEntry,
  ArenaTeamInput,
  ArenaTeamSeasonStateView,
  ArenaTeamView,
  ArenaOpponentView,
  ClaimTeamSeasonRewardsView,
  AuctionDetailView,
  AuctionListingView,
  ClaimSeasonRewardsView,
  ContentPack,
  DeathRosterView,
  DispatchInput,
  HeroDraftView,
  LotteryStateView,
  ArenaEntry,
  ChatMessageView,
  ClanSummary,
  ClanTreasuryItemView,
  ClanView,
  DuelResultView,
  DuelSide,
  EquipResultView,
  ExpeditionView,
  FriendSearchResult,
  FriendsView,
  GroupSummary,
  GroupView,
  GroupVisibility,
  HeroCombatSettings,
  HeroPresetView,
  HeroTitlesView,
  HeroView,
  ItemView,
  LeaderboardEntry,
  MarketListingView,
  PersonalMazeRegionView,
  Position,
  QuestView,
  UnequipResultView,
  WeaponType,
} from "@wod/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("wod:unauthorized"));
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      `请求失败（${response.status}）`;
    const code = (payload as { error?: { code?: string } } | null)?.error?.code;
    throw new ApiError(response.status, message, code);
  }

  return payload as T;
}

export interface HeroesResponse {
  heroes: HeroView[];
}
export interface HeroResponse {
  hero: HeroView;
}
export interface ItemsResponse {
  items: ItemView[];
}
export interface ExpeditionsResponse {
  expeditions: ExpeditionView[];
}
export interface ExpeditionResponse {
  expedition: ExpeditionView;
}
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
}

export const api = {
  me: () => request<{ user: AuthUser }>("GET", "/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: AuthUser }>("POST", "/auth/login", { username, password }),
  register: (username: string, password: string) =>
    request<{ user: AuthUser }>("POST", "/auth/register", { username, password }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  content: () => request<{ content: ContentPack }>("GET", "/content"),

  heroes: () => request<HeroesResponse>("GET", "/heroes"),
  hero: (id: string) => request<HeroResponse>("GET", `/heroes/${id}`),
  presets: () => request<{ presets: HeroPresetView[] }>("GET", "/heroes/presets"),
  heroPresets: (heroId: string) =>
    request<{ presets: HeroPresetView[] }>("GET", `/heroes/${heroId}/presets`),
  createPreset: (
    heroId: string,
    input: { name: string; position: Position; settings?: HeroCombatSettings },
  ) => request<{ preset: HeroPresetView }>("POST", `/heroes/${heroId}/presets`, input),
  updatePreset: (
    heroId: string,
    presetId: string,
    input: { name?: string; position?: Position; settings?: HeroCombatSettings },
  ) =>
    request<{ preset: HeroPresetView }>(
      "PATCH",
      `/heroes/${heroId}/presets/${presetId}`,
      input,
    ),
  deletePreset: (heroId: string, presetId: string) =>
    request<{ ok: true }>("DELETE", `/heroes/${heroId}/presets/${presetId}`),
  setDefaultPreset: (heroId: string, presetId: string) =>
    request<{ preset: HeroPresetView }>(
      "POST",
      `/heroes/${heroId}/presets/${presetId}/default`,
    ),
  createHero: (input: {
    name: string;
    raceId: string;
    weaponType: WeaponType;
    draftId: string;
  }) => request<HeroResponse>("POST", "/heroes", input),
  heroDraft: () => request<{ draft: HeroDraftView }>("GET", "/heroes/draft"),
  rerollHeroDraft: () => request<{ draft: HeroDraftView }>("POST", "/heroes/draft/reroll"),
  deathRoster: () => request<DeathRosterView>("GET", "/heroes/death-roster"),
  deleteHero: (heroId: string, confirmName: string) =>
    request<{ user: AuthUser }>("POST", `/heroes/${heroId}/delete`, { confirmName }),
  reviveHero: (heroId: string, token: "pardon" | "redemption") =>
    request<{ hero: HeroView }>("POST", `/heroes/${heroId}/revive`, { token }),
  lottery: (page = 1) => request<LotteryStateView>("GET", `/lottery?page=${page}`),
  enterLottery: (count: number) => request<{ entered: number; periodNumber: number }>("POST", "/lottery/enter", { count }),
  exchangeLegacyManual: () => request<{ ok: true }>("POST", "/lottery/exchange-manual"),
  useLegacyManual: (heroId: string) => request<{ ok: true }>("POST", "/lottery/use-manual", { heroId }),
  redeemTicket: (ticketId: string) =>
    request<{ gold: number; prize: string | null }>("POST", `/lottery/${ticketId}/redeem`),
  train: (heroId: string, key: string) =>
    request<{ hero: HeroView; user: AuthUser; cost: { ep: number; gold: number } }>(
      "POST",
      `/heroes/${heroId}/train`,
      { target: "skill", key },
    ),
  trainBatch: (
    heroId: string,
    input: { skills?: Record<string, number>; unlocks?: string[] },
  ) =>
    request<{
      hero: HeroView;
      user: AuthUser;
      cost: { ep: number; gold: number; freePoints: number; skillPoints: number };
    }>("POST", `/heroes/${heroId}/train/batch`, input),
  heroTitles: (heroId: string) =>
    request<HeroTitlesView>("GET", `/heroes/${heroId}/titles`),
  setHeroTitle: (heroId: string, titleId: string | null) =>
    request<{ hero: HeroView }>("POST", `/heroes/${heroId}/title`, { titleId }),

  quests: () => request<{ quests: QuestView[] }>("GET", "/quests"),
  claimQuest: (questId: string, heroId?: string) =>
    request<{ quest: QuestView; user: AuthUser; hero: HeroView }>(
      "POST",
      `/quests/${questId}/claim`,
      heroId ? { heroId } : {},
    ),
  equip: (heroId: string, itemId: string) =>
    request<EquipResultView>("POST", `/heroes/${heroId}/equip`, { itemId }),
  unequip: (heroId: string, slot: "weapon" | "armor" | "trinket") =>
    request<UnequipResultView>("POST", `/heroes/${heroId}/unequip`, { slot }),

  inventory: () => request<ItemsResponse>("GET", "/inventory"),
  sell: (itemId: string) =>
    request<{ gold: number; price: number; item: ItemView }>("POST", `/inventory/${itemId}/sell`),

  activeExpeditions: () => request<ExpeditionsResponse>("GET", "/expeditions/active"),
  unreadExpeditions: () =>
    request<{ expeditions: ExpeditionView[]; count: number }>("GET", "/expeditions/unread"),
  expeditions: (limit = 20) =>
    request<ExpeditionsResponse>("GET", `/expeditions?limit=${limit}`),
  expedition: (id: string) => request<ExpeditionResponse>("GET", `/expeditions/${id}`),
  markExpeditionRead: (id: string) =>
    request<{ ok: true }>("POST", `/expeditions/${id}/read`),
  dispatch: (input: DispatchInput) =>
    request<ExpeditionResponse>("POST", "/expeditions", input),

  leaderboard: () => request<LeaderboardResponse>("GET", "/leaderboard"),

  market: (mine = false) =>
    request<{ listings: MarketListingView[] }>("GET", `/market${mine ? "?mine=1" : ""}`),
  listMarketItem: (itemId: string, price: number) =>
    request<{ listing: MarketListingView }>("POST", "/market/list", { itemId, price }),
  buyListing: (id: string) =>
    request<{ item: ItemView; gold: number; price: number; fee: number }>(
      "POST",
      `/market/${id}/buy`,
    ),
  cancelListing: (id: string) =>
    request<{ item: ItemView }>("POST", `/market/${id}/cancel`),

  auctions: (mine = false) =>
    request<{ auctions: AuctionListingView[] }>(
      "GET",
      `/auctions${mine ? "?mine=1" : ""}`,
    ),
  auction: (id: string) =>
    request<AuctionDetailView>("GET", `/auctions/${id}`),
  listAuctionItem: (input: {
    itemId: string;
    startPrice: number;
    buyoutPrice?: number;
    durationHours: number;
  }) =>
    request<{ auction: AuctionListingView }>("POST", "/auctions/list", input),
  bidAuction: (id: string, amount: number) =>
    request<{ auction: AuctionListingView; gold: number }>(
      "POST",
      `/auctions/${id}/bid`,
      { amount },
    ),
  buyoutAuction: (id: string) =>
    request<{
      auction: AuctionListingView;
      item: ItemView;
      gold: number;
      price: number;
      fee: number;
    }>("POST", `/auctions/${id}/buyout`),
  cancelAuction: (id: string) =>
    request<{ auction: AuctionListingView; item: ItemView }>(
      "POST",
      `/auctions/${id}/cancel`,
    ),

  myClan: () => request<{ clan: ClanView | null }>("GET", "/clans/mine"),
  clans: () => request<{ clans: ClanSummary[] }>("GET", "/clans"),
  createClan: (name: string, tag: string) =>
    request<{ clan: ClanView }>("POST", "/clans", { name, tag }),
  joinClan: (tag: string) => request<{ clan: ClanView }>("POST", "/clans/join", { tag }),
  leaveClan: () => request<{ ok: true }>("POST", "/clans/leave"),
  disbandClan: (clanId: string) =>
    request<{ ok: true }>("POST", `/clans/${clanId}/disband`),
  clanTreasury: (clanId: string) =>
    request<{ gold: number; items: ClanTreasuryItemView[] }>(
      "GET",
      `/clans/${clanId}/treasury`,
    ),
  depositClanGold: (clanId: string, amount: number) =>
    request<{ gold: number; items: ClanTreasuryItemView[] }>(
      "POST",
      `/clans/${clanId}/gold/deposit`,
      { amount },
    ),
  withdrawClanGold: (clanId: string, amount: number) =>
    request<{ gold: number; items: ClanTreasuryItemView[] }>(
      "POST",
      `/clans/${clanId}/gold/withdraw`,
      { amount },
    ),
  depositClanItem: (clanId: string, itemId: string) =>
    request<{ gold: number; items: ClanTreasuryItemView[] }>(
      "POST",
      `/clans/${clanId}/items/deposit`,
      { itemId },
    ),
  withdrawClanItem: (clanId: string, itemId: string) =>
    request<{ gold: number; items: ClanTreasuryItemView[] }>(
      "POST",
      `/clans/${clanId}/items/${itemId}/withdraw`,
    ),

  arenaTeam: () => request<{ team: ArenaTeamView | null }>("GET", "/colosseum/team"),
  saveArenaTeam: (input: ArenaTeamInput) =>
    request<{ team: ArenaTeamView }>("POST", "/colosseum/team", input),
  arenaTeamOpponents: () =>
    request<{ opponents: ArenaOpponentView[] }>("GET", "/colosseum/team/opponents"),
  challengeArenaTeam: (opponentTeamId: string) =>
    request<{ battle: ArenaTeamBattleResultView }>("POST", "/colosseum/team/challenge", {
      opponentTeamId,
    }),
  arenaTeamHistory: () =>
    request<{ battles: ArenaTeamBattleResultView[] }>("GET", "/colosseum/team/history"),
  arenaTeamLeaderboard: () =>
    request<{ entries: ArenaTeamEntry[] }>("GET", "/colosseum/team/leaderboard"),
  arenaTeamSeason: () => request<ArenaTeamSeasonStateView>("GET", "/colosseum/team/season"),
  claimArenaTeamSeasonRewards: () =>
    request<ClaimTeamSeasonRewardsView>("POST", "/colosseum/team/season/claim"),

  duelOpponents: () => request<{ opponents: DuelSide[] }>("GET", "/colosseum/opponents"),
  duel: (heroId: string, opponentHeroId: string) =>
    request<{ duel: DuelResultView }>("POST", "/colosseum/duel", {
      heroId,
      opponentHeroId,
    }),
  duelHistory: () => request<{ duels: DuelResultView[] }>("GET", "/colosseum/history"),
  arenaLeaderboard: () => request<{ entries: ArenaEntry[] }>("GET", "/colosseum/leaderboard"),
  arenaSeason: () => request<ArenaSeasonStateView>("GET", "/colosseum/season"),
  claimSeasonRewards: () =>
    request<ClaimSeasonRewardsView>("POST", "/colosseum/season/claim"),

  chat: (channel: ChatMessageView["channel"], groupId?: string) => {
    const query = new URLSearchParams({ channel });
    if (groupId) query.set("groupId", groupId);
    return request<{ messages: ChatMessageView[] }>("GET", `/chat?${query}`);
  },
  sendChat: (
    channel: ChatMessageView["channel"],
    message: string,
    groupId?: string,
  ) =>
    request<{ message: ChatMessageView }>("POST", "/chat", {
      channel,
      message,
      ...(groupId ? { groupId } : {}),
    }),

  myGroup: () => request<{ group: GroupView | null }>("GET", "/groups/mine"),
  openGroups: () => request<{ groups: GroupSummary[] }>("GET", "/groups/open"),
  createGroup: (name: string, visibility: GroupVisibility) =>
    request<{ group: GroupView }>("POST", "/groups", { name, visibility }),
  friends: () => request<FriendsView>("GET", "/friends"),
  searchUsers: (query: string) =>
    request<{ users: FriendSearchResult[] }>(
      "GET",
      `/friends/search?q=${encodeURIComponent(query)}`,
    ),
  sendFriendRequest: (username: string) =>
    request<FriendsView>("POST", "/friends/request", { username }),
  acceptFriendRequest: (requestId: string) =>
    request<FriendsView>("POST", `/friends/${requestId}/accept`),
  declineFriendRequest: (requestId: string) =>
    request<FriendsView>("POST", `/friends/${requestId}/decline`),
  cancelFriendRequest: (requestId: string) =>
    request<FriendsView>("POST", `/friends/${requestId}/cancel`),
  removeFriend: (userId: string) =>
    request<FriendsView>("DELETE", `/friends/${userId}`),
  joinGroup: (code: string) => request<{ group: GroupView }>("POST", "/groups/join", { code }),
  joinGroupById: (groupId: string) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/join`),
  leaveGroup: (groupId: string) =>
    request<{ ok: true }>("POST", `/groups/${groupId}/leave`),
  addGroupHero: (groupId: string, heroId: string, position: Position) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/heroes`, { heroId, position }),
  removeGroupHero: (groupId: string, heroId: string) =>
    request<{ group: GroupView }>("DELETE", `/groups/${groupId}/heroes/${heroId}`),
  removeGroupMember: (groupId: string, memberId: string) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/members/${memberId}/remove`),
  setGroupHeroSettings: (
    groupId: string,
    heroId: string,
    settings: HeroCombatSettings,
  ) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/hero-settings`, {
      heroId,
      settings,
    }),
  setGroupPosition: (
    groupId: string,
    heroId: string,
    position: Position,
    presetId?: string | null,
  ) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/position`, {
      heroId,
      position,
      presetId,
    }),
  queueGroupExpedition: (
    groupId: string,
    input: { dungeonId: string; roomPath?: string[] },
  ) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/queue`, input),
  cancelGroupQueue: (groupId: string) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/queue/cancel`),
  setMemberReady: (groupId: string) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/ready`),
  declineQueue: (groupId: string) =>
    request<{ group: GroupView }>("POST", `/groups/${groupId}/decline`),
  startGroupExpedition: (groupId: string) =>
    request<{ expeditionId: string }>("POST", `/groups/${groupId}/start`),
  disbandGroup: (groupId: string) =>
    request<{ ok: true }>("POST", `/groups/${groupId}/disband`),

  personalMaze: () =>
    request<{ regions: PersonalMazeRegionView[] }>("GET", "/dungeons/personal"),
  expandPersonalMaze: (seriesId: string) =>
    request<{ region: PersonalMazeRegionView }>("POST", "/dungeons/personal/expand", { seriesId }),
  dungeonPreferences: () =>
    request<{ preferences: Record<string, string[]> }>("GET", "/dungeons/preferences"),
  dungeonUnlocks: () =>
    request<{ unlocks: Record<string, number> }>("GET", "/dungeons/unlocks"),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "发生未知错误";
}
