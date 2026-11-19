import { useEffect, useRef } from 'react';
import { attachTerminal, fitTerminal, getTerminalEntry } from './terminalRegistry';

/** 单个 PTY 会话的 xterm 容器：实例常驻注册表，隐藏时不销毁 */
export function TerminalView({ sessionId, active }: { sessionId: string; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    attachTerminal(sessionId, host);
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitTerminal(sessionId));
    });
    ro.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      fitTerminal(sessionId);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, sessionId]);

  return (
    <div
      className="onyx-terminal"
      style={{ display: active ? 'block' : 'none' }}
      onMouseDown={() => getTerminalEntry(sessionId)?.term.focus()}
    >
      <div ref={hostRef} className="onyx-terminal-host" />
    </div>
  );
}
