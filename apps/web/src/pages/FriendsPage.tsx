import { useState } from "react";
import { Check, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import type { FriendSearchResult, FriendsView } from "@wod/shared";
import { api, errorMessage } from "../api";
import { useApi } from "../hooks";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Spinner,
} from "../components/ui";

const RELATION_LABEL: Record<FriendSearchResult["relation"], string> = {
  none: "",
  friend: "已是好友",
  incoming: "待你处理",
  outgoing: "已申请",
  self: "你自己",
};

export function FriendsPage() {
  const friendsQ = useApi(() => api.friends(), []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendSearchResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const friends = friendsQ.data;

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

  function apply(next: FriendsView) {
    friendsQ.setData(next);
  }

  function search() {
    const term = query.trim();
    if (!term) return;
    void act("search", async () => {
      const data = await api.searchUsers(term);
      setResults(data.users);
      if (data.users.length === 0) setNotice("没有找到匹配的账号。");
    });
  }

  function send(username: string) {
    void act(`add-${username}`, async () => {
      apply(await api.sendFriendRequest(username));
      setResults((rows) =>
        rows?.map((row) =>
          row.username === username ? { ...row, relation: "outgoing" } : row,
        ) ?? null,
      );
      setNotice(`已向 ${username} 发送好友申请。`);
    });
  }

  function respond(requestId: string, accept: boolean, username: string) {
    void act(`respond-${requestId}`, async () => {
      apply(
        accept
          ? await api.acceptFriendRequest(requestId)
          : await api.declineFriendRequest(requestId),
      );
      setNotice(accept ? `已与 ${username} 成为好友。` : `已拒绝 ${username} 的好友申请。`);
    });
  }

  function cancel(requestId: string, username: string) {
    void act(`cancel-${requestId}`, async () => {
      apply(await api.cancelFriendRequest(requestId));
      setNotice(`已撤回对 ${username} 的好友申请。`);
    });
  }

  function remove(userId: string, username: string) {
    void act(`remove-${userId}`, async () => {
      apply(await api.removeFriend(userId));
      setNotice(`已删除好友 ${username}。`);
    });
  }

  if (friendsQ.loading && !friends) return <Spinner label="正在翻阅好友名册…" />;

  const rows = friends ?? { friends: [], incoming: [], outgoing: [] };

  return (
    <div className="page">
      <PageHeader
        eyebrow="社交"
        title="好友"
        description="好友可以看见仅好友开放的队伍，也可以直接加入。"
      />

      {error ? <ErrorNotice message={error} /> : null}
      {notice ? <div className="notice notice-success">{notice}</div> : null}

      <div className="friends-layout">
        <Card className="friends-search-card">
          <div className="section-head compact">
            <h2>
              <Search size={17} /> 找人
            </h2>
            <span className="muted-text">按用户名搜索</span>
          </div>
          <div className="inline-form">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setResults(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") search();
              }}
              placeholder="输入用户名"
              maxLength={20}
            />
            <Button
              icon={Search}
              loading={busy === "search"}
              disabled={!query.trim()}
              onClick={search}
            >
              搜索
            </Button>
          </div>
          {results ? (
            <div className="friend-result-list">
              {results.length === 0 ? (
                <p className="muted-text">没有找到匹配的账号。</p>
              ) : (
                results.map((row) => (
                  <div key={row.userId} className="friend-row">
                    <span className="friend-avatar">{row.username.slice(0, 1)}</span>
                    <div className="friend-main">
                      <strong>{row.username}</strong>
                      {RELATION_LABEL[row.relation] ? (
                        <span>{RELATION_LABEL[row.relation]}</span>
                      ) : null}
                    </div>
                    {row.relation === "none" ? (
                      <Button
                        size="sm"
                        icon={UserPlus}
                        loading={busy === `add-${row.username}`}
                        onClick={() => send(row.username)}
                      >
                        加好友
                      </Button>
                    ) : row.relation === "incoming" ? (
                      <Badge tone="gold">待处理</Badge>
                    ) : (
                      <Badge tone="muted">{RELATION_LABEL[row.relation]}</Badge>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="section-head compact">
            <h2>
              <Users size={17} /> 好友
            </h2>
            <span className="muted-text">{rows.friends.length} 人</span>
          </div>
          {rows.friends.length > 0 ? (
            <div className="friend-list">
              {rows.friends.map((friend) => (
                <div key={friend.userId} className="friend-row">
                  <span className="friend-avatar">{friend.username.slice(0, 1)}</span>
                  <div className="friend-main">
                    <strong>{friend.username}</strong>
                    <span>成为好友于 {new Date(friend.since).toLocaleDateString("zh-CN")}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    loading={busy === `remove-${friend.userId}`}
                    onClick={() => remove(friend.userId, friend.username)}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="还没有好友"
              text="搜索用户名，发送第一条好友申请。"
            />
          )}
        </Card>

        <Card>
          <div className="section-head compact">
            <h2>
              <UserPlus size={17} /> 好友申请
            </h2>
            <span className="muted-text">
              收到 {rows.incoming.length} · 发出 {rows.outgoing.length}
            </span>
          </div>

          {rows.incoming.length === 0 && rows.outgoing.length === 0 ? (
            <p className="muted-text">没有待处理的好友申请。</p>
          ) : null}

          {rows.incoming.length > 0 ? (
            <div className="friend-request-group">
              <span className="eyebrow">收到</span>
              {rows.incoming.map((request) => (
                <div key={request.id} className="friend-row">
                  <span className="friend-avatar">{request.username.slice(0, 1)}</span>
                  <div className="friend-main">
                    <strong>{request.username}</strong>
                    <span>{new Date(request.createdAt).toLocaleDateString("zh-CN")}</span>
                  </div>
                  <Button
                    size="sm"
                    icon={Check}
                    loading={busy === `respond-${request.id}`}
                    onClick={() => respond(request.id, true, request.username)}
                  >
                    接受
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={X}
                    disabled={busy === `respond-${request.id}`}
                    onClick={() => respond(request.id, false, request.username)}
                  >
                    拒绝
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {rows.outgoing.length > 0 ? (
            <div className="friend-request-group">
              <span className="eyebrow">发出</span>
              {rows.outgoing.map((request) => (
                <div key={request.id} className="friend-row">
                  <span className="friend-avatar">{request.username.slice(0, 1)}</span>
                  <div className="friend-main">
                    <strong>{request.username}</strong>
                    <span>等待对方处理</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `cancel-${request.id}`}
                    onClick={() => cancel(request.id, request.username)}
                  >
                    撤回
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
