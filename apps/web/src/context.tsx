import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser, ContentPack } from "@wod/shared";
import { api, errorMessage } from "./api";

interface AuthValue {
  user: AuthUser | null;
  initializing: boolean;
  setUser: (user: AuthUser | null) => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((data) => {
        if (alive) setUser(data.user);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setInitializing(false);
      });

    const handleUnauthorized = () => setUser(null);
    window.addEventListener("wod:unauthorized", handleUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener("wod:unauthorized", handleUnauthorized);
    };
  }, []);

  const refreshUser = async () => {
    const data = await api.me();
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, initializing, setUser, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return value;
}

interface ContentValue {
  content: ContentPack;
  reload: () => Promise<void>;
}

const ContentContext = createContext<ContentValue | null>(null);

export function ContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ContentPack | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .content()
      .then((data) => {
        if (alive) setContent(data.content);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!content) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">◆</div>
        <p>{error ? `内容加载失败：${error}` : "正在读取荒原记录…"}</p>
        {error ? (
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>
            重新加载
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <ContentContext.Provider
      value={{
        content,
        reload: async () => {
          const data = await api.content();
          setContent(data.content);
        },
      }}
    >
      {children}
    </ContentContext.Provider>
  );
}

export function useContent(): ContentPack {
  const value = useContext(ContentContext);
  if (!value) throw new Error("useContent 必须在 ContentProvider 内使用");
  return value.content;
}
