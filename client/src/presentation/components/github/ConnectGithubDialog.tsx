import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Github } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { DeviceFlowStart } from '@/application/github/GithubRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { HttpError } from '@/lib/HttpError';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ConnectGithubDialog({ open, onOpenChange }: Props): React.ReactElement {
  const { githubRepository } = useContainer();
  const { applySet } = useGithubConnection();
  const [start, setStart] = useState<DeviceFlowStart | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'waiting' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = (): void => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  // Сброс состояния при закрытии диалога
  useEffect(() => {
    if (!open) {
      stopPolling();
      setStart(null);
      setStatus('idle');
      setErrorMsg(null);
    }
  }, [open]);

  // На открытии — стартуем device flow
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus('starting');
    setErrorMsg(null);
    githubRepository
      .startDeviceFlow()
      .then((s) => {
        if (cancelled) return;
        setStart(s);
        setStatus('waiting');
        pollNext(s.intervalSec * 1000);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus('error');
        if (e instanceof HttpError && e.status === 503) {
          setErrorMsg('GitHub-интеграция не настроена на сервере (нет GITHUB_CLIENT_ID).');
        } else {
          setErrorMsg('Не удалось запустить подключение. Попробуй ещё раз.');
        }
      });
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pollNext = (delayMs: number): void => {
    pollTimer.current = setTimeout(async () => {
      try {
        const result = await githubRepository.pollDeviceFlow();
        if (result.status === 'connected') {
          applySet(result.connection);
          toast.success('GitHub подключён', {
            description: `Аккаунт @${result.connection.githubLogin} привязан. Теперь можно выбирать репозитории на странице проекта.`,
            duration: 5000,
          });
          onOpenChange(false);
          return;
        }
        if (result.status === 'expired') {
          setStatus('error');
          setErrorMsg('Код истёк. Закрой диалог и попробуй заново.');
          return;
        }
        // pending — ждём дальше. slowDownSec если есть — увеличиваем интервал.
        const nextDelay = result.slowDownSec ? result.slowDownSec * 1000 : (start?.intervalSec ?? 5) * 1000;
        pollNext(nextDelay);
      } catch (e) {
        console.error('[ConnectGithubDialog] poll error:', e);
        setStatus('error');
        setErrorMsg('Ошибка при опросе GitHub. Попробуй ещё раз.');
      }
    }, delayMs);
  };

  const copyCode = async (): Promise<void> => {
    if (!start) return;
    try {
      await navigator.clipboard.writeText(start.userCode);
      toast.success('Код скопирован');
    } catch {
      toast.error('Не удалось скопировать. Введи код руками.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-5" />
            Подключение GitHub
          </DialogTitle>
          <DialogDescription>
            Открой страницу GitHub и введи код. После того, как разрешишь доступ — окно закроется само.
          </DialogDescription>
        </DialogHeader>

        {status === 'starting' && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Запрашиваем код у GitHub…
          </div>
        )}

        {status === 'waiting' && start && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Введи этот код:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest">
                  {start.userCode}
                </code>
                <Button type="button" variant="outline" size="icon" onClick={copyCode} aria-label="Скопировать">
                  <Copy />
                </Button>
              </div>
            </div>
            <Button asChild variant="default" className="w-full">
              <a href={start.verificationUri} target="_blank" rel="noreferrer noopener">
                <ExternalLink />
                Открыть {new URL(start.verificationUri).hostname}
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Ждём разрешения от GitHub… Это окно само закроется, как только ты подтвердишь.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-destructive">{errorMsg ?? 'Что-то пошло не так'}</p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {status === 'waiting' ? 'Отмена' : 'Закрыть'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
