// 通用小组件：图标按钮、键帽、分段控制器、右键菜单与弹层关闭钩子
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { toast } from '../stores/uiStore';

export const ICON_STROKE = 1.5;

export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [ref, open, onClose]);
}

export function IconButton({
  icon: Icon,
  title,
  onClick,
  active,
  size = 16,
  className = '',
  tone,
  disabled,
  filled,
}: {
  icon: LucideIcon;
  title: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  size?: number;
  className?: string;
  tone?: 'danger' | 'success';
  disabled?: boolean;
  filled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`onyx-icon-btn${active ? ' is-active' : ''}${tone ? ` is-${tone}` : ''} ${className}`}
      onClick={onClick}
    >
      <Icon size={size} strokeWidth={ICON_STROKE} fill={filled ? 'currentColor' : 'none'} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="onyx-kbd">{children}</span>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`onyx-segmented is-${size}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          title={o.title}
          aria-selected={o.value === value}
          className={`onyx-segmented-item${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GitStatusLetter({ status }: { status: string }) {
  const letter = status === '?' ? 'U' : status;
  const tone =
    status === 'D' ? 'error' : status === 'A' || status === '?' || status === 'U' ? 'success' : 'warning';
  return <span className={`onyx-git-letter is-${tone}`}>{letter}</span>;
}

export function copyToClipboard(text: string, label = '文本') {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => toast('success', `已复制${label}`))
    .catch(() => toast('warning', '复制失败'));
}

export type ContextMenuEntry =
  | { kind: 'divider'; key: string }
  | {
      kind?: 'item';
      key: string;
      label: string;
      icon?: LucideIcon;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

/** 全局 Portal 右键菜单：自动夹取到视口范围，点击外部/滚动/Esc 自动关闭 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const left = Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad));
    const top = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad));
    setPos({ left, top });
  }, [x, y, items.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onBlurOrScroll = () => onClose();
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlurOrScroll);
    window.addEventListener('resize', onBlurOrScroll);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlurOrScroll);
      window.removeEventListener('resize', onBlurOrScroll);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="onyx-menu onyx-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => {
        if (it.kind === 'divider') return <div key={it.key} className="onyx-menu-divider" />;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            type="button"
            disabled={it.disabled}
            className={`onyx-menu-item${it.danger ? ' is-danger' : ''}`}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {Icon && <Icon size={14} strokeWidth={ICON_STROKE} />}
            <span className="onyx-menu-label">{it.label}</span>
            {it.hint && <span className="onyx-menu-hint">{it.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
