import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type {
  TelegramLoginPayload,
  TelegramPrefs,
  TelegramStatus,
} from '@/application/telegram/TelegramRepository';

// Подписи pref-тогглов. Порядок = порядок отображения.
const PREF_LABELS: ReadonlyArray<{ key: keyof TelegramPrefs; label: string; hint?: string }> = [
  { key: 'commentOnMyTask', label: 'Комментарии на моих задачах' },
  { key: 'mention', label: 'Упоминания @me' },
  { key: 'statusChange', label: 'Смена статуса моих задач' },
  { key: 'ralphQuestion', label: 'Вопросы от Ralph-агента' },
  {
    key: 'ralphAnswer',
    label: 'Ответы на мои вопросы',
    hint: 'Обычно вы сами знаете ответ — выключено по умолчанию',
  },
  { key: 'taskDone', label: 'Моя задача успешно завершена' },
];

declare global {
  interface Window {
    // Callback для Login Widget. Устанавливаем перед инжектом скрипта; удаляем при unmount.
    __pfTgAuth?: (user: TelegramLoginPayload) => void;
  }
}

export function TelegramSection(): React.ReactElement {
  const { telegramRepository } = useContainer();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const widgetContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    telegramRepository
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) toast.error('Не удалось загрузить статус Telegram');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [telegramRepository]);

  // Login Widget: инжектируем <script> когда статус загружен, бот в env задан,
  // и юзер ещё не привязан. Колбэк через window.__pfTgAuth — Telegram-widget зовёт
  // его строкой в data-onauth.
  useEffect(() => {
    if (!status || status.connected || !status.botUsername || !widgetContainerRef.current) {
      return;
    }
    const container = widgetContainerRef.current;
    window.__pfTgAuth = async (user: TelegramLoginPayload): Promise<void> => {
      setConnecting(true);
      try {
        const next = await telegramRepository.connect(user);
        setStatus(next);
        toast.success('Telegram привязан');
      } catch (e) {
        const msg = (e as Error).message || 'Не удалось привязать Telegram';
        toast.error(msg);
      } finally {
        setConnecting(false);
      }
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', status.botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', '__pfTgAuth(user)');
    container.appendChild(script);
    return () => {
      delete window.__pfTgAuth;
      if (script.parentNode) script.parentNode.removeChild(script);
      // Также удаляем встроенный iframe который Telegram создаёт.
      container.querySelectorAll('iframe').forEach((el) => el.remove());
    };
  }, [status, telegramRepository]);

  const togglePref = async (key: keyof TelegramPrefs, value: boolean): Promise<void> => {
    if (!status) return;
    // Оптимистично: сразу обновляем UI, на ошибке откатываемся.
    setStatus({ ...status, prefs: { ...status.prefs, [key]: value } });
    try {
      const next = await telegramRepository.updatePrefs({ [key]: value });
      setStatus(next);
    } catch (e) {
      setStatus(status);
      toast.error((e as Error).message || 'Не удалось сохранить настройку');
    }
  };

  const disconnect = async (): Promise<void> => {
    if (!confirm('Отвязать Telegram? Уведомления перестанут приходить.')) return;
    try {
      await telegramRepository.disconnect();
      const next = await telegramRepository.getStatus();
      setStatus(next);
      toast.success('Telegram отвязан');
    } catch (e) {
      toast.error((e as Error).message || 'Не удалось отвязать');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telegram-уведомления</CardTitle>
        <CardDescription>
          Получай оповещения по своим задачам прямо в Telegram через бота.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Загрузка…
          </div>
        ) : !status?.botUsername ? (
          <p className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
            Telegram-бот ещё не настроен на этом сервере (TELEGRAM_BOT_USERNAME пуст). Привязка
            недоступна.
          </p>
        ) : status.connected ? (
          <>
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm">
              {status.telegramPhotoUrl && (
                <img
                  src={status.telegramPhotoUrl}
                  alt=""
                  className="size-10 rounded-full object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  ✅ Привязан: {status.telegramFirstName ?? ''}
                  {status.telegramUsername && (
                    <span className="ml-1 text-muted-foreground">
                      @{status.telegramUsername}
                    </span>
                  )}
                </p>
                {!status.tgStarted && status.botDeepLink && (
                  <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                    Нажми Start в боте, чтобы он мог писать тебе.
                  </p>
                )}
              </div>
              {status.botDeepLink && (
                <Button asChild variant="outline" size="sm">
                  <a href={status.botDeepLink} target="_blank" rel="noopener">
                    <ExternalLink className="size-3.5" />
                    {status.tgStarted ? 'Открыть' : 'Start'}
                  </a>
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Что присылать
              </p>
              <div className="rounded-md border">
                {PREF_LABELS.map(({ key, label, hint }) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                  >
                    <span className="text-sm">
                      {label}
                      {hint && (
                        <span className="block text-[11px] text-muted-foreground">{hint}</span>
                      )}
                    </span>
                    <Switch
                      checked={status.prefs[key]}
                      onCheckedChange={(v) => void togglePref(key, v)}
                      aria-label={label}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
                Отвязать Telegram
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Войди через Telegram — после этого бот сможет писать тебе по событиям, на которые
              ты подпишешься.
            </p>
            <div ref={widgetContainerRef} className="min-h-[44px]" />
            {connecting && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Привязываем…
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
