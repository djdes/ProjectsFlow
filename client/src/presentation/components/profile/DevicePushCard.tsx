import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { actionErrorMessage } from '@/lib/actionFeedback';
import { DevicePushError } from '@/application/push/DevicePushNotifications';
import type { DevicePushState } from '@/domain/push/DevicePush';
import { useContainer } from '@/infrastructure/di/container';

function errorText(error: unknown): string {
  if (error instanceof DevicePushError) {
    switch (error.code) {
      case 'permission_dismissed':
        return 'Разрешение не выдано — уведомления не включены';
      case 'service_worker_unavailable':
        return 'Не удалось запустить фоновую часть приложения. Обновите страницу и попробуйте снова';
      case 'subscribe_failed':
        return 'Браузер не смог подписаться на уведомления. Попробуйте ещё раз';
      case 'push_service_not_supported':
        return 'Этот браузер использует неизвестный сервис уведомлений. Попробуйте Safari, Chrome, Firefox или Edge';
      case 'impersonation':
        return 'Во время входа от имени пользователя уведомления на устройство не включаются';
      case 'unknown':
        break;
    }
  }
  return actionErrorMessage(error, 'Не удалось изменить настройку уведомлений');
}

function Note({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground sm:max-w-md">{children}</p>;
}

// "Notifications on this device": system push notifications for the same events as the bell.
// The setting is per browser and per phone.
export function DevicePushCard(): React.ReactElement {
  const { devicePushNotifications: push } = useContainer();
  const [state, setState] = useState<DevicePushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      push.getState()
        .then((next) => { if (!cancelled) setState(next); })
        .catch(() => { if (!cancelled) setState((prev) => prev ?? { kind: 'ready', enabled: false }); });
    };
    load();
    // The permission may have changed in the phone settings while the app was in the background.
    const onVisible = (): void => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [push]);

  const toggle = (next: boolean): void => {
    if (busy) return;
    setBusy(true);
    // enable() is called straight from the tap handler, otherwise Safari does not show the prompt.
    (next ? push.enable() : push.disable())
      .then((result) => {
        setState(result);
        if (next && result.kind === 'ready' && result.enabled) toast.success('Уведомления включены на этом устройстве');
      })
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setBusy(false));
  };

  const sendTest = (): void => {
    setTesting(true);
    push.sendTest()
      .then(() => toast.success('Проверочное уведомление отправлено'))
      .catch((error: unknown) => toast.error(actionErrorMessage(error, 'Не удалось отправить проверочное уведомление')))
      .finally(() => setTesting(false));
  };

  let body: React.ReactNode;
  if (state === null) {
    body = <Skeleton className="h-10 w-full sm:max-w-md" />;
  } else if (state.kind === 'needs_home_screen') {
    body = (
      <Note>
        На iPhone и iPad уведомления приходят только в приложение с экрана «Домой» (iOS 16.4 и новее).
        В Safari нажмите «Поделиться» → «На экран «Домой»», откройте ProjectsFlow с иконки и включите
        уведомления здесь.
      </Note>
    );
  } else if (state.kind === 'unsupported') {
    body = (
      <Note>
        {state.ios
          ? 'Уведомления на iPhone и iPad работают с iOS 16.4. Обновите систему: Настройки → Основные → Обновление ПО.'
          : 'Этот браузер не поддерживает push-уведомления. Откройте ProjectsFlow в Safari, Chrome, Firefox или Edge.'}
      </Note>
    );
  } else if (state.kind === 'denied') {
    body = (
      <Note>
        {state.ios
          ? 'Уведомления для ProjectsFlow запрещены. Разрешите их: Настройки → Уведомления → ProjectsFlow → «Допуск уведомлений», затем вернитесь сюда.'
          : 'Уведомления для этого сайта запрещены в браузере. Разрешите их в настройках сайта (значок слева от адреса → «Уведомления») и обновите страницу.'}
      </Note>
    );
  } else {
    body = (
      <div className="space-y-3 sm:max-w-md">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium leading-none">Получать уведомления</div>
            <p className="text-sm text-muted-foreground">
              {state.enabled
                ? 'Включены в этом браузере на этом устройстве.'
                : 'Телефон или компьютер спросит разрешение один раз.'}
            </p>
          </div>
          <Switch
            checked={state.enabled}
            onCheckedChange={toggle}
            disabled={busy}
            aria-label="Уведомления на этом устройстве"
          />
        </div>
        {state.enabled && (
          <Button variant="outline" size="sm" onClick={sendTest} disabled={testing || busy}>
            {testing ? 'Отправляем…' : 'Прислать проверочное'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Smartphone className="size-5 text-primary" aria-hidden />
          <CardTitle>Уведомления на этом устройстве</CardTitle>
        </div>
        <CardDescription>
          Упоминания, назначения, задачи на утверждение и изменения ваших задач — системными
          уведомлениями, даже когда приложение закрыто. Нажатие открывает задачу.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
