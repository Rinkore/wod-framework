import { createHash, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { ZodType } from "zod";
import {
  auctionBidInputSchema,
  auctionListInputSchema,
  arenaChallengeInputSchema,
  arenaTeamInputSchema,
  chatInputSchema,
  claimQuestInputSchema,
  clanGoldInputSchema,
  clanItemInputSchema,
  createClanInputSchema,
  createGroupInputSchema,
  createHeroInputSchema,
  heroDeleteInputSchema,
  reviveHeroInputSchema,
  dispatchInputSchema,
  duelInputSchema,
  friendRequestInputSchema,
  groupHeroInputSchema,
  groupHeroSettingsInputSchema,
  groupPositionInputSchema,
  groupStartInputSchema,
  joinGroupInputSchema,
  equipInputSchema,
  heroPresetInputSchema,
  heroPresetParamsSchema,
  heroPresetUpdateSchema,
  idParamSchema,
  personalMazeExpandInputSchema,
  lotteryEnterInputSchema,
  lotteryUseManualInputSchema,
  joinClanInputSchema,
  loginInputSchema,
  marketListInputSchema,
  registerInputSchema,
  selectTitleInputSchema,
  queueGroupInputSchema,
  trainBatchInputSchema,
  trainInputSchema,
  unequipInputSchema,
} from "@wod/shared";
import {
  authRateLimit,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from "./auth.js";
import { ALLOW_SHARED_IP, PREMIUM_DEFAULT, STARTING_GOLD } from "./config.js";
import { content } from "./content.js";
import { db } from "./db.js";
import { badRequest, conflict, unauthorized } from "./errors.js";
import { settleDueForUser } from "./settlement.js";
import {
  createHero,
  createHeroDraft,
  rerollHeroDraft,
  deathRoster,
  deleteHero,
  equipItem,
  getHeroRow,
  listHeroes,
  listInventory,
  reviveHero,
  sellItem,
  trainHero,
  trainHeroBatch,
  unequipItem,
} from "./services/heroes.js";
import { lotteryState, redeemTicket, enterLottery, exchangeLegacyManual, useLegacyManual } from "./services/lottery.js";
import { expandPersonalMaze, listPersonalMazeRegions } from "./services/personal-maze.js";
import {
  activeExpeditions,
  getExpedition,
  listDungeonRoutePreferences,
  listDungeonUnlocks,
  listExpeditions,
  markExpeditionRead,
  startExpedition,
  unreadExpeditions,
} from "./services/expeditions.js";
import { buyListing, cancelListing, listItem, listMarket } from "./services/market.js";
import {
  buyoutAuction,
  cancelAuction,
  getAuction,
  listAuctions,
  listAuctionItem,
  placeBid,
} from "./services/auctions.js";
import {
  createClan,
  disbandClan,
  depositClanGold,
  depositClanItem,
  getClanTreasury,
  getMyClan,
  joinClan,
  leaveClan,
  listClans,
  withdrawClanGold,
  withdrawClanItem,
} from "./services/clans.js";
import { arenaLeaderboard, duelHistory, fightDuel, listOpponents } from "./services/duels.js";
import {
  arenaTeamHistory,
  arenaTeamLeaderboard,
  fightArena,
  getArenaTeam,
  listArenaOpponents,
  saveArenaTeam,
} from "./services/arena.js";
import {
  arenaTeamSeasonState,
  claimArenaTeamSeasonRewards,
} from "./services/arena-seasons.js";
import { arenaSeasonState, claimSeasonRewards } from "./services/seasons.js";
import { listChat, sendChat } from "./services/chat.js";
import {
  createPreset,
  deletePreset,
  listHeroPresets,
  listPresets,
  setDefaultPreset,
  updatePreset,
} from "./services/presets.js";
import {
  claimQuest,
  heroTitlesView,
  listQuests,
  setActiveTitle,
} from "./services/quests.js";
import {
  addGroupHero,
  createGroup,
  currentGroupRow,
  disbandGroup,
  getMyGroup,
  groupExpeditionView,
  groupView,
  joinGroup,
  joinGroupById,
  leaveGroup,
  listOpenGroups,
  removeGroupHero,
  removeGroupMember,
  setGroupHeroPosition,
  setGroupHeroSettings,
  startGroupExpedition,
  queueGroupExpedition,
  cancelGroupQueue,
  setMemberReady,
  declineQueue,
} from "./services/groups.js";
import {
  cancelFriendRequest,
  friendsView,
  removeFriend,
  respondFriendRequest,
  searchUsers,
  sendFriendRequest,
} from "./services/friends.js";
import type { UserRow } from "./types.js";
import { authUserView, getLeaderboard, heroRowToView } from "./views.js";

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

function handle(fn: Handler): Handler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function parseBody<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw badRequest(result.error.issues[0]?.message ?? "请求参数有误");
  }
  return result.data;
}

function parseParams<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.params);
  if (!result.success) throw badRequest("路径参数有误");
  return result.data;
}

function currentUser(req: Request): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * 用哈希保存注册网络标识，避免把原始 IP 写入存档。
 * 仅用于执行“一人一号”的默认注册限制。
 */
function registrationIpHash(req: Request): string | null {
  const raw = req.ip ?? req.socket.remoteAddress;
  if (!raw) return null;
  const normalized = raw.replace(/^::ffff:/i, "");
  // 让 localhost / 127.0.0.1 视为同一个注册网络。
  const key = normalized === "::1" ? "127.0.0.1" : normalized;
  return createHash("sha256").update(key).digest("hex");
}

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    content: { name: content.name, version: content.version, id: content.id },
  });
});

publicRouter.get("/content", (_req, res) => {
  res.json({ content });
});

const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimit,
  handle((req, res) => {
    const input = parseBody(registerInputSchema, req);
    const existing = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(input.username) as unknown as { id: string } | undefined;
    if (existing) throw conflict("用户名已被使用");

    const ipHash = registrationIpHash(req);
    if (!ALLOW_SHARED_IP && ipHash) {
      const existingNetwork = db
        .prepare("SELECT id FROM users WHERE registration_ip_hash = ?")
        .get(ipHash) as unknown as { id: string } | undefined;
      if (existingNetwork) {
        throw conflict(
          "同一网络下只能注册一个账号。若为多人共用网络，请让管理员开启共享网络模式。",
          "account_exists_for_network",
        );
      }
    }

    const id = randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, gold, premium, registration_ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      input.username,
      hashPassword(input.password),
      STARTING_GOLD,
      PREMIUM_DEFAULT ? 1 : 0,
      ipHash,
      now,
    );

    const token = createSession(id);
    setSessionCookie(res, token);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow;
    res.status(201).json({ user: authUserView(user) });
  }),
);

authRouter.post(
  "/login",
  authRateLimit,
  handle((req, res) => {
    const input = parseBody(loginInputSchema, req);
    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(input.username) as unknown as UserRow | undefined;
    if (!user || !verifyPassword(input.password, user.password_hash)) {
      throw unauthorized("用户名或密码错误");
    }
    const token = createSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: authUserView(user) });
  }),
);

authRouter.post(
  "/logout",
  handle((req, res) => {
    destroySession(req);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireUser,
  handle((req, res) => {
    const user = currentUser(req);
    settleDueForUser(user.id);
    const fresh = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(user.id) as unknown as UserRow;
    res.json({ user: authUserView(fresh) });
  }),
);

const heroesRouter = Router();
heroesRouter.use(requireUser);
heroesRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

heroesRouter.get(
  "/",
  handle((req, res) => {
    res.json({ heroes: listHeroes(currentUser(req).id) });
  }),
);

heroesRouter.post(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(createHeroInputSchema, req);
    res.status(201).json({ hero: createHero(user.id, input) });
  }),
);

heroesRouter.get(
  "/presets",
  handle((req, res) => {
    res.json({ presets: listPresets(currentUser(req).id) });
  }),
);

heroesRouter.get(
  "/draft",
  handle((req, res) => {
    res.json({ draft: createHeroDraft(currentUser(req).id) });
  }),
);

heroesRouter.post(
  "/draft/reroll",
  handle((req, res) => {
    res.json({ draft: rerollHeroDraft(currentUser(req).id) });
  }),
);

heroesRouter.get(
  "/death-roster",
  handle((req, res) => {
    res.json(deathRoster(currentUser(req).id));
  }),
);

heroesRouter.post(
  "/:id/delete",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(heroDeleteInputSchema, req);
    res.json(deleteHero(user.id, id, input.confirmName));
  }),
);

heroesRouter.post(
  "/:id/revive",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(reviveHeroInputSchema, req);
    res.json(reviveHero(user.id, id, input.token));
  }),
);

heroesRouter.get(
  "/:id",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json({ hero: heroRowToView(getHeroRow(user.id, id)) });
  }),
);

heroesRouter.get(
  "/:id/presets",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json({ presets: listHeroPresets(user.id, id) });
  }),
);

heroesRouter.post(
  "/:id/presets",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(heroPresetInputSchema, req);
    res.status(201).json({ preset: createPreset(user.id, id, input) });
  }),
);

heroesRouter.patch(
  "/:id/presets/:presetId",
  handle((req, res) => {
    const user = currentUser(req);
    const { id, presetId } = parseParams(heroPresetParamsSchema, req);
    const input = parseBody(heroPresetUpdateSchema, req);
    res.json({ preset: updatePreset(user.id, id, presetId, input) });
  }),
);

heroesRouter.delete(
  "/:id/presets/:presetId",
  handle((req, res) => {
    const user = currentUser(req);
    const { id, presetId } = parseParams(heroPresetParamsSchema, req);
    deletePreset(user.id, id, presetId);
    res.json({ ok: true });
  }),
);

heroesRouter.post(
  "/:id/presets/:presetId/default",
  handle((req, res) => {
    const user = currentUser(req);
    const { id, presetId } = parseParams(heroPresetParamsSchema, req);
    res.json({ preset: setDefaultPreset(user.id, id, presetId) });
  }),
);

heroesRouter.get(
  "/:id/titles",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(heroTitlesView(user.id, id));
  }),
);

heroesRouter.post(
  "/:id/title",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(selectTitleInputSchema, req);
    res.json({ hero: setActiveTitle(user.id, id, input.titleId) });
  }),
);

heroesRouter.post(
  "/:id/train",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(trainInputSchema, req);
    res.json(trainHero(user.id, id, input));
  }),
);

heroesRouter.post(
  "/:id/train/batch",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(trainBatchInputSchema, req);
    res.json(trainHeroBatch(user.id, id, input));
  }),
);

heroesRouter.post(
  "/:id/equip",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(equipInputSchema, req);
    res.json(equipItem(user.id, id, input.itemId));
  }),
);

heroesRouter.post(
  "/:id/unequip",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(unequipInputSchema, req);
    res.json(unequipItem(user.id, id, input.slot));
  }),
);

const inventoryRouter = Router();
inventoryRouter.use(requireUser);
inventoryRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

inventoryRouter.get(
  "/",
  handle((req, res) => {
    res.json({ items: listInventory(currentUser(req).id) });
  }),
);

inventoryRouter.post(
  "/:id/sell",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(sellItem(user.id, id));
  }),
);

const expeditionsRouter = Router();
expeditionsRouter.use(requireUser);
expeditionsRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

expeditionsRouter.get(
  "/active",
  handle((req, res) => {
    res.json({ expeditions: activeExpeditions(currentUser(req).id) });
  }),
);

expeditionsRouter.get(
  "/",
  handle((req, res) => {
    const limit = Number(req.query.limit ?? 20);
    res.json({
      expeditions: listExpeditions(currentUser(req).id, Number.isFinite(limit) ? limit : 20),
    });
  }),
);

expeditionsRouter.get(
  "/unread",
  handle((req, res) => {
    const expeditions = unreadExpeditions(currentUser(req).id);
    res.json({ expeditions, count: expeditions.length });
  }),
);

expeditionsRouter.post(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(dispatchInputSchema, req);
    res.status(201).json({ expedition: startExpedition(user.id, input) });
  }),
);

expeditionsRouter.get(
  "/:id",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json({ expedition: getExpedition(user.id, id) });
  }),
);

expeditionsRouter.post(
  "/:id/read",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    markExpeditionRead(user.id, id);
    res.json({ ok: true });
  }),
);

const questsRouter = Router();
questsRouter.use(requireUser);
questsRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

questsRouter.get(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    res.json({ quests: listQuests(user.id) });
  }),
);

questsRouter.post(
  "/:id/claim",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(claimQuestInputSchema, req);
    res.json(claimQuest(user.id, id, input.heroId));
  }),
);

const leaderboardRouter = Router();
leaderboardRouter.use(requireUser);
leaderboardRouter.get(
  "/",
  handle((_req, res) => {
    res.json({ entries: getLeaderboard(50) });
  }),
);

const friendsRouter = Router();
friendsRouter.use(requireUser);

friendsRouter.get(
  "/",
  handle((req, res) => {
    res.json(friendsView(currentUser(req).id));
  }),
);

friendsRouter.get(
  "/search",
  handle((req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ users: searchUsers(currentUser(req).id, query) });
  }),
);

friendsRouter.post(
  "/request",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(friendRequestInputSchema, req);
    res.json(sendFriendRequest(user.id, input.username));
  }),
);

friendsRouter.post(
  "/:id/accept",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(respondFriendRequest(user.id, id, true));
  }),
);

friendsRouter.post(
  "/:id/decline",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(respondFriendRequest(user.id, id, false));
  }),
);

friendsRouter.post(
  "/:id/cancel",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(cancelFriendRequest(user.id, id));
  }),
);

friendsRouter.delete(
  "/:userId",
  handle((req, res) => {
    const user = currentUser(req);
    const friendUserId = String(req.params.userId ?? "");
    if (!friendUserId) throw badRequest("缺少账号编号");
    res.json(removeFriend(user.id, friendUserId));
  }),
);

const groupsRouter = Router();
groupsRouter.use(requireUser);
groupsRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

groupsRouter.get(
  "/mine",
  handle((req, res) => {
    res.json({ group: getMyGroup(currentUser(req).id) });
  }),
);

groupsRouter.get(
  "/open",
  handle((req, res) => {
    res.json({ groups: listOpenGroups(currentUser(req).id) });
  }),
);

groupsRouter.post(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(createGroupInputSchema, req);
    res.status(201).json({
      group: createGroup(user.id, input.name, input.visibility),
    });
  }),
);

groupsRouter.post(
  "/join",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(joinGroupInputSchema, req);
    res.json({ group: joinGroup(user.id, input.code) });
  }),
);

groupsRouter.post(
  "/:id/join",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json({ group: joinGroupById(user.id, id) });
  }),
);

groupsRouter.post(
  "/:id/leave",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    leaveGroup(user.id);
    res.json({ ok: true, groupId: id });
  }),
);

groupsRouter.post(
  "/:id/members/:memberId/remove",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const memberId = String(req.params.memberId ?? "");
    if (!memberId) throw badRequest("缺少成员编号");
    res.json({ group: removeGroupMember(user.id, id, memberId) });
  }),
);

groupsRouter.post(
  "/:id/heroes",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(groupHeroInputSchema, req);
    res.json({ group: addGroupHero(user.id, id, input.heroId, input.position ?? "front") });
  }),
);

groupsRouter.delete(
  "/:id/heroes/:heroId",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const heroId = String(req.params.heroId ?? "");
    if (!heroId) throw badRequest("缺少英雄编号");
    res.json({ group: removeGroupHero(user.id, id, heroId) });
  }),
);

groupsRouter.post(
  "/:id/position",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(groupPositionInputSchema, req);
    res.json({
      group: setGroupHeroPosition(
        user.id,
        id,
        input.heroId,
        input.position,
        input.presetId,
      ),
    });
  }),
);

groupsRouter.post(
  "/:id/hero-settings",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(groupHeroSettingsInputSchema, req);
    res.json({
      group: setGroupHeroSettings(user.id, id, input.heroId, input.settings),
    });
  }),
);

groupsRouter.post(
  "/:id/queue",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(queueGroupInputSchema, req);
    res.json({ group: queueGroupExpedition(user.id, id, input) });
  }),
);

groupsRouter.post(
  "/:id/queue/cancel",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json({ group: cancelGroupQueue(user.id, id) });
  }),
);

groupsRouter.post(
  "/:id/ready",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json({ group: setMemberReady(user.id, id) });
  }),
);

groupsRouter.post(
  "/:id/decline",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json({ group: declineQueue(user.id, id) });
  }),
);

groupsRouter.post(
  "/:id/start",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.status(201).json(startGroupExpedition(user.id, id));
  }),
);

groupsRouter.post(
  "/:id/disband",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    disbandGroup(user.id, id);
    res.json({ ok: true });
  }),
);

groupsRouter.get(
  "/:id/expedition",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json({ expedition: groupExpeditionView(user.id, id) });
  }),
);

const clansRouter = Router();
clansRouter.use(requireUser);
clansRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

clansRouter.get(
  "/mine",
  handle((req, res) => {
    res.json({ clan: getMyClan(currentUser(req).id) });
  }),
);

clansRouter.get(
  "/",
  handle((_req, res) => {
    res.json({ clans: listClans() });
  }),
);

clansRouter.post(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(createClanInputSchema, req);
    res.status(201).json({ clan: createClan(user.id, input.name, input.tag) });
  }),
);

clansRouter.post(
  "/join",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(joinClanInputSchema, req);
    res.json({ clan: joinClan(user.id, input.tag) });
  }),
);

clansRouter.post(
  "/leave",
  handle((req, res) => {
    leaveClan(currentUser(req).id);
    res.json({ ok: true });
  }),
);

clansRouter.get(
  "/:id/treasury",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(getClanTreasury(user.id, id));
  }),
);

clansRouter.post(
  "/:id/gold/deposit",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(clanGoldInputSchema, req);
    res.json(depositClanGold(user.id, id, input.amount));
  }),
);

clansRouter.post(
  "/:id/gold/withdraw",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(clanGoldInputSchema, req);
    res.json(withdrawClanGold(user.id, id, input.amount));
  }),
);

clansRouter.post(
  "/:id/items/deposit",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(clanItemInputSchema, req);
    res.json(depositClanItem(user.id, id, input.itemId));
  }),
);

clansRouter.post(
  "/:id/items/:itemId/withdraw",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const itemId = String(req.params.itemId ?? "");
    if (!itemId) throw badRequest("缺少物品编号");
    res.json(withdrawClanItem(user.id, id, itemId));
  }),
);

clansRouter.post(
  "/:id/disband",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    disbandClan(user.id, id);
    res.json({ ok: true });
  }),
);

const colosseumRouter = Router();
colosseumRouter.use(requireUser);
colosseumRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

colosseumRouter.get(
  "/team",
  handle((req, res) => {
    res.json({ team: getArenaTeam(currentUser(req).id) });
  }),
);

const saveTeamHandler: Handler = (req, res) => {
  const input = parseBody(arenaTeamInputSchema, req);
  res.json({ team: saveArenaTeam(currentUser(req).id, input) });
};

colosseumRouter.put("/team", handle(saveTeamHandler));
colosseumRouter.post("/team", handle(saveTeamHandler));

colosseumRouter.get(
  "/team/opponents",
  handle((req, res) => {
    res.json({ opponents: listArenaOpponents(currentUser(req).id) });
  }),
);

colosseumRouter.post(
  "/team/challenge",
  handle((req, res) => {
    const input = parseBody(arenaChallengeInputSchema, req);
    res.json({ battle: fightArena(currentUser(req).id, input.opponentTeamId) });
  }),
);

// Keep legacy routes intact while exposing the new team arena under the old client path.
colosseumRouter.get(
  "/opponents",
  handle((req, res) => {
    res.json({ opponents: listOpponents(currentUser(req).id) });
  }),
);

colosseumRouter.post(
  "/duel",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(duelInputSchema, req);
    res.json({ duel: fightDuel(user.id, input.heroId, input.opponentHeroId) });
  }),
);

colosseumRouter.get(
  "/leaderboard",
  handle((req, res) => {
    const team = getArenaTeam(currentUser(req).id);
    res.json({ entries: team ? arenaTeamLeaderboard() : arenaLeaderboard() });
  }),
);

colosseumRouter.get(
  "/team/leaderboard",
  handle((_req, res) => {
    res.json({ entries: arenaTeamLeaderboard() });
  }),
);

colosseumRouter.get(
  "/history",
  handle((req, res) => {
    const user = currentUser(req);
    res.json({ duels: getArenaTeam(user.id) ? arenaTeamHistory(user.id) : duelHistory(user.id) });
  }),
);

colosseumRouter.get(
  "/team/history",
  handle((req, res) => {
    res.json({ battles: arenaTeamHistory(currentUser(req).id) });
  }),
);

colosseumRouter.get(
  "/season",
  handle((req, res) => {
    const user = currentUser(req);
    res.json(getArenaTeam(user.id) ? arenaTeamSeasonState(user.id) : arenaSeasonState(user.id));
  }),
);

colosseumRouter.get(
  "/team/season",
  handle((req, res) => {
    res.json(arenaTeamSeasonState(currentUser(req).id));
  }),
);

colosseumRouter.post(
  "/season/claim",
  handle((req, res) => {
    const user = currentUser(req);
    res.json(getArenaTeam(user.id) ? claimArenaTeamSeasonRewards(user.id) : claimSeasonRewards(user.id));
  }),
);

colosseumRouter.post(
  "/team/season/claim",
  handle((req, res) => {
    res.json(claimArenaTeamSeasonRewards(currentUser(req).id));
  }),
);

const chatRouter = Router();
chatRouter.use(requireUser);

chatRouter.get(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    const channel =
      req.query.channel === "clan"
        ? "clan"
        : req.query.channel === "group"
          ? "group"
          : "global";
    const groupId =
      typeof req.query.groupId === "string" ? req.query.groupId : undefined;
    res.json({ messages: listChat(user.id, channel, groupId) });
  }),
);

chatRouter.post(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(chatInputSchema, req);
    res.status(201).json({
      message: sendChat(user.id, input.channel, input.message, input.groupId),
    });
  }),
);

const marketRouter = Router();
marketRouter.use(requireUser);
marketRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

marketRouter.get(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    const mine = req.query.mine === "1";
    res.json({ listings: listMarket(user.id, mine) });
  }),
);

marketRouter.post(
  "/list",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(marketListInputSchema, req);
    res.status(201).json({ listing: listItem(user.id, input.itemId, input.price) });
  }),
);

marketRouter.post(
  "/:id/buy",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(buyListing(user.id, id));
  }),
);

marketRouter.post(
  "/:id/cancel",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(cancelListing(user.id, id));
  }),
);

const auctionsRouter = Router();
auctionsRouter.use(requireUser);
auctionsRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

auctionsRouter.get(
  "/",
  handle((req, res) => {
    const user = currentUser(req);
    res.json({ auctions: listAuctions(user.id, req.query.mine === "1") });
  }),
);

auctionsRouter.get(
  "/:id",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(getAuction(user.id, id));
  }),
);

auctionsRouter.post(
  "/list",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(auctionListInputSchema, req);
    res.status(201).json({ auction: listAuctionItem(user.id, input) });
  }),
);

auctionsRouter.post(
  "/:id/bid",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    const input = parseBody(auctionBidInputSchema, req);
    res.json(placeBid(user.id, id, input.amount));
  }),
);

auctionsRouter.post(
  "/:id/buyout",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(buyoutAuction(user.id, id));
  }),
);

auctionsRouter.post(
  "/:id/cancel",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(cancelAuction(user.id, id));
  }),
);

const dungeonsRouter = Router();
dungeonsRouter.use(requireUser);
dungeonsRouter.use((req, _res, next) => {
  settleDueForUser(currentUser(req).id);
  next();
});

dungeonsRouter.get(
  "/personal",
  handle((req, res) => {
    const user = currentUser(req);
    res.json({ regions: listPersonalMazeRegions(user.id) });
  }),
);

dungeonsRouter.post(
  "/personal/expand",
  handle((req, res) => {
    const user = currentUser(req);
    const input = parseBody(personalMazeExpandInputSchema, req);
    res.json({ region: expandPersonalMaze(user.id, input.seriesId) });
  }),
);

dungeonsRouter.get(
  "/preferences",
  handle((req, res) => {
    const user = currentUser(req);
    res.json({ preferences: listDungeonRoutePreferences(user.id) });
  }),
);

dungeonsRouter.get(
  "/unlocks",
  handle((req, res) => {
    const user = currentUser(req);
    res.json({ unlocks: listDungeonUnlocks(user.id) });
  }),
);

const lotteryRouter = Router();
lotteryRouter.use(requireUser);
lotteryRouter.get(
  "/",
  handle((req, res) => {
    res.json(lotteryState(currentUser(req).id, Number(req.query.page ?? 1)));
  }),
);
lotteryRouter.post(
  "/enter",
  handle((req, res) => {
    const input = parseBody(lotteryEnterInputSchema, req);
    res.json(enterLottery(currentUser(req).id, input.count));
  }),
);
lotteryRouter.post(
  "/exchange-manual",
  handle((req, res) => {
    exchangeLegacyManual(currentUser(req).id);
    res.json({ ok: true });
  }),
);
lotteryRouter.post(
  "/use-manual",
  handle((req, res) => {
    const input = parseBody(lotteryUseManualInputSchema, req);
    useLegacyManual(currentUser(req).id, input.heroId);
    res.json({ ok: true });
  }),
);
lotteryRouter.post(
  "/:id/redeem",
  handle((req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(idParamSchema, req);
    res.json(redeemTicket(user.id, id));
  }),
);

export const apiRouter = Router();
apiRouter.use("/", publicRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/heroes", heroesRouter);
apiRouter.use("/inventory", inventoryRouter);
apiRouter.use("/expeditions", expeditionsRouter);
apiRouter.use("/dungeons", dungeonsRouter);
apiRouter.use("/groups", groupsRouter);
apiRouter.use("/friends", friendsRouter);
apiRouter.use("/market", marketRouter);
apiRouter.use("/auctions", auctionsRouter);
apiRouter.use("/clans", clansRouter);
apiRouter.use("/colosseum", colosseumRouter);
apiRouter.use("/chat", chatRouter);
apiRouter.use("/quests", questsRouter);
apiRouter.use("/lottery", lotteryRouter);
apiRouter.use("/leaderboard", leaderboardRouter);
