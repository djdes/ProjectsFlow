import { useCallback, useEffect, useState } from 'react';

export type InstallPlatform = 'ios' | 'android' | 'desktop';

// beforeinstallprompt отсутствует в lib.dom — минимальный тип под наши нужды.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'pf-install-dismissed';

function detectPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  // iPadOS 13+ маскируется под Mac — ловим по тач-точкам.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document);
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari: нестандартный navigator.standalone.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

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
      return localStorage.getItem(DISMISS_KEY) === '1';
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
    try {
      localStorage.setItem(DISMISS_KEY, '1');
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
