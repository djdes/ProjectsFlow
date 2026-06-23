import { useCallback, useEffect, useState } from 'react';

// Свёрнутость секций сайдбара («Недавнее», «Избранное», «Мои проекты», «Архивные»). Хранится
// локально, как тема и done-order — это персональный UI-стейт, не имеет смысла на других устройствах.
type SectionKey = 'favorites' | 'main' | 'archived' | 'recent';

const STORAGE_PREFIX = 'pf-sidebar-section-';

function readInitial(key: SectionKey, defaultCollapsed: boolean): boolean {
  if (typeof window === 'undefined') return defaultCollapsed;
  const stored = window.localStorage.getItem(STORAGE_PREFIX + key);
  if (stored === 'collapsed') return true;
  if (stored === 'expanded') return false;
  return defaultCollapsed;
}

export function useSidebarSectionCollapse(
  key: SectionKey,
  defaultCollapsed = false,
): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState<boolean>(() => readInitial(key, defaultCollapsed));

  useEffect(() => {
    window.localStorage.setItem(STORAGE_PREFIX + key, collapsed ? 'collapsed' : 'expanded');
  }, [key, collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return { collapsed, toggle };
}
