import { useState } from 'react';
import { Download, Plus, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useInstallPrompt, type InstallPlatform } from '@/presentation/hooks/useInstallPrompt';

// Пошаговая инструкция «на экран Домой» — у каждой платформы свой путь. На Android, если
// сработал нативный prompt, этот диалог не открывается (см. handleInstall).
function InstructionsDialog({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  platform: InstallPlatform;
}): React.ReactElement {
  const steps =
    platform === 'ios'
      ? [
          <>
            Нажмите <Share className="mx-0.5 inline size-4 align-text-bottom" /> «Поделиться» в
            нижней панели Safari.
          </>,
          <>
            Выберите <SquarePlus className="mx-0.5 inline size-4 align-text-bottom" /> «На экран
            «Домой».
          </>,
          <>Подтвердите «Добавить» — иконка появится на рабочем столе.</>,
        ]
      : platform === 'android'
        ? [
            <>Откройте меню браузера (⋮ в правом верхнем углу).</>,
            <>
              Выберите «Установить приложение» или «Добавить на главный экран».
            </>,
            <>Подтвердите — ProjectsFlow появится как приложение.</>,
          ]
        : [
            <>Откройте меню браузера (⋮ или ≡ в правом верхнем углу).</>,
            <>
              Выберите «Установить приложение…» или «Создать ярлык…» (раздел «Ещё» /
              «Сохранить и поделиться»).
            </>,
            <>Подтвердите — ProjectsFlow откроется в отдельном окне.</>,
          ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Установить приложение</DialogTitle>
          <DialogDescription>
            ProjectsFlow откроется на весь экран, как обычное приложение.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-sm">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span className="pt-0.5 text-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

// Аффорданс установки PWA. variant='banner' — тонкая скрываемая полоса (моб. AppShell),
// variant='card' — карточка для страницы профиля. Прячется, если уже установлено (standalone).
export function InstallAppPrompt({
  variant,
}: {
  variant: 'banner' | 'card';
}): React.ReactElement | null {
  const { platform, isStandalone, canInstallNatively, promptInstall, dismissed, dismiss } =
    useInstallPrompt();
  const [showSteps, setShowSteps] = useState(false);

  if (isStandalone) return null;

  const handleInstall = async (): Promise<void> => {
    // Android/Chrome: пробуем нативный prompt. Иначе (iOS, нет события) — показываем инструкцию.
    if (canInstallNatively && (await promptInstall())) return;
    setShowSteps(true);
  };

  if (variant === 'banner') {
    if (dismissed) return null;
    return (
      <>
        <div className="flex shrink-0 items-center gap-2 border-b bg-primary/5 px-3 py-2 text-sm">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground"
          >
            PF
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Установить на телефон
          </span>
          <Button size="sm" className="h-7 shrink-0 gap-1 px-2.5" onClick={() => void handleInstall()}>
            <Plus className="size-3.5" />
            Установить
          </Button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Скрыть"
            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <InstructionsDialog open={showSteps} onOpenChange={setShowSteps} platform={platform} />
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Приложение на телефон</CardTitle>
        <CardDescription>
          Добавьте ProjectsFlow на экран «Домой» — откроется на весь экран, как обычное приложение.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => void handleInstall()} className="gap-2">
          <Download className="size-4" />
          Установить приложение
        </Button>
        <InstructionsDialog open={showSteps} onOpenChange={setShowSteps} platform={platform} />
      </CardContent>
    </Card>
  );
}
