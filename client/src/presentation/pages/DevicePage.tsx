import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useContainer } from '@/infrastructure/di/container';
import type {
  AgentDeviceRepository,
  DeviceCodeInfo,
} from '@/application/agent/AgentDeviceRepository';
import { HttpError } from '@/lib/HttpError';

// User-facing страница для approve'а device-code'а, сгенерированного MCP-клиентом
// (`npx @projectsflow/mcp-server setup`). Юзер видит код в терминале, открывает эту
// страницу — она автоподхватит код из ?code= или попросит ввести руками.
//
// Логика:
//  1) если ?code= валиден — фетчим /info, показываем "Подключить Claude Code?".
//  2) approve → server создаёт agent-token + помечает device_code как approved.
//  3) MCP при следующем poll'е заберёт plaintext и сохранит локально.
export function DevicePage(): React.ReactElement {
  const { agentDeviceRepository } = useContainer();
  const [params, setParams] = useSearchParams();
  const codeFromUrl = params.get('code') ?? '';

  if (codeFromUrl.length === 0) {
    return <ManualCodeEntry onSubmit={(code) => setParams({ code })} />;
  }

  return (
    <DeviceFlow
      userCode={normalizeCode(codeFromUrl)}
      repo={agentDeviceRepository}
      onReset={() => setParams({})}
    />
  );
}

// Нормализуем "abcd1234" / "ABCD-1234" / "ABCD 1234" → "ABCD-1234"
function normalizeCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z2-9]/g, '');
  if (cleaned.length !== 8) return raw.toUpperCase();
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

function ManualCodeEntry({ onSubmit }: { onSubmit: (code: string) => void }): React.ReactElement {
  const [value, setValue] = useState('');

  const handle = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const normalized = normalizeCode(value);
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(normalized)) return;
    onSubmit(normalized);
  };

  return (
    <CenteredCard
      icon={<Bot className="size-6 text-primary" />}
      title="Подключение агента"
      description="Введи код, который показал Claude Code при запуске setup."
    >
      <form onSubmit={handle} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="device-code">Код</Label>
          <Input
            id="device-code"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ABCD-1234"
            autoFocus
            maxLength={9}
            className="font-mono uppercase tracking-widest"
          />
          <p className="text-xs text-muted-foreground">
            Код живёт 10&nbsp;минут с момента запуска setup.
          </p>
        </div>
        <Button type="submit" className="w-full" disabled={value.trim().length < 8}>
          Продолжить
        </Button>
      </form>
    </CenteredCard>
  );
}

function DeviceFlow({
  userCode,
  repo,
  onReset,
}: {
  userCode: string;
  repo: AgentDeviceRepository;
  onReset: () => void;
}): React.ReactElement {
  const [info, setInfo] = useState<DeviceCodeInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState('Claude Code');
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);
  // Снимаем "сейчас" один раз при маунте — useState lazy-init, чтобы react-hooks/purity
  // не ругался на Date.now() в render. Достаточно для лейбла «~X мин», live-countdown не нужен.
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    repo
      .getInfo(userCode)
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof HttpError) {
          if (err.status === 404) setLoadError('Код не найден или истёк. Запроси новый в Claude Code.');
          else if (err.status === 410) setLoadError('Срок действия кода истёк. Запроси новый.');
          else setLoadError(err.body.message ?? 'Не удалось загрузить код');
        } else {
          setLoadError('Сеть недоступна');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userCode, repo]);

  if (loadError) {
    return (
      <CenteredCard
        icon={<Bot className="size-6 text-destructive" />}
        title="Не получилось"
        description={loadError}
        footer={
          <Button variant="ghost" onClick={onReset}>
            Ввести другой код
          </Button>
        }
      >
        <div />
      </CenteredCard>
    );
  }

  if (!info) {
    return (
      <CenteredCard
        icon={<Loader2 className="size-6 animate-spin text-muted-foreground" />}
        title="Проверяем код…"
        description={userCode}
      >
        <div />
      </CenteredCard>
    );
  }

  if (info.status !== 'pending') {
    const map: Record<Exclude<typeof info.status, 'pending'>, string> = {
      approved: 'Этот код уже подтверждён — Claude Code должен забрать токен в ближайшие пару секунд.',
      consumed: 'Этот код уже использован. Подключение выполнено.',
      denied: 'Этот код был отклонён.',
      expired: 'Срок действия кода истёк. Запроси новый в Claude Code.',
    };
    return (
      <CenteredCard
        icon={<Check className="size-6 text-emerald-500" />}
        title="Готово"
        description={map[info.status]}
        footer={
          <Button asChild variant="ghost">
            <Link to="/">Вернуться на главную</Link>
          </Button>
        }
      >
        <div />
      </CenteredCard>
    );
  }

  if (approved) {
    return (
      <CenteredCard
        icon={<Check className="size-6 text-emerald-500" />}
        title="Подключено"
        description="Возвращайся в терминал — Claude Code заберёт токен и завершит setup."
        footer={
          <Button asChild variant="ghost">
            <Link to="/">На главную</Link>
          </Button>
        }
      >
        <div />
      </CenteredCard>
    );
  }

  const handleApprove = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (tokenName.trim().length === 0) return;
    setSubmitting(true);
    try {
      await repo.approve(userCode, tokenName.trim());
      setApproved(true);
    } catch (err) {
      if (err instanceof HttpError && err.body.message) {
        setLoadError(err.body.message);
      } else {
        setLoadError('Не удалось подтвердить. Попробуй ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const minutesLeft = Math.max(0, Math.round((info.expiresAt.getTime() - mountedAt) / 60000));

  return (
    <CenteredCard
      icon={<Bot className="size-6 text-primary" />}
      title="Подключить Claude Code?"
      description={
        <>
          Этот код запрашивает доступ к&nbsp;твоему ProjectsFlow-аккаунту. Будет создан
          agent-токен с&nbsp;правами читать credentials и&nbsp;управлять задачами.
        </>
      }
    >
      <form onSubmit={handleApprove} className="space-y-4">
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-center">
          <p className="font-mono text-lg tracking-widest text-foreground">{userCode}</p>
          <p className="text-xs text-muted-foreground">
            истекает через&nbsp;~{minutesLeft}&nbsp;мин
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="token-name">Название токена</Label>
          <Input
            id="token-name"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            maxLength={120}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Полезно если у&nbsp;тебя несколько устройств — например, «MacBook» или «Рабочий ПК».
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onReset}>
            Отмена
          </Button>
          <Button type="submit" className="flex-1" disabled={submitting || tokenName.trim().length === 0}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Подключить
          </Button>
        </div>
      </form>
    </CenteredCard>
  );
}

function CenteredCard({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2.5">
          <div className="grid size-10 place-items-center rounded-md border bg-muted">{icon}</div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer && <div className="border-t px-6 py-3">{footer}</div>}
      </Card>
    </div>
  );
}
