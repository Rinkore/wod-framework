import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageSquare, Send, Users } from "lucide-react";
import { api, errorMessage } from "../api";
import { useAuth } from "../context";
import { useApi } from "../hooks";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Spinner,
  cx,
} from "../components/ui";

type Channel = "global" | "clan" | "group";

export function ChatPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const clanQ = useApi(() => api.myClan().then((data) => data.clan), []);
  const groupQ = useApi(() => api.myGroup().then((data) => data.group), []);
  const [channel, setChannel] = useState<Channel>(() =>
    searchParams.get("channel") === "group" ? "group" : "global",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const clan = clanQ.data;
  const group = groupQ.data;
  const chatQ = useApi(
    () =>
      channel === "group" && !group
        ? Promise.resolve([])
        : api.chat(channel, group?.id).then((data) => data.messages),
    [channel, group?.id],
    4000,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const messages = chatQ.data ?? [];

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.sendChat(channel, message.trim(), group?.id);
      setMessage("");
      await chatQ.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page chat-page">
      <PageHeader
        eyebrow="频道"
        title="聊天"
        actions={
          <Badge tone="muted">
            <Users size={13} />{" "}
            {channel === "global"
              ? "世界"
              : channel === "clan"
                ? clan?.name ?? "公会"
                : group?.name ?? "队伍"}
          </Badge>
        }
      />

      <div className="filter-tabs chat-tabs">
        <button
          className={cx("filter-tab", channel === "global" && "filter-tab-active")}
          onClick={() => setChannel("global")}
        >
          世界频道
        </button>
        <button
          className={cx("filter-tab", channel === "clan" && "filter-tab-active")}
          onClick={() => setChannel("clan")}
          disabled={!clan}
        >
          公会频道
        </button>
        <button
          className={cx("filter-tab", channel === "group" && "filter-tab-active")}
          onClick={() => setChannel("group")}
          disabled={!group}
        >
          队伍频道
        </button>
      </div>

      {error ? <ErrorNotice message={error} /> : null}

      {channel === "clan" && !clan ? (
        <EmptyState
          icon={MessageSquare}
          title="还没有公会"
          text="加入一个公会后才能使用公会频道。"
        />
      ) : channel === "group" && !group ? (
        <EmptyState
          icon={MessageSquare}
          title="还没有队伍"
          text="加入一个队伍后才能使用队伍频道。"
        />
      ) : (
        <Card className="chat-card">
          {chatQ.loading && messages.length === 0 ? <Spinner label="正在连接频道…" /> : null}
          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && !chatQ.loading ? (
              <p className="muted-text chat-empty">频道里还没有人说话。</p>
            ) : null}
            {messages.map((entry) => (
              <div
                key={entry.id}
                className={cx("chat-message", entry.userId === user?.id && "chat-mine")}
              >
                <div className="chat-message-head">
                  <strong>{entry.username}</strong>
                  <span>
                    {new Date(entry.createdAt).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p>{entry.message}</p>
              </div>
            ))}
          </div>
          <form className="chat-form" onSubmit={submit}>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={
                channel === "global"
                  ? "对荒原说点什么…"
                  : channel === "clan"
                    ? "对公会成员说点什么…"
                    : "对队友说点什么…"
              }
              maxLength={200}
            />
            <Button type="submit" icon={Send} loading={sending} disabled={!message.trim()}>
              发送
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
