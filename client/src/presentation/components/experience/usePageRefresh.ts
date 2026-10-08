import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { registerPageReader } from './refreshRegistry';

export function usePageRefresh(
  refresh: () => Promise<void>,
  enabled = true,
): void {
  const { pathname } = useLocation();
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (enabled) return registerPageReader(pathname, () => latest.current());
  }, [pathname, enabled]);
}
