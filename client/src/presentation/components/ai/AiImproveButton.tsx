import { useRef, useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
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
import {
  ImproveTaskDescriptionError,
  type ImproveTaskDescriptionErrorCode,
} from '@/application/ai/ImproveTaskDescription';
import { cn } from '@/lib/utils';

type Props = {
  /** Текущий текст задачи. Disabled пока пуст. */
  readonly text: string;
  /** projectId если задача в проекте; null = inbox/без проекта. */
  readonly projectId: string | null;
  /** Колбэк: устанавливаем новый текст ТОЛЬКО после нажатия «Применить». */
  readonly onImproved: (improved: string) => void;
  /** Внешний disabled — например, форма в процессе сохранения. */
  readonly disabled?: boolean;
  /** Опционально: компактный вариант (для QuickAddTodo). */
  readonly compact?: boolean;
};

// Фаза диалога предпросмотра:
//  idle    — диалог закрыт, кнопка в покое;
//  loading — ждём AI (5–45с), показываем спиннер + «Отмена»;
//  preview — есть результат: слева исходник, справа улучшенный, «Применить»/«Отмена»;
//  error   — AI упал, показываем причину + «Повторить».
type Phase = 'idle' | 'loading' | 'preview' | 'error';

// Кнопка «AI» рядом с submit'ом форм создания/редактирования задачи.
// По клику открывает диалог предпросмотра вместо того, чтобы молча подменять
// текст и показывать исчезающий toast (старое поведение — текст обрывался,
// а «Откатить» пропадал за 4с). Теперь:
//  1) Открываем диалог сразу в loading-состоянии (есть «Отмена» — прерывает ожидание).
//  2) По готовности показываем исходный и улучшенный текст целиком (со скроллом).
//  3) Текст вставляется в поле ТОЛЬКО по «Применить». «Отмена» / Esc / X ничего не меняют.
export function AiImproveButton({
  text,
  projectId,
  onImproved,
  disabled,
  compact,
}: Props): React.ReactElement {
  const { improveTaskDescription } = useContainer();
  const [phase, setPhase] = useState<Phase>('idle');
  const [improved, setImproved] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  // Исходный текст фиксируем на момент клика — диалог показывает именно его слева,
  // даже если поле под диалогом как-то изменится.
  const [original, setOriginal] = useState('');
  // Монотонный счётчик запросов. На «Отмена»/закрытие инкрементируем — и поздно
  // пришедший результат (его reqId != текущего) молча отбрасывается. Сам HTTP-запрос
  // на сервере при этом продолжает выполняться, но UI его больше не ждёт и поле не трогает.
  const reqIdRef = useRef(0);

  const trimmed = text.trim();
  const isBusy = phase === 'loading';
  const isDisabled = disabled || isBusy || trimmed.length === 0;

  const start = async (): Promise<void> => {
    if (disabled || trimmed.length === 0) return;
    const reqId = ++reqIdRef.current;
    setOriginal(text);
    setImproved('');
    setErrorMsg('');
    setPhase('loading');
    try {
      const result = await improveTaskDescription.execute({ text: trimmed, projectId });
      if (reqId !== reqIdRef.current) return; // отменён или перезапущен — игнорируем
      setImproved(result);
      setPhase('preview');
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      const code = err instanceof ImproveTaskDescriptionError ? err.code : 'unknown';
      const detail =
        err instanceof Error && err.message && err.message !== code ? err.message : '';
      setErrorMsg(detail || messageFor(code));
      setPhase('error');
    }
  };

  // Закрыть/отменить: бампим reqId (поздний результат отбросится), сбрасываем фазу.
  // Поле НЕ трогаем — исходный текст пользователя остаётся как был.
  const dismiss = (): void => {
    reqIdRef.current += 1;
    setPhase('idle');
  };

  const apply = (): void => {
    onImproved(improved);
    setPhase('idle');
  };

  const title =
    phase === 'loading'
      ? 'AI улучшает описание…'
      : phase === 'error'
        ? 'AI не смог улучшить'
        : 'Предпросмотр AI-улучшения';

  const subtitle =
    phase === 'loading'
      ? 'Это занимает 5–45 секунд. Можно отменить — текст не изменится.'
      : phase === 'error'
        ? 'Текст остался без изменений.'
        : 'Сравни и применяй, только если стало лучше. В поле текст попадёт лишь по кнопке «Применить».';

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void start()}
        disabled={isDisabled}
        title="Улучшить текст с помощью AI"
        className={cn('gap-1.5', compact ? 'h-10 px-2.5 text-xs' : 'h-8')}
      >
        {isBusy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        AI
      </Button>

      <Dialog
        open={phase !== 'idle'}
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <Sparkles className="size-4 shrink-0 text-primary" />
              {title}
            </DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </DialogHeader>

          {phase === 'error' ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMsg}
            </p>
          ) : (
            <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-2">
              <div className="flex min-h-0 flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Исходный текст</span>
                <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground max-sm:max-h-32">
                  {original}
                </div>
              </div>
              <div className="flex min-h-0 flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Улучшенный</span>
                <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-sm max-sm:max-h-56 sm:min-h-[12rem]">
                  {phase === 'loading' ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Генерация…
                    </span>
                  ) : (
                    improved
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {phase === 'loading' && (
              <Button type="button" variant="ghost" onClick={dismiss}>
                Отмена
              </Button>
            )}
            {phase === 'preview' && (
              <>
                <Button type="button" variant="ghost" onClick={dismiss} className="gap-1.5">
                  <X className="size-4" />
                  Отмена
                </Button>
                <Button type="button" onClick={apply} className="gap-1.5">
                  <Check className="size-4" />
                  Применить
                </Button>
              </>
            )}
            {phase === 'error' && (
              <>
                <Button type="button" variant="ghost" onClick={dismiss}>
                  Закрыть
                </Button>
                <Button type="button" onClick={() => void start()}>
                  Повторить
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function messageFor(code: ImproveTaskDescriptionErrorCode): string {
  switch (code) {
    case 'timeout':
      return 'AI временно недоступен — попробуй ещё раз';
    case 'ai_not_configured':
      return 'AI не настроен. Обратись к админу.';
    case 'no_dispatcher_for_project':
      return 'У проекта не назначен диспетчер для AI';
    case 'rate_limited':
      return 'Слишком много AI-запросов. Подожди минуту.';
    case 'job_failed':
      return 'AI не смог обработать запрос';
    case 'job_cancelled':
      return 'AI-запрос отменён';
    default:
      return 'Не удалось улучшить текст';
  }
}
