import { useSyncExternalStore } from 'react';
import {
  getPendingPageLoads,
  subscribePageLoad,
} from '@/presentation/app/pageModules';

export function NavigationProgress(): React.ReactElement | null {
  const pending = useSyncExternalStore(subscribePageLoad, getPendingPageLoads);
  return pending ? (
    <div
      role="progressbar"
      aria-label="Открываем страницу"
      className="pf-navigation-progress"
    />
  ) : null;
}
