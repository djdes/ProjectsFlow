import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
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
  /** Колбэк: устанавливаем новый текст после успешного улучшения. */
  readonly onImproved: (improved: string) => void;
  /** Внешний disabled — например, форма в процессе сохранения. */
  readonly disabled?: boolean;
  /** Опционально: компактный вариант (для QuickAddTodo). */
  readonly compact?: boolean;
};

// Кнопка «AI» рядом с submit'ом форм создания задачи. По клику:
// 1) Отправляем текст в /api/ai/prompt-jobs.
// 2) Long-poll-ждём результат (до 25 сек).
// 3) Подменяем текст в textarea + toast «откатить» (undo через onImproved(prev)).
export function AiImproveButton({
  text,
  projectId,
  onImproved,
  disabled,
  compact,
}: Props): React.ReactElement {
  const { improveTaskDescription } = useContainer();
  const [working, setWorking] = useState(false);
  const trimmed = text.trim();
  const isDisabled = disabled || working || trimmed.length === 0;

  const handleClick = async (): Promise<void> => {
    if (isDisabled) return;
    setWorking(true);
    const original = text;
    // Loading-toast — даёт визуальную обратную связь, пока AI работает (5-45 сек).
    // Заменим на success/error по завершении через тот же id.
    const toastId = toast.loading('AI улучшает текст…', {
      description: 'Это занимает 5–45 секунд. Подожди немного.',
    });
    try {
      const improved = await improveTaskDescription.execute({
        text: trimmed,
        projectId,
      });
      onImproved(improved);
      toast.success('Текст улучшен AI', {
        id: toastId,
        description: 'Нажми «Откатить», если стало хуже.',
        action: {
          label: 'Откатить',
          onClick: () => onImproved(original),
        },
      });
    } catch (err) {
      const code = err instanceof ImproveTaskDescriptionError ? err.code : 'unknown';
      toast.error(messageFor(code), {
        id: toastId,
        description:
          err instanceof Error && err.message !== code ? err.message : undefined,
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={isDisabled}
      title="Улучшить текст с помощью AI"
      className={cn(
        'gap-1.5',
        compact ? 'h-8 px-2.5 text-xs' : 'h-8',
      )}
    >
      {working ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Sparkles className="size-3.5" />
      )}
      AI
    </Button>
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
