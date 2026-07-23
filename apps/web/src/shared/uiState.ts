import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

const RIGHT_PANE_MAIN_MIN = 220;
const STANDARD_RIGHT_PANE_MIN = 220;
const WORKFLOW_RIGHT_PANE_MIN = 300;

export interface ToastNotice {
  id: number;
  text: string;
}

export function useToastNotice(timeoutMs = 1800) {
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [timerId, setTimerId] = useState<number | null>(null);

  const showToast = useCallback((text: string) => {
    if (timerId) window.clearTimeout(timerId);
    setToast({ id: Date.now(), text });
    setTimerId(window.setTimeout(() => setToast(null), timeoutMs));
  }, [timerId, timeoutMs]);

  useEffect(() => () => {
    if (timerId) window.clearTimeout(timerId);
  }, [timerId]);

  return { toast, showToast };
}

export function useRightPaneSizing(visible: boolean, mode: 'standard' | 'workflow' = 'standard') {
  const [width, setWidth] = useState(() => {
    if (mode !== 'workflow') return 348;
    const stored = Number(localStorage.getItem('nexus.workflowPaneWidth') ?? 0);
    return clampRightPaneWidth(stored || defaultWorkflowPaneWidth(), WORKFLOW_RIGHT_PANE_MIN);
  });

  useEffect(() => {
    setWidth((current) => {
      if (mode === 'workflow') {
        const stored = Number(localStorage.getItem('nexus.workflowPaneWidth') ?? 0);
        return clampRightPaneWidth(stored || current || defaultWorkflowPaneWidth(), WORKFLOW_RIGHT_PANE_MIN);
      }
      return clampRightPaneWidth(current, STANDARD_RIGHT_PANE_MIN);
    });
  }, [mode]);

  const startResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!visible) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const resizeMin = mode === 'workflow' ? WORKFLOW_RIGHT_PANE_MIN : STANDARD_RIGHT_PANE_MIN;
    const max = Math.max(resizeMin, rightPaneAvailableMax());
    function move(moveEvent: PointerEvent) {
      const next = startWidth - (moveEvent.clientX - startX);
      const nextWidth = Math.min(max, Math.max(resizeMin, next));
      if (mode === 'workflow') localStorage.setItem('nexus.workflowPaneWidth', String(Math.round(nextWidth)));
      setWidth(nextWidth);
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [mode, visible, width]);

  const rightPaneMin = mode === 'workflow' ? WORKFLOW_RIGHT_PANE_MIN : STANDARD_RIGHT_PANE_MIN;

  return {
    rightPaneWidth: width,
    rightPaneGridTemplateColumns: visible
      ? `minmax(${RIGHT_PANE_MAIN_MIN}px, 1fr) 7px minmax(${rightPaneMin}px, min(${width}px, calc(100vw - 240px)))`
      : 'minmax(0, 1fr)',
    startRightPaneResize: startResize,
  };
}

function rightPaneAvailableMax(): number {
  return Math.max(STANDARD_RIGHT_PANE_MIN, window.innerWidth - 240);
}

function defaultWorkflowPaneWidth(): number {
  return Math.round(Math.max(620, window.innerWidth * 0.5));
}

function clampRightPaneWidth(width: number, min: number): number {
  return Math.min(Math.max(min, rightPaneAvailableMax()), Math.max(min, width));
}
