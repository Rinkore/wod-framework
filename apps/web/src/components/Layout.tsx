import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Backpack,
  BookOpen,
  Castle,
  Coins,
  Crown,
  Gavel,
  LayoutDashboard,
  LogOut,
  Map,
  MessageSquare,
  ScrollText,
  Store,
  Swords,
  Ticket,
  Trophy,
  Users,
  UserPlus,
} from "lucide-react";
import { useAuth, useContent } from "../context";
import { GroupQueueToast } from "./GroupQueueToast";
import { cx } from "./ui";

const NAV = [
  { to: "/", label: "概览", icon: LayoutDashboard, end: true },
  { to: "/heroes", label: "英雄", icon: Swords },
  { to: "/groups", label: "队伍", icon: Users },
  { to: "/dungeons", label: "迷宫", icon: Map },
  { to: "/quests", label: "任务", icon: ScrollText },
  { to: "/market", label: "市场", icon: Store },
  { to: "/auctions", label: "拍卖", icon: Gavel },
  { to: "/lottery", label: "彩票", icon: Ticket },
  { to: "/clans", label: "公会", icon: Castle },
  { to: "/friends", label: "好友", icon: UserPlus },
  { to: "/colosseum", label: "竞技场", icon: Crown },
  { to: "/chat", label: "聊天", icon: MessageSquare },
  { to: "/inventory", label: "背包", icon: Backpack },
  { to: "/codex", label: "图鉴", icon: BookOpen },
  { to: "/rankings", label: "排行", icon: Trophy },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const content = useContent();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">◆</span>
          <span className="brand-text">
            <strong>雨蚀荒原</strong>
            <small>荒原记录</small>
          </span>
        </Link>

        <nav className="nav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) => cx("nav-link", isActive && "nav-link-active")}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="account">
            <div className="avatar">{(user?.username ?? "?").slice(0, 1)}</div>
            <div className="account-text">
              <strong>{user?.username}</strong>
              <span className="account-gold">
                <Coins size={13} /> {user?.gold.toLocaleString("zh-CN") ?? 0} 金币
              </span>
            </div>
            <button
              className="icon-btn"
              title="退出登录"
              aria-label="退出登录"
              onClick={async () => {
                await logout();
                navigate("/");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
          <div className="sidebar-meta">
            中文服务器 · 版本 {content.version}
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
      <GroupQueueToast />
    </div>
  );
}
