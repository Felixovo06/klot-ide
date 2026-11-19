import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { ICON_STROKE } from './ui';

export function Breadcrumb() {
  const activePath = useWorkspaceStore((s) => s.activePath);
  const symbols = useWorkspaceStore((s) => s.cursorSymbols);
  const expandTo = useWorkspaceStore((s) => s.expandTo);
  const setSelectedTreePath = useWorkspaceStore((s) => s.setSelectedTreePath);
  const openQuickOpen = useUiStore((s) => s.openQuickOpen);
  if (!activePath) return null;
  const parts = activePath.split('/');
  const items = [
    ...parts.map((p, i) => ({
      text: p,
      kind: i === parts.length - 1 ? ('file' as const) : ('dir' as const),
      dirPath: parts.slice(0, i + 1).join('/'),
    })),
    ...symbols.map((s) => ({ text: s, kind: 'symbol' as const, dirPath: '' })),
  ];

  const onClickItem = (it: (typeof items)[number]) => {
    if (it.kind === 'dir') {
      const ui = useUiStore.getState();
      ui.setMode('code');
      ui.setLeftVisible(true);
      ui.setLeftTab('files');
      useWorkspaceStore.setState((s) => ({
        expanded: { ...s.expanded, [it.dirPath]: true },
      }));
      expandTo(`${it.dirPath}/_`);
      setSelectedTreePath(it.dirPath);
    } else if (it.kind === 'symbol') {
      openQuickOpen('@');
    }
  };

  return (
    <div className="onyx-breadcrumb">
      {items.map((it, i) => (
        <Fragment key={`${i}:${it.kind}:${it.text}`}>
          {i > 0 && <ChevronRight size={12} strokeWidth={ICON_STROKE} className="onyx-breadcrumb-sep" />}
          {it.kind === 'dir' || it.kind === 'symbol' ? (
            <button
              type="button"
              className={`onyx-breadcrumb-item is-${it.kind} is-clickable`}
              title={it.kind === 'dir' ? `在侧边栏展开 ${it.dirPath}` : '跳转到文件符号 (@)'}
              onClick={() => onClickItem(it)}
            >
              {it.text}
            </button>
          ) : (
            <span className={`onyx-breadcrumb-item is-${it.kind}`}>{it.text}</span>
          )}
        </Fragment>
      ))}
    </div>
  );
}
