import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./ui";

export interface ToolbarChip<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function ListToolbar<T extends string>({
  query,
  onQuery,
  placeholder = "搜索…",
  chips,
  chip,
  onChip,
  count,
  right,
  secondRow,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder?: string;
  chips: Array<ToolbarChip<T>>;
  chip: T;
  onChip: (value: T) => void;
  count?: ReactNode;
  right?: ReactNode;
  secondRow?: ReactNode;
}) {
  return (
    <div className="hub-toolbar">
      <div className="hub-toolbar-row">
        <label className="hub-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={placeholder}
          />
          {query ? (
            <button type="button" className="hub-search-clear" aria-label="清空搜索" onClick={() => onQuery("")}>
              ×
            </button>
          ) : null}
        </label>
        <div className="hub-chips" role="group">
          {chips.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={cx("hub-chip", chip === entry.value && "hub-chip-active")}
              onClick={() => onChip(entry.value)}
            >
              {entry.label}
              {entry.count != null ? <span className="hub-chip-count">{entry.count}</span> : null}
            </button>
          ))}
        </div>
        {count ? <span className="hub-toolbar-count">{count}</span> : null}
        {right ? <div className="hub-toolbar-right">{right}</div> : null}
      </div>
      {secondRow ? <div className="hub-toolbar-row hub-toolbar-row-second">{secondRow}</div> : null}
    </div>
  );
}

export function HubPanel({
  title,
  extra,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("hub-panel", className)}>
      <header className="hub-panel-head">
        <h2 className="hub-panel-title">{title}</h2>
        {extra ? <div className="hub-panel-extra">{extra}</div> : null}
      </header>
      <div className={cx("hub-panel-body", bodyClassName)}>{children}</div>
    </section>
  );
}
