import { useCallback, useEffect, useState } from 'react';

// Свёрнутость секций сайдбара («Избранное», «Мои проекты»). Хранится локально, как тема и
// done-order — это персональный UI-стейт, не имеет смысла на других устройствах.
type SectionKey = 'favorites' | 'main';

const STORAGE_PREFIX = 'pf-sidebar-section-';

function readInitial(key: SectionKey): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_PREFIX + key) === 'collapsed';
}

export function useSidebarSectionCollapse(key: SectionKey): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState<boolean>(() => readInitial(key));

  useEffect(() => {
    window.localStorage.setItem(STORAGE_PREFIX + key, collapsed ? 'collapsed' : 'expanded');
  }, [key, collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return { collapsed, toggle };
}
