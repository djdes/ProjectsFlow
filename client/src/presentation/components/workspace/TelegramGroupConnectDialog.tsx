import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useContainer } from '@/infrastructure/di/container';
import type { TelegramGroupLinkPurpose } from '@/domain/workspace/TelegramWorkGroup';

// Как часто спрашиваем сервер, подключилась ли группа, и сколько ждём (код живёт 30 минут).
const POLL_MS = 3_000;
const WAIT_LIMIT_MS = 10 * 60_000;

export type ConnectedTelegramGroup = { readonly chatId: number; readonly title: string | null };

type LinkState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'error'; readonly message: string };

/**
 * «Подключить группу»: ссылка t.me/<bot>?startgroup=… открывает в Telegram выбор группы. Бот
 * добавляется и получает в группе код — id группы сервер узнаёт сам. Окно опрашивает `detect`,
 * пока группа не появится.
 */
export function TelegramGroupConnectDialog({
  open,
  onOpenChange,
  workspaceId,
  purpose,
  detect,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  purpose: TelegramGroupLinkPurpose;
  // Вернуть подключённую группу, когда она появится (null — пока нет).
  detect: () => Promise<ConnectedTelegramGroup | null>;
  onConnected: (group: ConnectedTelegramGroup) => void;
}): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const [link, setLink] = useState<LinkState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  // detect/onConnected меняются на каждом рендере родителя — опрос держит актуальные версии.
  const detectRef = useRef(detect);
  const connectedRef = useRef(onConnected);
  useEffect(() => {
    detectRef.current = detect;
    connectedRef.current = onConnected;
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLink({ status: 'loading' });
    setTimedOut(false);
    workspaceRepository
      .createTelegramGroupLink(workspaceId, purpose)
      .then((result) => {
        if (!cancelled) setLink({ status: 'ready', url: result.url });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLink({ status: 'error', message: (error as Error).message || 'Не удалось получить ссылку' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, purpose, attempt, workspaceRepository]);

  useEffect(() => {
    if (!open || link.status !== 'ready') return;
    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      if (cancelled) return;
      if (Date.now() - startedAt > WAIT_LIMIT_MS) {
        setTimedOut(true);
        return;
      }
      try {
        const group = await detectRef.current();
        if (cancelled) return;
        if (group) {
          connectedRef.current(group);
          return;
        }
      } catch {
        // Сеть моргнула — просто спросим ещё раз.
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    timer = setTimeout(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, link]);

  const title = purpose === 'main' ? 'Подключить основную группу' : 'Подключить рабочую группу';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Id группы вводить не нужно — бот узнает его сам.</DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-1.5 ps-5 text-sm">
          <li>Нажмите «Открыть Telegram» и выберите группу — подключать должен её администратор.</li>
          <li>Telegram добавит @ProjectsFlow_Bot (если его там ещё нет) и передаст ему код.</li>
          <li>Группа появится здесь сама — окно закроется.</li>
        </ol>
        {link.status === 'error' ? (
          <p className="text-sm text-destructive">{link.message}</p>
        ) : timedOut ? (
          <p className="text-sm text-muted-foreground">
            Группа так и не подключилась. Получите новую ссылку и попробуйте ещё раз.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" />
            {link.status === 'loading' ? 'Готовим ссылку…' : 'Ждём подключения группы…'}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          {link.status === 'error' || timedOut ? (
            <Button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Новая ссылка
            </Button>
          ) : (
            <Button asChild disabled={link.status !== 'ready'}>
              <a
                href={link.status === 'ready' ? link.url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={link.status !== 'ready'}
              >
                <ExternalLink className="size-4" />
                Открыть Telegram
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
