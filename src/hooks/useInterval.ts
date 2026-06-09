import { useEffect, useRef } from 'react';

/**
 * Runs `callback` every `delay` milliseconds.
 * Pass `null` as delay to pause the interval.
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);

  // Keep the ref current so we never call a stale closure
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;

    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
