import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { MAX_HEROES_PER_ACCOUNT } from "@wod/shared";
import { api, errorMessage } from "../api";
import { useAuth, useContent } from "../context";
import { Button, ErrorNotice, Gold } from "../components/ui";

export function AuthPage() {
  const { setUser } = useAuth();
  const content = useContent();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data =
        mode === "login"
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password);
      setUser(data.user);
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-hero">
        <div className="auth-brand">
          <span className="brand-mark">◆</span>
          <span>
            <strong>雨蚀荒原</strong>
            <small>荒原记录</small>
          </span>
        </div>

        <div className="auth-hero-copy">
          <div className="eyebrow">断代三百年</div>
          <h1>
            雨停之前，
            <br />
            没人知道废墟里
            <br />
            还剩下什么。
          </h1>
          <p>{content.lore || content.description}</p>
        </div>

      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-head">
            <div className="eyebrow">{mode === "login" ? "返回荒原" : "新的名字"}</div>
            <h2>{mode === "login" ? "登录你的拾荒者档案" : "创建一名荒原拾荒者"}</h2>
          </div>

          <form onSubmit={submit} className="auth-form">
            <label>
              <span>账号</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="3–20 个字符"
                minLength={3}
                maxLength={20}
                required
              />
            </label>
            <label>
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="至少 6 位"
                minLength={6}
                maxLength={72}
                required
              />
            </label>

            {error ? <ErrorNotice message={error} /> : null}

            <Button type="submit" size="lg" loading={loading} icon={ArrowRight}>
              {mode === "login" ? "进入雨蚀荒原" : "注册并进入"}
            </Button>
          </form>

          <div className="auth-switch">
            {mode === "login" ? (
              <>
                还没有档案？
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError(null);
                  }}
                >
                  立即注册
                </button>
              </>
            ) : (
              <>
                已经有账号？
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                >
                  返回登录
                </button>
              </>
            )}
          </div>

          <div className="auth-meta">
            <Gold amount={100} />
            <span>起始资金</span>
            <span>·</span>
            <span>{MAX_HEROES_PER_ACCOUNT} 个英雄席位</span>
          </div>
        </div>
      </section>
    </div>
  );
}
