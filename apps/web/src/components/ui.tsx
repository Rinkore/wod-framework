import {
  AlertTriangle,
  Axe,
  Backpack,
  BookOpen,
  Cloud,
  Coins,
  Compass,
  Crosshair,
  Crown,
  Disc3,
  FlaskConical,
  Flame,
  Footprints,
  Gem,
  Leaf,
  Loader2,
  Music,
  Pickaxe,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Swords,
  VenetianMask,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { RARITY_LABELS } from "@wod/shared";
import type { ItemSlot, Rarity, Slot, WeaponType } from "@wod/shared";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function weaponIcon(weaponType: WeaponType): LucideIcon {
  return (
    {
      sword: Swords,
      axe: Axe,
      hammer: Wrench,
      bow: Crosshair,
      dagger: Swords,
      staff: Sparkles,
      book: BookOpen,
      instrument: Music,
    }[weaponType] ?? Swords
  );
}

export function themeIcon(theme?: string): LucideIcon {
  return (
    {
      mine: Pickaxe,
      crypt: Skull,
      altar: Flame,
      foundry: Flame,
      archive: BookOpen,
      vault: Snowflake,
      throne: Crown,
    }[theme ?? ""] ?? Backpack
  );
}

export function slotIcon(slot: ItemSlot): LucideIcon {
  return {
    weapon: Swords,
    armor: Shield,
    trinket: Gem,
  }[slot];
}

export function Sigil({
  weaponType,
  color,
  size = "md",
}: {
  weaponType: WeaponType;
  color: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const Icon = weaponIcon(weaponType);
  return (
    <span
      className={cx("sigil", `sigil-${size}`)}
      style={{ "--sigil-color": color } as CSSProperties}
      aria-hidden
    >
      <Icon />
    </span>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "subtle" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: LucideIcon;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon: Icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx("btn", `btn-${variant}`, `btn-${size}`, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  id,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag className={cx("card", className)} id={id}>
      {children}
    </Tag>
  );
}

export function Badge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "gold" | "green" | "red" | "blue" | "purple";
  className?: string;
}) {
  return <span className={cx("badge", `badge-${tone}`, className)}>{children}</span>;
}

export function Bar({
  value,
  max,
  tone = "gold",
  className,
}: {
  value: number;
  max: number;
  tone?: "gold" | "green" | "red" | "blue";
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cx("bar", className)}>
      <span className={cx("bar-fill", `bar-${tone}`)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Gold({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={cx("gold", className)}>
      <Coins size={15} />
      {amount.toLocaleString("zh-CN")}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-block">
      <Loader2 className="spin" size={22} />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  icon: Icon = Backpack,
  title,
  text,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={30} />
      <strong>{title}</strong>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="notice notice-error">
      <AlertTriangle size={16} />
      <span>{message}</span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  header,
  children,
  footer,
  wide,
  full,
  fullscreen,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  full?: boolean;
  fullscreen?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div
        className={cx(
          "modal",
          wide && "modal-wide",
          full && "modal-full",
          fullscreen && "modal-fullscreen",
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          {header ?? <h2>{title}</h2>}
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function RarityTag({ rarity }: { rarity: Rarity }) {
  return <span className={cx("rarity-tag", `rarity-${rarity}`)}>{RARITY_LABELS[rarity]}</span>;
}

export function StatusDot({ tone }: { tone: "gold" | "green" | "red" | "muted" }) {
  return <span className={cx("status-dot", `status-${tone}`)} />;
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
