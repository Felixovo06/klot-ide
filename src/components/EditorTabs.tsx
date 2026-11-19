import { useEffect, useMemo, useRef } from 'react';
import { File, X } from 'lucide-react';
import { basename, dirname } from '../stores/utils';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { ICON_STROKE } from './ui';

export function EditorTabs() {
  const openFiles = useWorkspaceStore((s) => s.openFiles);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const closeFile = useWorkspaceStore((s) => s.closeFile);
  const stripRef = useRef<HTMLDivElement>(null);

  const dupNames = useMemo(() => {
    const count = new Map<string, number>();
    openFiles.forEach((f) => count.set(basename(f.path), (count.get(basename(f.path)) ?? 0) + 1));
    return count;
  }, [openFiles]);

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('.onyx-tab.is-active');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath]);

  return (
    <div
      className="onyx-tabs"
      ref={stripRef}
      onWheel={(e) => {
        if (stripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          stripRef.current.scrollLeft += e.deltaY;
        }
      }}
    >
      {openFiles.map((f) => {
        const name = basename(f.path);
        const active = f.path === activePath;
        return (
          <div
            key={f.path}
            className={`onyx-tab${active ? ' is-active' : ''}${f.dirty ? ' is-dirty' : ''}`}
            title={f.path}
            onClick={() => setActive(f.path)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeFile(f.path);
              }
            }}
          >
            <File size={14} strokeWidth={ICON_STROKE} className="onyx-tab-icon" />
            <span className="onyx-tab-name">{name}</span>
            {(dupNames.get(name) ?? 0) > 1 && <span className="onyx-tab-dir">{dirname(f.path)}</span>}
            <button
              type="button"
              className="onyx-tab-close"
              title="关闭"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(f.path);
              }}
            >
              <span className="onyx-tab-dirty-dot" />
              <X size={13} strokeWidth={ICON_STROKE} className="onyx-tab-x" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
