import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./ui";

/** 量测网格容器的实际列数（随宽度自适应，供“整页填满、不出现半行”的分页使用）。 */
export function useGridColumns(
  ref: RefObject<HTMLElement | null>,
  minColumnWidth: number,
  gap = 12,
  /** 弹窗内容延迟挂载时传 false，等容器出现后再观察。 */
  enabled = true,
): number {
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const width = el.getBoundingClientRect().width;
      if (width <= 0) return;
      setColumns(Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, minColumnWidth, gap, enabled]);
  return columns;
}

/** 视口较矮时减少行数，保证列表页不需要滚动。 */
export function useAdaptiveRowHeight(tallRows: number, shortRows: number): number {
  const calc = () => (window.innerHeight >= 860 ? tallRows : shortRows);
  const [rows, setRows] = useState(calc);
  useEffect(() => {
    const onResize = () => setRows(calc());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [tallRows, shortRows]);
  return rows;
}

/** 视口较矮时减少每页数量，保证列表页不需要滚动。 */
export function useAdaptivePageSize(tall: number, short: number): number {
  const calc = () => (window.innerHeight >= 860 ? tall : short);
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const onResize = () => setSize(calc());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [tall, short]);
  return size;
}

/** 仓储类列表的翻页：纯前端 slice，筛选变化时回到第 1 页。 */
export function usePagination(items: readonly unknown[], pageSize: number): {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  slice: unknown[];
  total: number;
} {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [total, pageSize]);

  const safePage = Math.min(page, pageCount);
  const slice = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );
  return { page: safePage, pageCount, setPage, slice, total };
}

export function Pagination({
  page,
  pageCount,
  onPage,
  label,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  if (pageCount <= 1) return null;
  const windowStart = Math.max(1, Math.min(page - 2, pageCount - 4));
  const windowEnd = Math.min(pageCount, windowStart + 4);
  const pages: number[] = [];
  for (let i = windowStart; i <= windowEnd; i += 1) pages.push(i);
  return (
    <nav className="hub-pagination" aria-label="分页">
      <button
        type="button"
        aria-label="上一页"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={14} />
      </button>
      {windowStart > 1 ? (
        <button type="button" className="hub-page" onClick={() => onPage(1)}>
          1
        </button>
      ) : null}
      {windowStart > 2 ? <span className="hub-page-ellipsis">…</span> : null}
      {pages.map((value) => (
        <button
          key={value}
          type="button"
          className={cx("hub-page", value === page && "hub-page-active")}
          aria-current={value === page ? "page" : undefined}
          onClick={() => onPage(value)}
        >
          {value}
        </button>
      ))}
      {windowEnd < pageCount - 1 ? <span className="hub-page-ellipsis">…</span> : null}
      {windowEnd < pageCount ? (
        <button type="button" className="hub-page" onClick={() => onPage(pageCount)}>
          {pageCount}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="下一页"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={14} />
      </button>
      {label ? <span className="hub-pagination-label">{label}</span> : null}
    </nav>
  );
}
