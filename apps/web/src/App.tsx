import { useEffect } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context";
import { Layout } from "./components/Layout";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HeroesPage } from "./pages/HeroesPage";
import { HeroCreatePage } from "./pages/HeroCreatePage";
import { HeroDetailPage } from "./pages/HeroDetailPage";
import { DungeonsPage } from "./pages/DungeonsPage";
import { GroupPage } from "./pages/GroupPage";
import { QuestsPage } from "./pages/QuestsPage";
import { MarketPage } from "./pages/MarketPage";
import { AuctionsPage } from "./pages/AuctionsPage";
import { ClanPage } from "./pages/ClanPage";
import { FriendsPage } from "./pages/FriendsPage";
import { ColosseumPage } from "./pages/ColosseumPage";
import { ChatPage } from "./pages/ChatPage";
import { ExpeditionPage } from "./pages/ExpeditionPage";
import { InventoryPage } from "./pages/InventoryPage";
import { CodexPage } from "./pages/CodexPage";
import { RankingsPage } from "./pages/RankingsPage";
import { LotteryPage } from "./pages/LotteryPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <div className="page">
      <div className="empty-state">
        <strong>404 · 地图之外</strong>
        <p>这条路径没有记录在荒原记录里。</p>
        <Link to="/" className="btn btn-primary btn-md">
          返回概览
        </Link>
      </div>
    </div>
  );
}

export function App() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">◆</div>
        <p>正在核对行会档案…</p>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return (
    <>
      <ScrollToTop />
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/heroes" element={<HeroesPage />} />
          <Route path="/heroes/new" element={<HeroCreatePage />} />
          <Route path="/heroes/:id" element={<HeroDetailPage />} />
          <Route path="/groups" element={<GroupPage />} />
          <Route path="/dungeons" element={<DungeonsPage />} />
          <Route path="/quests" element={<QuestsPage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/auctions" element={<AuctionsPage />} />
          <Route path="/lottery" element={<LotteryPage />} />
          <Route path="/clans" element={<ClanPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/colosseum" element={<ColosseumPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/expeditions/:id" element={<ExpeditionPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/codex" element={<CodexPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </>
  );
}
