import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (data: T) => void;
}

/** 极简数据加载 hook：支持轮询，出错时保留旧数据。 */
export function useApi<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  pollMs?: number,
): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const result = await loader();
      if (!mounted.current) return;
      setDataState(result);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(errorMessage(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mounted.current = true;
    void load();
    let timer: number | undefined;
    if (pollMs && pollMs > 0) {
      timer = window.setInterval(() => void load(), pollMs);
    }
    return () => {
      mounted.current = false;
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, pollMs]);

  return {
    data,
    error,
    loading,
    reload: load,
    setData: (next: T) => setDataState(next),
  };
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
