import { useCallback, useEffect, useRef, useState } from "react";
import type { Resource } from "../hooks/useResource";

// GET-only polling. Mutations never run from effects or retry handlers.
export function useControlPolling<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  interval: (data: T) => number,
  onFailure: (error: Error) => void,
): Resource<T> & { refreshing: boolean; version: number; checkedAt?: string } {
  const [value, setValue] = useState<{
    key: string;
    data?: T;
    error?: Error;
    loading: boolean;
    refreshing: boolean;
    version: number;
    checkedAt?: string;
  }>({ key, loading: true, refreshing: false, version: 0 });
  const refresh = useRef<() => void>(() => {});
  const version = useRef(0);
  useEffect(() => {
    let alive = true;
    let epoch = 0;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function run() {
      clearTimeout(timer);
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const current = ++epoch;
      setValue((previous) =>
        previous.key === key && previous.data
          ? { ...previous, refreshing: true }
          : { key, loading: true, refreshing: true, version: version.current },
      );
      try {
        const data = await load(request.signal);
        if (!alive || current !== epoch) return;
        setValue({
          key,
          data,
          loading: false,
          refreshing: false,
          version: ++version.current,
          checkedAt: new Date().toISOString(),
        });
        if (!document.hidden)
          timer = setTimeout(() => void run(), interval(data));
      } catch (failure) {
        if (!alive || current !== epoch || request.signal.aborted) return;
        request.abort();
        const error =
          failure instanceof Error
            ? failure
            : new Error("Không tải được trạng thái thiết bị.");
        setValue({
          key,
          error,
          loading: false,
          refreshing: false,
          version: version.current,
        });
        onFailure(error);
        // Clear private/stale snapshots; require deliberate read after an error.
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void run();
    };
    refresh.current = () => {
      void run();
    };
    document.addEventListener("visibilitychange", visibility);
    void run();
    return () => {
      alive = false;
      ++epoch;
      controller?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      refresh.current = () => {};
    };
  }, [key, load, interval, onFailure]);
  return {
    ...(value.key === key
      ? value
      : { loading: true, refreshing: false, version: 0 }),
    reload: useCallback(() => refresh.current(), []),
  };
}
