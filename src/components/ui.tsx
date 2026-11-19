// 通用小组件：图标按钮、键帽、分段控制器、弹层关闭钩子
import { useEffect, type ReactNode, type RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';

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
