import { isFree } from '@/domain/usage/Usage';
import { useUsage } from './UsageProvider';
import { useUsageDialog } from './UsageDialogProvider';
import { useUpgradeDialog } from './UpgradeDialogProvider';

// DRY-хук для точек старта работы диспетчера (composer, диспетч-кнопки, AI-compose):
// можно ли профилю запускать работу диспетчера + причина + открытие usage/апгрейда.
// Два случая блокировки (бэкенд всё равно вернёт 402 — это UX-слой):
//  - planRequired: free-тариф → нет доступа к диспетчеру вовсе (нужен Прайм/ВИП);
//  - overLimit: тариф есть, но окно (5ч/7д) исчерпано.
// Админ/владелец (isAdmin) — безлимит, никогда не заблокирован.
export function useAiBlocked(): {
  blocked: boolean;
  planRequired: boolean;
  overLimit: boolean;
  reason: string | null;
  openUsage: () => void;
  openUpgrade: () => void;
} {
  const { usage } = useUsage();
  const usageDialog = useUsageDialog();
  const upgrade = useUpgradeDialog();

  const isAdmin = usage?.isAdmin ?? false;
  const planRequired = !isAdmin && (usage ? isFree(usage.plan) : false);
  const overLimit = !isAdmin && (usage?.isBlocked ?? false);
  const blocked = planRequired || overLimit;

  const reason = planRequired
    ? 'Диспетчер доступен на тарифах Прайм и ВИП — оформите подписку'
    : overLimit
      ? 'Лимит использования исчерпан — подождите сброса окна или повысьте тариф'
      : null;

  return {
    blocked,
    planRequired,
    overLimit,
    reason,
    openUsage: usageDialog.open,
    openUpgrade: upgrade.open,
  };
}
