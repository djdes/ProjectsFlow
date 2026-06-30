import { useUsage } from './UsageProvider';
import { useUsageDialog } from './UsageDialogProvider';
import { useUpgradeDialog } from './UpgradeDialogProvider';

// DRY-хук для точек старта AI-работы (composer, диспетч-кнопки): заблокирован ли профиль
// по лимиту + причина + открытие окна usage/апгрейда. Бэкенд всё равно вернёт 402 — это UX.
export function useAiBlocked(): {
  blocked: boolean;
  reason: string | null;
  openUsage: () => void;
  openUpgrade: () => void;
} {
  const { usage } = useUsage();
  const usageDialog = useUsageDialog();
  const upgrade = useUpgradeDialog();
  const blocked = usage?.isBlocked ?? false;
  return {
    blocked,
    reason: blocked
      ? 'Лимит использования исчерпан — подождите сброса окна или повысьте тариф'
      : null,
    openUsage: usageDialog.open,
    openUpgrade: upgrade.open,
  };
}
