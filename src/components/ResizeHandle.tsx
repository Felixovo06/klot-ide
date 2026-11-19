// 轻量拖拽分隔条：平时隐形，悬停或拖拽时浮现 2px 圆角高亮细线；Pointer Capture + rAF 节流
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useCliStore } from '../stores/cliStore';
import { relayoutEditors } from '../stores/editorBridge';
import { fitTerminal } from './terminalRegistry';

export type ResizeAxis = 'col' | 'row';

/** 同步重排 Monaco（代码 / Diff）与当前活动终端 */
export function relayoutSurfaces() {
  relayoutEditors();
  const activeId = useCliStore.getState().activeId;
  if (activeId) fitTerminal(activeId);
}

interface DragState {
  pointerId: number;
  start: number;
  startValue: number;
  min: number;
  max: number;
  pending: number | null;
  frame: number;
}

export function ResizeHandle({
  axis,
  value,
  min,
  max,
  direction = 1,
  getMax,
  onChange,
  onReset,
  className = '',
  title,
}: {
  axis: ResizeAxis;
  /** 当前尺寸（宽或高，px） */
  value: number;
  min: number;
  max: number;
  /** 指针正向移动时尺寸的变化方向：1 为增大，-1 为减小 */
  direction?: 1 | -1;
  /** 拖拽开始时按容器实际尺寸计算的动态上限 */
  getMax?: () => number;
  onChange: (v: number) => void;
  onReset: () => void;
  className?: string;
  title?: string;
}) {
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (!drag) return;
      cancelAnimationFrame(drag.frame);
      delete document.body.dataset.resizing;
      dragRef.current = null;
    },
    [],
  );

  const flush = () => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = 0;
    if (drag.pending !== null) {
      onChange(drag.pending);
      drag.pending = null;
    }
    // 等待 React 提交新尺寸后再重排编辑器与终端
    requestAnimationFrame(relayoutSurfaces);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const dynamicMax = getMax ? getMax() : max;
    const upper = Math.max(min, Math.min(max, dynamicMax));
    dragRef.current = {
      pointerId: e.pointerId,
      start: axis === 'col' ? e.clientX : e.clientY,
      startValue: value,
      min,
      max: Math.max(upper, Math.min(value, max)),
      pending: null,
      frame: 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.dataset.resizing = axis;
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const pos = axis === 'col' ? e.clientX : e.clientY;
    const next = drag.startValue + (pos - drag.start) * direction;
    drag.pending = Math.round(Math.min(drag.max, Math.max(drag.min, next)));
    if (!drag.frame) drag.frame = requestAnimationFrame(flush);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    if (drag.pending !== null) onChange(drag.pending);
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    delete document.body.dataset.resizing;
    setDragging(false);
    requestAnimationFrame(relayoutSurfaces);
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === 'col' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={title}
      className={`onyx-resize-handle is-${axis}${dragging ? ' is-dragging' : ''} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        onReset();
        requestAnimationFrame(relayoutSurfaces);
      }}
    />
  );
}
