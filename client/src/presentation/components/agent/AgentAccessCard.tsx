import { useEffect, useState, type FormEvent } from 'react';
import { Bot, Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { AgentToken } from '@/domain/agent/AgentToken';

// Форматирование "когда последний раз использован". Возвращает Russian relative phrase
// или абсолютную дату для давних дат.
function formatLastUsed(date: Date | null): string {
  if (!date) return 'не использовался';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ч назад`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} дн назад`;
  return date.toLocaleDateString('ru');
}

export function AgentAccessCard(): React.ReactElement {
  const { agentTokenRepository } = useContainer();
  const [tokens, setTokens] = useState<AgentToken[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  // Modal показа свежесозданного токена (plaintext доступен 1 раз).
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    agentTokenRepository
      .list()
      .then((list) => {
        if (cancelled) return;
        setTokens(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(`Не удалось загрузить токены: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentTokenRepository]);

  const handleCreated = (token: AgentToken, plaintext: string): void => {
    setTokens((prev) => (prev ? [token, ...prev] : [token]));
    setCreatedToken(plaintext);
  };

  const handleRevoke = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`Отозвать токен "${name}"? Агенты, использующие его, потеряют доступ.`)) {
      return;
    }
    try {
      await agentTokenRepository.revoke(id);
      // Обновляем локально вместо refetch'а.
      setTokens((prev) =>
        prev?.map((t) => (t.id === id ? { ...t, revokedAt: new Date() } : t)) ?? null,
      );
      toast.success('Токен отозван');
    } catch (e) {
      toast.error(`Не удалось отозвать: ${(e as Error).message}`);
    }
  };

  const active = tokens?.filter((t) => !t.revokedAt) ?? [];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="size-5" />
              Доступ для агентов
            </CardTitle>
            <CardDescription>
              Токены для внешних агентов (Claude Code MCP-сервер и пр.). Дают доступ к&nbsp;credentials
              твоих проектов через API.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Создать токен
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Загружаем…</p>
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока нет активных токенов. Создай первый — он понадобится для подключения MCP-сервера
              ProjectsFlow к&nbsp;Claude Code.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {active.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{t.tokenPrefix}…</span>
                      <span className="mx-1.5">·</span>
                      создан {t.createdAt.toLocaleDateString('ru')}
                      <span className="mx-1.5">·</span>
                      {formatLastUsed(t.lastUsedAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => handleRevoke(t.id, t.name)}
                    aria-label="Отозвать токен"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      <NewTokenRevealDialog
        plaintext={createdToken}
        onClose={() => setCreatedToken(null)}
      />
    </>
  );
}


// =========================================================
// Диалог создания нового токена — спрашивает name.
// =========================================================
function CreateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (token: AgentToken, plaintext: string) => void;
}): React.ReactElement {
  const { agentTokenRepository } = useContainer();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Пред-заполняем дефолтным именем "Claude Code · DD.MM.YY" — большинству юзеров
  // подходит, можно просто Enter нажать. Кому нужно — стирает и пишет своё.
  useEffect(() => {
    if (open) {
      const dateLabel = new Date().toLocaleDateString('ru', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      });
      setName(`Claude Code · ${dateLabel}`);
    } else {
      setName('');
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (name.trim().length === 0) return;
    setSubmitting(true);
    try {
      const { token, plaintext } = await agentTokenRepository.create(name.trim());
      onCreated(token, plaintext);
      onOpenChange(false);
    } catch (err) {
      toast.error(`Не удалось создать: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый agent-токен</DialogTitle>
          <DialogDescription>
            Дай токену описательное имя — например, «Claude Code на ноутбуке».
            Имя используется только для опознания в списке.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="token-name">Название</Label>
            <Input
              id="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              placeholder="Claude Code на ноутбуке"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={submitting || name.trim().length === 0}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Создать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================
// Диалог показа plaintext-токена (1 раз). После закрытия — только prefix в списке.
// =========================================================
function NewTokenRevealDialog({
  plaintext,
  onClose,
}: {
  plaintext: string | null;
  onClose: () => void;
}): React.ReactElement {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!plaintext) setCopiedKey(null);
  }, [plaintext]);

  // Токен пробрасывается через -e (env vars), конфиг-файл создавать не нужно.
  // API URL берём из current origin — подходит для прода, devtunnel и localhost.
  // `--scope user` — MCP виден во всех проектах Claude Code.
  // `@latest` — npx не зацепится за устаревший кеш при будущих публикациях.
  const apiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : '';
  const installCommand = plaintext
    ? `claude mcp add --scope user projectsflow -e PROJECTSFLOW_API_URL=${apiUrl} -e PROJECTSFLOW_AGENT_TOKEN=${plaintext} -- npx -y @projectsflow/mcp-server@latest`
    : '';
  const claudePrompt = plaintext
    ? [
        'Установи MCP-сервер ProjectsFlow в моём Claude Code. Запусти команду:',
        '',
        installCommand,
        '',
        'Подтверди bash-разрешение. После установки переоткрой чат и проверь,',
        'что доступны 6 tool\'ов: pf_list_projects, pf_list_credentials,',
        'pf_get_credential, pf_list_tasks, pf_move_task, pf_link_commit_to_task.',
      ].join('\n')
    : '';

  const handleCopy = async (key: string, text: string, successMsg: string): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(successMsg);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <Dialog open={plaintext !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Токен создан</DialogTitle>
          <DialogDescription>
            Выбери способ подключения. Plaintext-токен ниже будет доступен только пока открыто это окно.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            ⚠️ Этот токен даёт доступ ко всем твоим credentials. Не публикуй его, храни в надёжном месте.
          </div>

          {/* Способ 1: промпт для Claude Code (рекомендуется) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                Через Claude Code <span className="text-xs font-normal text-muted-foreground">— рекомендуется</span>
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5"
                onClick={() => handleCopy('prompt', claudePrompt, 'Промпт скопирован')}
              >
                {copiedKey === 'prompt' ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                Скопировать промпт
              </Button>
            </div>
            <pre className="max-h-48 overflow-y-auto break-all whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed">
              {claudePrompt}
            </pre>
            <p className="text-xs text-muted-foreground">
              Вставь этот промпт в&nbsp;Claude Code (любой чат) — он сам выполнит установку и&nbsp;проверит результат.
              Никакого терминала.
            </p>
          </div>

          {/* Способ 2: команда для терминала */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Через терминал (env-vars)</p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5"
                onClick={() => handleCopy('cmd', installCommand, 'Команда скопирована')}
              >
                {copiedKey === 'cmd' ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                Скопировать команду
              </Button>
            </div>
            <pre className="overflow-x-auto break-all whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed">
              {installCommand}
            </pre>
            <p className="text-xs text-muted-foreground">
              Для тех кто работает в Cursor / Continue / Copilot CLI или предпочитает запускать самостоятельно.
            </p>
          </div>

          {/* Полный token — на случай если нужно скопировать отдельно */}
          <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-muted-foreground">
              Показать токен отдельно
            </summary>
            <div className="relative mt-2">
              <div className="break-all rounded bg-background px-2.5 py-1.5 pr-9 font-mono text-[11px]">
                {plaintext}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-0.5 top-0.5 size-7"
                onClick={() => handleCopy('token', plaintext ?? '', 'Токен скопирован')}
                aria-label="Скопировать"
              >
                {copiedKey === 'token' ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
