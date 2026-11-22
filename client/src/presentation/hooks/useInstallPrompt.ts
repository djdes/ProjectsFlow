import { useCallback, useEffect, useState } from 'react';
import { isAndroidDevice, isIOSDevice, isStandaloneDisplay } from '@/lib/platform';
import { INSTALL_DISMISS_KEY, installBannerHidden, markInstallBannerSeen } from '@/lib/installBanner';

export type InstallPlatform = 'ios' | 'android' | 'desktop';

// beforeinstallprompt отсутствует в lib.dom — минимальный тип под наши нужды.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};


function detectPlatform(): InstallPlatform {
  if (isIOSDevice()) return 'ios';
  if (isAndroidDevice()) return 'android';
  return 'desktop';
}

const detectStandalone = isStandaloneDisplay;

// Состояние установки PWA: платформа, режим standalone, нативный prompt (Android/Chrome) и
// флаг «скрыто» для баннера. На iOS нативного prompt'а нет — показываем инструкцию вручную.
export function useInstallPrompt(): {
  readonly platform: InstallPlatform;
  readonly isStandalone: boolean;
  readonly canInstallNatively: boolean;
  readonly promptInstall: () => Promise<boolean>;
  readonly dismissed: boolean;
  readonly dismiss: () => void;
} {
  const [platform] = useState<InstallPlatform>(() => detectPlatform());
  const [isStandalone, setIsStandalone] = useState<boolean>(() => detectStandalone());
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      // Shown for one day after it first appears, then hides on its own (installBanner.ts).
      if (installBannerHidden(localStorage, Date.now())) return true;
      if (!detectStandalone()) markInstallBannerSeen(localStorage, Date.now());
      return false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onBeforeInstall = (e: Event): void => {
      // Гасим стандартный мини-инфобар Chrome — установку предложим своей кнопкой.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => {
      delete document.documentElement.dataset.pfInstall;
      setIsStandalone(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    const mq = window.matchMedia('(display-mode: standalone)');
    const onMq = (): void => setIsStandalone(detectStandalone());
    mq.addEventListener?.('change', onMq);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener?.('change', onMq);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* пользователь закрыл — не важно */
    }
    setDeferred(null);
    return true;
  }, [deferred]);

  const dismiss = useCallback((): void => {
    setDismissed(true);
    // Later shell skeletons (workspace switch) must not reserve the banner row.
    delete document.documentElement.dataset.pfInstall;
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    } catch {
      /* localStorage недоступен — баннер вернётся в следующей сессии */
    }
  }, []);

  return {
    platform,
    isStandalone,
    canInstallNatively: deferred !== null,
    promptInstall,
    dismissed,
    dismiss,
  };
}
