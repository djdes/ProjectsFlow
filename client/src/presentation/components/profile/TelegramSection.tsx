import { useCallback, useEffect, useRef, useState } from 'react';
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
  TelegramPairing,
  TelegramPrefs,
  TelegramStatus,
} from '@/application/telegram/TelegramRepository';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';

// Подписи pref-тогглов. Порядок = порядок отображения.
const PREF_LABELS: ReadonlyArray<{ key: keyof TelegramPrefs; label: string; hint?: string }> = [
  { key: 'commentOnMyTask', label: 'Комментарии на моих задачах' },
  { key: 'mention', label: 'Упоминания @me' },
  { key: 'statusChange', label: 'Изменения моих задач', hint: 'Срок, описание, исполнитель, статус, удаление и восстановление' },
  { key: 'ralphQuestion', label: 'Вопросы от Ralph-агента' },
  {
    key: 'ralphAnswer',
    label: 'Ответы на мои вопросы',
    hint: 'Обычно вы сами знаете ответ — выключено по умолчанию',
  },
  { key: 'taskDone', label: 'Моя задача успешно завершена' },
];

// Тоггл руководителя: командный поток по всему пространству. Показываем только тем, у кого
// роль есть хотя бы в одном пространстве — остальным настройка ничего не даёт.
const LEAD_PREF: { key: keyof TelegramPrefs; label: string; hint: string } = {
  key: 'teamStatusChange',
  label: 'Изменения задач команды',
  hint: 'Для руководителей и владельца: изменения и утверждение задач в личном чате с ботом',
};

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
  // Тоггл командного потока показываем только руководителю (роль хотя бы в одном пространстве).
  const { data: workspaces } = useWorkspaces();
  const isLead = (workspaces ?? []).some((w) => w.role === 'lead' || w.role === 'owner');
  const prefRows = isLead ? [...PREF_LABELS, LEAD_PREF] : PREF_LABELS;
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const checking = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const refreshStatus = useCallback(async (feedback = false): Promise<void> => {
    if (checking.current) return;
    checking.current = true;
    try {
      const next = await telegramRepository.getStatus();
      if (!active.current) return;
      setStatus(next);
      setError(null);
      if (next.connected && next.tgStarted) setPairing(null);
      else if (feedback) toast.message('Нажмите «Запустить» в боте, затем проверьте подключение ещё раз.');
    } catch {
      if (active.current) setError('Не удалось проверить подключение. Проверьте интернет и повторите.');
    } finally {
      checking.current = false;
      if (active.current) setLoading(false);
    }
  }, [telegramRepository]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Poll only while waiting for confirmation. Focus/visibility handles returning from the app.
  useEffect(() => {
    if (expired || (!pairing && !(status?.connected && !status.tgStarted))) return;
    const until = pairing ? Date.parse(pairing.expiresAt) : Date.now() + 600_000;
    const check = (): void => {
      if (Date.now() >= until) { void refreshStatus(); setExpired(true); return; }
      if (document.visibilityState !== 'hidden') void refreshStatus();
    };
    const timer = window.setInterval(check, 3000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pairing, expired, status?.connected, status?.tgStarted, refreshStatus]);

  const startTelegramLogin = async (): Promise<void> => {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    try {
      const next = await telegramRepository.startConnection();
      if (!active.current) return;
      setPairing(next);
      setExpired(false);
    } catch {
      if (active.current) setError('Не удалось создать ссылку подключения. Попробуйте ещё раз.');
    } finally {
      if (active.current) setConnecting(false);
    }
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
      setPairing(null);
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
        {error && (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refreshStatus()}>Обновить статус</Button>
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 motion-safe:animate-spin" /> Загрузка…
          </div>
        ) : !status ? null : !status.botUsername || !status.botId ? (
          <p className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
            Подключение Telegram пока недоступно. Попробуйте позже.
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
                    <span className="ms-1 text-muted-foreground">
                      @{status.telegramUsername}
                    </span>
                  )}
                </p>
                {!status.tgStarted && status.botDeepLink && (
                  <p className="mbs-0.5 text-xs text-warning">
                    Нажми «Запустить» в боте, чтобы получать уведомления.
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
                {prefRows.map(({ key, label, hint }) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-3 border-be px-3 py-2 last:border-be-0"
                  >
                    <span className="text-sm">
                      {label}
                      {hint && (
                        <span className="block text-2xs text-muted-foreground">{hint}</span>
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
              {pairing && !expired
                ? 'Откройте бота и нажмите «Запустить» (Start). Затем вернитесь сюда — подключение подтвердится автоматически.'
                : expired
                  ? 'Срок действия ссылки истёк. Получите новую ссылку, чтобы подключить Telegram.'
                  : 'Подключите Telegram через бота, чтобы получать уведомления о своих задачах.'}
            </p>
            {pairing && !expired ? (
              <div className="space-y-3" data-pf-telegram-pairing>
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild className="pf-tg-login-btn min-h-11 gap-2 text-white">
                    <a href={pairing.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                      <TelegramGlyph className="size-4" /> Открыть Telegram
                    </a>
                  </Button>
                  <Button asChild variant="outline" className="min-h-11">
                    <a href={`tg://resolve?domain=${encodeURIComponent(status.botUsername.replace(/^@/, ''))}&start=${encodeURIComponent(new URL(pairing.url).searchParams.get('start') ?? '')}`}>
                      Открыть в приложении
                    </a>
                  </Button>
                </div>
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" /> Ожидаем подтверждение в Telegram…
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => void refreshStatus(true)}>Проверить подключение</Button>
                  <Button variant="ghost" size="sm" className="min-h-11" disabled={connecting} onClick={() => void startTelegramLogin()}>Новая ссылка</Button>
                </div>
              </div>
            ) : (
            <button
              type="button"
              onClick={() => void startTelegramLogin()}
              disabled={connecting}
              className="pf-tg-login-btn group relative inline-flex items-center gap-2.5 overflow-clip rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition-[transform,box-shadow] duration-300 ease-out motion-safe:hover:-translate-y-0.5 hover:shadow-xl hover:shadow-sky-500/40 motion-safe:active:translate-y-0 active:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="relative z-[1] flex items-center gap-2.5">
                {connecting ? (
                  <Loader2 className="size-5 motion-safe:animate-spin" />
                ) : (
                  <TelegramGlyph className="size-5 motion-safe:transition-transform duration-300 ease-out group-hover:-rotate-12 motion-safe:group-hover:scale-110" />
                )}
                <span>{connecting ? 'Подготавливаем ссылку…' : 'Подключить Telegram'}</span>
              </span>
            </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
