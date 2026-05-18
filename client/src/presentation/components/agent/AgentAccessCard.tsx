import { useEffect, useState, type FormEvent } from 'react';
import { Bot, Check, Copy, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
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
  const [connectOpen, setConnectOpen] = useState(false);
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              <Sparkles className="size-4" />
              Подключить Claude Code
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Создать токен вручную
            </Button>
          </div>
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

      <ConnectClaudeCodeDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  );
}

// =========================================================
// Диалог «Подключить Claude Code» — рекомендуемый flow через device-pairing.
// Юзер копирует одну npx-команду, в терминале появляется код, юзер кликает
// «Открыть страницу подтверждения» (которая редиректит на /device?code=…).
// =========================================================
function ConnectClaudeCodeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  // Команда запускает MCP в setup-mode — он сам сходит за device_code'ом и распечатает URL.
  // `--scope user` через `npx -y @projectsflow/mcp-server@latest setup` НЕ делает MCP add'а
  // (это отдельный шаг после успешного setup'а — печатается в инструкции).
  const apiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : '';
  const setupCommand = `PROJECTSFLOW_API_URL=${apiUrl} npx -y @projectsflow/mcp-server@latest setup`;
  const installCommand = `claude mcp add --scope user projectsflow -- npx -y @projectsflow/mcp-server@latest`;

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const handleCopy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Скопировано');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Подключить Claude Code</DialogTitle>
          <DialogDescription>
            Двухшаговый сетап без копипасты токена: одна команда для setup'а, одна — для регистрации MCP.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                1
              </span>
              <p className="text-sm font-medium">Запусти setup в&nbsp;терминале</p>
            </div>
            <div className="relative">
              <pre className="overflow-x-auto rounded-md border bg-muted px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed">
                {setupCommand}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 size-7"
                onClick={() => handleCopy(setupCommand)}
                aria-label="Скопировать"
              >
                {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              MCP покажет код и&nbsp;ссылку — нажми на&nbsp;ссылку или открой
              «<a className="text-primary hover:underline" href="/device" target="_blank" rel="noreferrer">/device</a>»
              на этом домене. Подтверди — токен подтянется автоматически.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                2
              </span>
              <p className="text-sm font-medium">Зарегистрируй MCP в&nbsp;Claude Code</p>
            </div>
            <div className="relative">
              <pre className="overflow-x-auto rounded-md border bg-muted px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed">
                {installCommand}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 size-7"
                onClick={() => handleCopy(installCommand)}
                aria-label="Скопировать"
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1">--scope user</code> делает MCP видимым во&nbsp;всех проектах
              Claude Code, а&nbsp;не&nbsp;только в&nbsp;текущем. После этого MCP-сервер прочитает токен из&nbsp;файла,
              созданного на&nbsp;шаге&nbsp;1.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  useEffect(() => {
    if (!open) setName('');
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
  const [copied, setCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);

  useEffect(() => {
    if (!plaintext) {
      setCopied(false);
      setCmdCopied(false);
    }
  }, [plaintext]);

  // Команда для Claude Code: токен пробрасывается через -e (env vars),
  // конфиг-файл создавать не нужно. API URL берём из текущего origin —
  // подходит и для прода, и для devtunnel'а, и для localhost.
  // `--scope user` чтобы MCP видно во всех проектах, а не только в том, откуда
  // юзер запустил `claude mcp add`. `@latest` — чтобы npx не зацепился за стар-
  // ший кеш при следующих публикациях.
  const apiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api` : '';
  const mcpCommand = plaintext
    ? `claude mcp add --scope user projectsflow -e PROJECTSFLOW_API_URL=${apiUrl} -e PROJECTSFLOW_AGENT_TOKEN=${plaintext} -- npx -y @projectsflow/mcp-server@latest`
    : '';

  const handleCopy = async (): Promise<void> => {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      toast.success('Скопировано в буфер');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const handleCopyCommand = async (): Promise<void> => {
    if (!mcpCommand) return;
    try {
      await navigator.clipboard.writeText(mcpCommand);
      setCmdCopied(true);
      toast.success('Команда скопирована');
      setTimeout(() => setCmdCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <Dialog open={plaintext !== null} onOpenChange={(o) => !o && onClose()}>
      {/* max-w-xl шире (576px вместо 512px) чтобы длинный токен hash-style помещался лучше.
          Сам токен оборачивается break-all — переносится по любому символу, без horizontal scroll. */}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Токен создан</DialogTitle>
          <DialogDescription>
            <strong>Скопируй токен сейчас</strong> — после закрытия этого окна он будет
            недоступен. Если потеряешь, придётся создать новый.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            ⚠️ Этот токен даёт доступ ко всем твоим credentials. Не публикуй его, храни в надёжном месте.
          </div>
          <div className="relative">
            {/* break-all для hash-style токена — переносится по любому символу.
                pr-10 оставляет место для copy-кнопки в верхнем правом углу. */}
            <div className="break-all rounded-md border bg-muted px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed">
              {plaintext}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1 size-7"
              onClick={handleCopy}
              aria-label="Скопировать"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Подключение в Claude Code — одна команда:</p>
            <div className="relative">
              <div className="break-all rounded-md border bg-muted/40 px-3 py-2 pr-10 font-mono text-xs leading-relaxed">
                {mcpCommand}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 size-7"
                onClick={handleCopyCommand}
                aria-label="Скопировать команду"
              >
                {cmdCopied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p>
              Токен передаётся через env-переменные Claude Code — конфиг-файл создавать
              не&nbsp;нужно. Скопируй команду и&nbsp;вставь в&nbsp;терминал.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
