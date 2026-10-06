import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, Loader2, PlugZap, RefreshCw, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import { useContainer } from '@/infrastructure/di/container';
import type {
  LlmAdminStatus,
  LlmConnectionStatus,
  LlmPendingLogin,
  LlmServerQueue,
  LlmTestResult,
} from '@/domain/llm/LlmConnection';

// Очереди, которые сервер может выполнять сам через подписку вместо диспетчера Ralph.
const QUEUES: ReadonlyArray<{ id: LlmServerQueue; title: string; hint: string }> = [
  { id: 'ai_prompt', title: 'Кнопки AI', hint: 'Улучшение черновика и разбор текста на задачи' },
  { id: 'ai_conversation', title: 'AI-чаты', hint: 'Ответы в чатах проектов и студии' },
  { id: 'monitoring', title: 'Анализ серверов', hint: 'Разбор метрик мониторинга по кнопке и по алерту' },
  { id: 'commit_sync', title: 'Сверка коммитов', hint: 'Сопоставление коммитов с задачами' },
];

// Модели из прайса сервера — подсказки для полей, можно вписать и свою.
const MODEL_SUGGESTIONS = [
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-6-astra',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.3-codex',
];

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  team: 'Business',
  business: 'Business',
  enterprise: 'Enterprise',
};

function errorMessage(e: unknown): string {
  const body = (e as { body?: { message?: unknown } } | null)?.body;
  if (body && typeof body.message === 'string') return body.message;
  return e instanceof Error ? e.message : String(e);
}

// Подписка ChatGPT платформы: одно подключение на всех, вход по коду делает админ.
export function AdminLlmPanel(): React.ReactElement {
  const { llmAdminRepository: repo } = useContainer();
  const [status, setStatus] = useState<LlmAdminStatus | null>(null);
  const [login, setLogin] = useState<LlmPendingLogin | null>(null);
  const [busy, setBusy] = useState<'start' | 'cancel' | 'disconnect' | 'test' | null>(null);
  const [test, setTest] = useState<LlmTestResult | null>(null);
  const pollTimer = useRef<number | null>(null);

  const reload = useCallback(async (): Promise<LlmAdminStatus | null> => {
    try {
      const next = await repo.getStatus();
      setStatus(next);
      setLogin(next.pendingLogin);
      return next;
    } catch (e) {
      toast.error(`Не удалось загрузить статус: ${errorMessage(e)}`);
      return null;
    }
  }, [repo]);

  const stopPolling = useCallback((): void => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const schedulePoll = useCallback(
    (intervalSec: number): void => {
      stopPolling();
      pollTimer.current = window.setTimeout(async () => {
        try {
          const result = await repo.pollLogin();
          if (result.status === 'pending') {
            setLogin(result.pendingLogin);
            schedulePoll(result.pendingLogin.intervalSec);
            return;
          }
          setLogin(null);
          if (result.status === 'connected') toast.success('Подписка ChatGPT подключена');
          if (result.status === 'expired') toast.error('Код истёк — начните вход заново');
          await reload();
        } catch (e) {
          toast.error(`Не удалось проверить вход: ${errorMessage(e)}`);
          schedulePoll(Math.max(intervalSec, 10));
        }
      }, Math.max(3, intervalSec) * 1000);
    },
    [repo, reload, stopPolling],
  );

  useEffect(() => {
    void reload().then((next) => {
      // Вход, начатый до перезагрузки страницы, продолжаем ждать.
      if (next?.pendingLogin) schedulePoll(next.pendingLogin.intervalSec);
    });
    return stopPolling;
  }, [reload, schedulePoll, stopPolling]);

  const startLogin = async (): Promise<void> => {
    setBusy('start');
    try {
      const pending = await repo.startLogin();
      setLogin(pending);
      schedulePoll(pending.intervalSec);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const cancelLogin = async (): Promise<void> => {
    setBusy('cancel');
    stopPolling();
    try {
      await repo.cancelLogin();
    } catch {
      // Вход мог уже истечь — состояние всё равно перечитаем.
    } finally {
      setLogin(null);
      setBusy(null);
      await reload();
    }
  };

  const disconnect = async (): Promise<void> => {
    if (!window.confirm('Отключить подписку? Короткие задания вернутся диспетчеру, а шлюз для Ralph перестанет отвечать.')) {
      return;
    }
    setBusy('disconnect');
    try {
      await repo.disconnect();
      setTest(null);
      toast.success('Подписка отключена');
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async (): Promise<void> => {
    setBusy('test');
    setTest(null);
    try {
      setTest(await repo.test());
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Загружаем…
      </div>
    );
  }

  const connection = status.connection;
  const needsLogin = !connection || connection.status !== 'active';

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold">Подписка ChatGPT</h2>
            <p className="text-sm text-muted-foreground">
              Одна подписка на всю платформу: через неё идут кнопки AI, чаты и воркеры Ralph. Токены хранятся
              только на сервере.
            </p>
          </div>
          <StatusPill status={connection?.status ?? null} />
        </div>

        {connection && (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Field label="Аккаунт" value={connection.accountEmail ?? '—'} />
            <Field label="Тариф" value={connection.planType ? (PLAN_LABEL[connection.planType] ?? connection.planType) : '—'} />
            <Field label="Токен обновлён" value={connection.lastRefreshAt ? relativeTime(new Date(connection.lastRefreshAt)) : '—'} />
            <Field label="Последний запрос" value={connection.lastUsedAt ? relativeTime(new Date(connection.lastUsedAt)) : 'ещё не было'} />
            {connection.rateLimitedUntil && new Date(connection.rateLimitedUntil) > new Date() && (
              <Field
                label="Лимит подписки"
                value={`пауза до ${new Date(connection.rateLimitedUntil).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`}
                tone="warn"
              />
            )}
            {connection.lastError && <Field label="Последняя ошибка" value={connection.lastError} tone="warn" wide />}
          </dl>
        )}

        {login ? (
          <LoginCode login={login} busy={busy === 'cancel'} onCancel={() => void cancelLogin()} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {needsLogin && (
              <Button onClick={() => void startLogin()} disabled={busy !== null}>
                {busy === 'start' ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {connection ? 'Войти заново по коду' : 'Войти по коду'}
              </Button>
            )}
            {connection && (
              <Button variant="outline" onClick={() => void runTest()} disabled={busy !== null}>
                {busy === 'test' ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                Проверить связь
              </Button>
            )}
            {connection && !needsLogin && (
              <Button variant="outline" onClick={() => void startLogin()} disabled={busy !== null}>
                <RefreshCw className="size-4" /> Сменить аккаунт
              </Button>
            )}
            {connection && (
              <Button variant="ghost" onClick={() => void disconnect()} disabled={busy !== null}>
                <Unplug className="size-4" /> Отключить
              </Button>
            )}
          </div>
        )}

        {test && (
          <p
            className={cn(
              'rounded-md px-3 py-2 text-sm',
              test.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive',
            )}
          >
            {test.ok
              ? `Связь есть: ${test.model} ответила «${test.reply ?? ''}» за ${(test.latencyMs / 1000).toFixed(1)} с.`
              : `Не получилось: ${test.error ?? 'неизвестная ошибка'}`}
          </p>
        )}
      </section>

      <SettingsSection status={status} onSaved={(settings) => setStatus({ ...status, settings })} />

      <section className="space-y-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground sm:p-5">
        <h3 className="font-medium text-foreground">Воркеры Ralph</h3>
        <p>
          codex на машине диспетчера ходит в модель через шлюз сервера по адресу{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/agent/llm/v1</code> с коротким токеном
          воркера. Токены подписки на машину диспетчера не попадают.
        </p>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: LlmConnectionStatus | null }): React.ReactElement {
  const view =
    status === 'active'
      ? { label: 'Подключено', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' }
      : status === 'reauth_required'
        ? { label: 'Нужен вход по коду', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' }
        : { label: 'Не подключено', className: 'bg-muted text-muted-foreground' };
  return <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', view.className)}>{view.label}</span>;
}

function Field({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: string;
  tone?: 'warn';
  wide?: boolean;
}): React.ReactElement {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('break-words', tone === 'warn' && 'text-amber-700 dark:text-amber-400')}>{value}</dd>
    </div>
  );
}

function LoginCode({
  login,
  busy,
  onCancel,
}: {
  login: LlmPendingLogin;
  busy: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(login.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать — выделите код вручную');
    }
  };
  return (
    <div className="space-y-3 rounded-md border border-dashed p-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>
          Откройте{' '}
          <a href={login.verificationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
            {login.verificationUrl.replace(/^https?:\/\//, '')} <ExternalLink className="size-3.5" />
          </a>{' '}
          и войдите в ChatGPT под аккаунтом с подпиской.
        </li>
        <li>Введите код:</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <span className="select-all rounded-md bg-muted px-3 py-2 font-mono text-2xl font-semibold tracking-[0.2em]">
          {login.userCode}
        </span>
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Ждём подтверждения · код действует до{' '}
          {new Date(login.expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Отменить
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Если OpenAI пишет, что вход по коду недоступен, включите его в ChatGPT: Settings → Security. В рабочем
        пространстве это делает его администратор.
      </p>
    </div>
  );
}

function SettingsSection({
  status,
  onSaved,
}: {
  status: LlmAdminStatus;
  onSaved: (settings: LlmAdminStatus['settings']) => void;
}): React.ReactElement {
  const { llmAdminRepository: repo } = useContainer();
  const [defaultModel, setDefaultModel] = useState(status.settings.defaultModel);
  const [fastModel, setFastModel] = useState(status.settings.fastModel);
  const [queues, setQueues] = useState<readonly LlmServerQueue[]>(status.settings.serverQueues);
  const [saving, setSaving] = useState(false);

  const dirty =
    defaultModel !== status.settings.defaultModel ||
    fastModel !== status.settings.fastModel ||
    queues.length !== status.settings.serverQueues.length ||
    queues.some((q) => !status.settings.serverQueues.includes(q));

  const toggle = (queue: LlmServerQueue, on: boolean): void => {
    setQueues((prev) => (on ? [...prev, queue] : prev.filter((q) => q !== queue)));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const settings = await repo.updateSettings({ defaultModel, fastModel, serverQueues: queues });
      onSaved(settings);
      toast.success('Настройки сохранены');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h3 className="font-medium">Что выполняет сервер</h3>
        <p className="text-sm text-muted-foreground">
          Включённые очереди сервер берёт сам, без опроса диспетчера. Если подписка недоступна, задания
          автоматически остаются Ralph.
        </p>
      </div>
      <ul className="divide-y rounded-md border">
        {QUEUES.map((q) => (
          <li key={q.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{q.title}</p>
              <p className="text-xs text-muted-foreground">{q.hint}</p>
            </div>
            <Switch
              checked={queues.includes(q.id)}
              onCheckedChange={(on) => toggle(q.id, on)}
              aria-label={`Выполнять на сервере: ${q.title}`}
            />
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="llm-default-model">Основная модель</Label>
          <Input id="llm-default-model" list="llm-models" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
          <p className="text-xs text-muted-foreground">Ответы в чатах, анализ, развёрнутые постановки.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="llm-fast-model">Быстрая модель</Label>
          <Input id="llm-fast-model" list="llm-models" value={fastModel} onChange={(e) => setFastModel(e.target.value)} />
          <p className="text-xs text-muted-foreground">Разбор на задачи и сверка — бережёт лимит подписки.</p>
        </div>
        <datalist id="llm-models">
          {MODEL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving && <Loader2 className="size-4 animate-spin" />} Сохранить
        </Button>
      </div>
    </section>
  );
}
