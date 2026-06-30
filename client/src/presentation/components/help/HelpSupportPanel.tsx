import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Loader2, Send } from 'lucide-react';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { SubmitSupportError } from '@/application/help/SubmitSupport';
import { SUPPORT_MESSAGE_MAX_LENGTH } from '@/domain/help/Support';
import { cn } from '@/lib/utils';

type Status = 'idle' | 'submitting' | 'sent' | 'error';

function errorText(e: unknown): string {
  if (e instanceof SubmitSupportError) {
    switch (e.code) {
      case 'empty':
        return 'Введите сообщение.';
      case 'too_long':
        return `Слишком длинно — не больше ${SUPPORT_MESSAGE_MAX_LENGTH} символов.`;
      case 'rate_limited':
        return 'Слишком много обращений. Попробуйте чуть позже.';
      default:
        return 'Не удалось отправить. Попробуйте ещё раз.';
    }
  }
  return 'Не удалось отправить. Попробуйте ещё раз.';
}

export function HelpSupportPanel({
  initialMessage = '',
}: {
  initialMessage?: string;
}): React.ReactElement {
  const { submitSupport } = useContainer();
  const { animations } = useMotion();
  const [message, setMessage] = useState(initialMessage);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Префилл из AI-вкладки («Написать в поддержку») — подставляем и фокусируем.
  useEffect(() => {
    if (initialMessage) {
      setMessage(initialMessage);
      setStatus('idle');
      // Курсор в конец, фокус — чтобы можно было сразу дополнить и отправить.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }
  }, [initialMessage]);

  const trimmed = message.trim();
  const count = message.length;
  const overLimit = count > SUPPORT_MESSAGE_MAX_LENGTH;
  const canSend = trimmed.length > 0 && !overLimit && status !== 'submitting';

  const handleSend = async (): Promise<void> => {
    if (!canSend) return;
    setStatus('submitting');
    setError(null);
    try {
      await submitSupport.execute(message, 'app');
      setStatus('sent');
      setMessage('');
    } catch (e) {
      setError(errorText(e));
      setStatus('error');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Ctrl/Cmd+Enter — отправка (как в композере задач).
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSend();
    }
  };

  if (status === 'sent') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <motion.span
          initial={animations ? { scale: 0.6, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={animations ? { type: 'spring', stiffness: 420, damping: 22 } : { duration: 0 }}
          className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary"
        >
          <Check className="size-6" />
        </motion.span>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Обращение отправлено</p>
          <p className="text-xs text-muted-foreground">
            Спасибо! Команда ProjectsFlow ответит вам в Telegram.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setStatus('idle')}>
          Написать ещё
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Опишите проблему или вопрос — команда ProjectsFlow ответит вам в Telegram.
      </p>

      <div
        className={cn(
          'rounded-xl border bg-card p-2 transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring/30',
          overLimit && 'border-destructive/60 focus-within:border-destructive focus-within:ring-destructive/30',
        )}
      >
        <AutoGrowTextarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (status === 'error') setStatus('idle');
          }}
          onKeyDown={onKeyDown}
          minRows={3}
          maxRows={10}
          placeholder="Опишите проблему или вопрос…"
          aria-label="Сообщение в поддержку"
          className="w-full bg-transparent px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="mt-1 flex items-center justify-between px-1">
          <span
            className={cn(
              'text-[11px] tabular-nums',
              overLimit ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {count}/{SUPPORT_MESSAGE_MAX_LENGTH}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="gap-1.5"
          >
            {status === 'submitting' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Отправить
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
