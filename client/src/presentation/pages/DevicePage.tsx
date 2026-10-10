import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, CircleAlert, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AuthFormCard, authFieldClass } from '@/presentation/auth/AuthFormCard';
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
    <AuthFormCard
      title="Подключение агента"
      description="Введи код, который показал Claude Code при запуске setup."
    >
      <form onSubmit={handle} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="device-code">Код</Label>
          <Input
            id="device-code"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ABCD-1234"
            autoFocus
            maxLength={9}
            className={cn(authFieldClass, 'font-mono uppercase tracking-widest')}
          />
          <p className="text-xs text-muted-foreground">
            Код живёт 10&nbsp;минут с момента запуска setup.
          </p>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={value.trim().length < 8}>
          Продолжить
        </Button>
      </form>
    </AuthFormCard>
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
      <AuthFormCard
        icon={<StateIcon tone="error"><CircleAlert /></StateIcon>}
        title="Не получилось"
        description={loadError}
        footer={
          <Button variant="ghost" onClick={onReset}>
            Ввести другой код
          </Button>
        }
      />
    );
  }

  if (!info) {
    return (
      <AuthFormCard
        icon={<StateIcon tone="neutral"><Loader2 className="motion-safe:animate-spin" /></StateIcon>}
        title="Проверяем код…"
        description={<span className="font-mono tracking-widest">{userCode}</span>}
      />
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
      <AuthFormCard
        icon={<StateIcon tone="done"><Check /></StateIcon>}
        title="Готово"
        description={map[info.status]}
        footer={
          <Button asChild variant="ghost">
            <Link to="/">Вернуться на главную</Link>
          </Button>
        }
      />
    );
  }

  if (approved) {
    return (
      <AuthFormCard
        icon={<StateIcon tone="done"><Check /></StateIcon>}
        title="Подключено"
        description="Возвращайся в терминал — Claude Code заберёт токен и завершит setup."
        footer={
          <Button asChild variant="ghost">
            <Link to="/">На главную</Link>
          </Button>
        }
      />
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
    <AuthFormCard
      title="Подключить Claude Code?"
      description={
        <>
          Этот код запрашивает доступ к&nbsp;твоему ProjectsFlow-аккаунту. Будет создан
          agent-токен с&nbsp;правами читать credentials и&nbsp;управлять задачами.
        </>
      }
    >
      <form onSubmit={handleApprove} className="flex flex-col gap-4">
        <div className="rounded-xl bg-panel px-4 py-3 text-center">
          <p className="font-mono text-lg tracking-widest text-foreground">{userCode}</p>
          <p className="text-xs text-muted-foreground">
            истекает через&nbsp;~{minutesLeft}&nbsp;мин
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="token-name">Название токена</Label>
          <Input
            id="token-name"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            maxLength={120}
            autoFocus
            className={authFieldClass}
          />
          <p className="text-xs text-muted-foreground">
            Полезно если у&nbsp;тебя несколько устройств — например, «MacBook» или «Рабочий ПК».
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="lg" className="flex-1" onClick={onReset}>
            Отмена
          </Button>
          <Button type="submit" size="lg" className="flex-1" disabled={submitting || tokenName.trim().length === 0}>
            {submitting && <Loader2 className="size-4 motion-safe:animate-spin" />}
            Подключить
          </Button>
        </div>
      </form>
    </AuthFormCard>
  );
}

// Значок состояния над заголовком экрана: цвет = смысл (ошибка, готово, ожидание).
const STATE_ICON_TONE = {
  error: 'bg-destructive-soft text-destructive',
  done: 'bg-done-soft text-done',
  neutral: 'bg-panel text-muted-foreground',
} as const;

function StateIcon({
  tone,
  children,
}: {
  tone: keyof typeof STATE_ICON_TONE;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-10 place-items-center rounded-xl [&_svg]:size-5', STATE_ICON_TONE[tone])}
    >
      {children}
    </span>
  );
}
