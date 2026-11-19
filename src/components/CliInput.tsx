import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CornerDownLeft, X } from 'lucide-react';
import { useCliStore } from '../stores/cliStore';
import { useUiStore } from '../stores/uiStore';
import { basename, chipRef } from '../stores/utils';
import { formatShortcut } from './shortcuts';
import { ICON_STROKE } from './ui';

export function CliInput() {
  const chips = useCliStore((s) => s.chips);
  const removeChip = useCliStore((s) => s.removeChip);
  const submit = useCliStore((s) => s.submit);
  const focusNonce = useUiStore((s) => s.cliFocusNonce);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const composingRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusNonce > 0) taRef.current?.focus();
  }, [focusNonce]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(140, Math.max(20, ta.scrollHeight))}px`;
  }, [draft]);

  const send = async () => {
    if (sending) return;
    if (!draft.trim() && chips.length === 0) return;
    setSending(true);
    const ok = await submit(draft);
    setSending(false);
    if (ok) setDraft('');
    taRef.current?.focus();
  };

  // 无引用芯片、未聚焦且无草稿时收窄为与终端底栏衔接的静谧快捷条，避免与 CLI TUI 自带输入框双重堆叠
  const expanded = focused || chips.length > 0 || draft.length > 0;
  const canSend = !sending && (!!draft.trim() || chips.length > 0);

  return (
    <div
      className={`onyx-cli-input-area${expanded ? ' is-expanded' : ' is-compact'}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          taRef.current?.focus();
        }
      }}
    >
      {chips.length > 0 && (
        <div className="onyx-chip-bar">
          {chips.map((c) => {
            const ref = chipRef(c.path, c.startLine, c.endLine);
            return (
              <span key={c.id} className="onyx-chip" title={ref}>
                <span className="onyx-chip-label">{ref.replace(c.path, basename(c.path))}</span>
                <button type="button" className="onyx-chip-x" title="移除" onClick={() => removeChip(c.id)}>
                  <X size={11} strokeWidth={ICON_STROKE} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="onyx-cli-input">
        <textarea
          ref={taRef}
          rows={1}
          value={draft}
          placeholder={`发送指令，或在编辑器按 ${formatShortcut('Cmd+L')} 引用代码...`}
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(e) => {
            const native = e.nativeEvent;
            if (composingRef.current || native.isComposing || native.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            } else if (e.key === 'Backspace' && !draft && chips.length > 0) {
              removeChip(chips[chips.length - 1].id);
            }
          }}
        />
        <button
          type="button"
          className="onyx-cli-send"
          title="发送 (Enter)"
          tabIndex={expanded ? 0 : -1}
          aria-hidden={!expanded}
          disabled={!canSend}
          onClick={() => void send()}
        >
          <CornerDownLeft size={14} strokeWidth={ICON_STROKE} />
        </button>
      </div>
    </div>
  );
}
