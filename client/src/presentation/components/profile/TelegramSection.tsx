import { useEffect, useState } from 'react';
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
    // Объект из telegram-widget.js. Login.auth открывает popup-логина по нашей кнопке —
    // вместо встраиваемого iframe-виджета (его нельзя стилизовать, и он молча не рендерится
    // на незарегистрированном/localhost-домене). user=false когда юзер закрыл окно.
    Telegram?: {
      Login?: {
        auth: (
          options: { bot_id: string; request_access?: string; lang?: string },
          callback: (user: TelegramLoginPayload | false) => void,
        ) => void;
      };
    };
  }
}

const TELEGRAM_WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';

// Фирменный «бумажный самолётик» Telegram (белый глиф на синей кнопке).
function TelegramGlyph({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M21.94 4.66a1.2 1.2 0 0 0-1.27-.18L3.3 11.2c-.95.37-.92 1.74.05 2.06l4.2 1.37 1.62 5.04c.2.6.95.78 1.4.32l2.4-2.45 4.2 3.1c.5.36 1.2.1 1.34-.5l3.2-14.4a1.2 1.2 0 0 0-.47-1.18zM9.7 14.2l8.2-5.1c.16-.1.33.12.2.25l-6.55 6.1c-.2.18-.32.43-.36.7l-.22 1.62-1.1-3.4a.5.5 0 0 1 .2-.57z" />
    </svg>
  );
}

export function TelegramSection(): React.ReactElement {
  const { telegramRepository } = useContainer();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

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

  // Подгружаем telegram-widget.js один раз (когда юзер не привязан и бот настроен) —
  // нам нужен только глобальный window.Telegram.Login.auth для popup-логина по нашей
  // кнопке. Скрипт глобальный, при unmount не снимаем (переиспользуется).
  useEffect(() => {
    if (!status || status.connected || !status.botId) return;
    if (window.Telegram?.Login || document.getElementById('pf-telegram-widget-js')) return;
    const script = document.createElement('script');
    script.id = 'pf-telegram-widget-js';
    script.async = true;
    script.src = TELEGRAM_WIDGET_SRC;
    document.head.appendChild(script);
  }, [status]);

  // Привязка после успешного Telegram-логина (callback из popup).
  const handleTgAuth = async (user: TelegramLoginPayload): Promise<void> => {
    setConnecting(true);
    try {
      const next = await telegramRepository.connect(user);
      setStatus(next);
      toast.success('Telegram привязан — открываю бота, нажми Start');
      // Telegram запрещает боту писать первым: юзер должен один раз нажать Start.
      // Открываем бота сразу после user-clicked callback (popup blocker не мешает).
      // Если всё же заблокируется — fallback-кнопка ниже (status.botDeepLink).
      if (next.botDeepLink) {
        window.open(next.botDeepLink, '_blank', 'noopener');
      }
    } catch (e) {
      toast.error((e as Error).message || 'Не удалось привязать Telegram');
    } finally {
      setConnecting(false);
    }
  };

  // Открыть Telegram-popup логина по клику на нашу кнопку.
  const startTelegramLogin = (): void => {
    const auth = window.Telegram?.Login?.auth;
    if (!auth || !status?.botId) {
      toast.error('Telegram-виджет ещё загружается — попробуй через секунду');
      return;
    }
    auth({ bot_id: status.botId, request_access: 'write' }, (user) => {
      if (user) void handleTgAuth(user);
    });
  };

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
                {/* break-words: длинный @username переносится внутри блока, а не вылезает
                    вправо под кнопку «Открыть» (была перекрыта на узком экране). */}
                <p className="break-words font-medium [overflow-wrap:anywhere]">
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
                <Button asChild variant="outline" size="sm" className="shrink-0">
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
            <button
              type="button"
              onClick={startTelegramLogin}
              disabled={connecting}
              className="pf-tg-login-btn group relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:shadow-sky-500/40 active:translate-y-0 active:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="relative z-[1] flex items-center gap-2.5">
                {connecting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <TelegramGlyph className="size-5 transition-transform duration-300 ease-out group-hover:-rotate-12 group-hover:scale-110" />
                )}
                <span>{connecting ? 'Привязываем…' : 'Войти через Telegram'}</span>
              </span>
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
