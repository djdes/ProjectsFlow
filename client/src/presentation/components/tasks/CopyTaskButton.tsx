import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyMarkdownForTelegram } from '@/presentation/hooks/useTextFieldFormatting';
import { toast } from '@/components/ui/sonner';

type Props = {
  // Текст описания задачи — копируется с Telegram-разметкой.
  description: string;
  disabled?: boolean;
  className?: string;
};

// «Копировать» — кнопка в группе действий шапки задачи. Копирует описание с
// форматированием для вставки в Telegram (переиспользует copyMarkdownForTelegram).
// Унифицирована по виду с соседними иконками-действиями (Переработка / План).
export function CopyTaskButton({ description, disabled = false, className }: Props): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await copyMarkdownForTelegram(description);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast.error(`Не удалось скопировать: ${(e as Error).message}`);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled || description.trim().length === 0}
      onClick={() => void handleCopy()}
      title="Копировать описание для Telegram"
      aria-label="Копировать описание"
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40',
        className,
      )}
    >
      {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
    </button>
  );
}
