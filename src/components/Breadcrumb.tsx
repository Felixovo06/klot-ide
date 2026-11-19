import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { ICON_STROKE } from './ui';

export function Breadcrumb() {
  const activePath = useWorkspaceStore((s) => s.activePath);
  const symbols = useWorkspaceStore((s) => s.cursorSymbols);
  if (!activePath) return null;
  const parts = activePath.split('/');
  const items = [...parts.map((p, i) => ({ text: p, kind: i === parts.length - 1 ? 'file' : 'dir' })), ...symbols.map((s) => ({ text: s, kind: 'symbol' }))];
  return (
    <div className="onyx-breadcrumb">
      {items.map((it, i) => (
        <Fragment key={`${i}:${it.text}`}>
          {i > 0 && <ChevronRight size={12} strokeWidth={ICON_STROKE} className="onyx-breadcrumb-sep" />}
          <span className={`onyx-breadcrumb-item is-${it.kind}`}>{it.text}</span>
        </Fragment>
      ))}
    </div>
  );
}
