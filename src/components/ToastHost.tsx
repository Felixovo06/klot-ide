import { CircleAlert, CircleCheck, CircleX, Info, X } from 'lucide-react';
import { useUiStore, type ToastTone } from '../stores/uiStore';
import { ICON_STROKE } from './ui';

const ICONS: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: CircleAlert,
  error: CircleX,
};

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="onyx-toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div key={t.id} className={`onyx-toast is-${t.tone}`}>
            <Icon size={15} strokeWidth={ICON_STROKE} className="onyx-toast-icon" />
            <span className="onyx-toast-msg">{t.message}</span>
            <button type="button" className="onyx-mini-btn" title="关闭" onClick={() => dismiss(t.id)}>
              <X size={12} strokeWidth={ICON_STROKE} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
