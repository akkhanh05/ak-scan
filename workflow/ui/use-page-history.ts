"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanPage } from "@/workflow/shared/core/scan";

const LIMIT = 40;
const MERGE_WINDOW = 700;

interface HistoryState { past: ScanPage[][]; present: ScanPage[]; future: ScanPage[][] }

/**
 * Undo/redo for the page list. Blob URLs stay alive while any history entry
 * still references them and are revoked once nothing can bring them back.
 */
export function usePageHistory() {
  const [state, setState] = useState<HistoryState>({ past: [], present: [], future: [] });
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const registered = useRef(new Set<string>());
  const referenced = useRef(new Set<string>());

  const commit = useCallback((update: (pages: ScanPage[]) => ScanPage[], mergeKey?: string) => {
    setState((current) => {
      const next = update(current.present);
      if (next === current.present) return current;
      const now = Date.now();
      const merge = mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < MERGE_WINDOW;
      lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
      return {
        past: merge ? current.past : [...current.past, current.present].slice(-LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    lastMerge.current = null;
    setState((current) => current.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future] } : current);
  }, []);
  const redo = useCallback(() => {
    lastMerge.current = null;
    setState((current) => current.future.length ? { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) } : current);
  }, []);
  /** Replaces the session and forgets history (used for "clear session" and draft restore). */
  const reset = useCallback((pages: ScanPage[]) => {
    lastMerge.current = null;
    setState({ past: [], present: pages, future: [] });
  }, []);

  /** Tracks a blob URL created for this session so it can be revoked later. */
  const registerUrl = useCallback((url: string) => { registered.current.add(url); }, []);
  const revokeUnregistered = useCallback((url: string) => { URL.revokeObjectURL(url); registered.current.delete(url); }, []);

  useEffect(() => {
    const inUse = new Set([...state.past, state.present, ...state.future].flat().map((page) => page.url));
    for (const url of referenced.current) {
      if (!inUse.has(url)) { URL.revokeObjectURL(url); registered.current.delete(url); }
    }
    referenced.current = inUse;
  }, [state]);

  useEffect(() => () => {
    registered.current.forEach((url) => URL.revokeObjectURL(url));
    registered.current.clear();
  }, []);

  return {
    pages: state.present,
    commit,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    registerUrl,
    revokeUnregistered,
  };
}
