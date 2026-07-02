import { ChevronDown, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type SendTargetOption<V extends string> = {
  readonly value: V;
  readonly label: string;
  readonly icon?: React.ComponentType<{ className?: string }>;
};

type Props<V extends string> = {
  // Варианты цели отправки. Меньше двух → каретка не рисуется, остаётся только кнопка-иконка.
  readonly options?: readonly SendTargetOption<V>[];
  readonly value?: V;
  readonly onChange?: (value: V) => void;
  readonly onSend: () => void;
  readonly submitting?: boolean;
  // true — отправлять нечего (пустой ввод). Гасит отправку; выбор цели остаётся доступен.
  readonly disabled?: boolean;
  // Высота контрола: 'sm' (32px, дравер) / 'md' (36px, floating-композер).
  readonly size?: 'sm' | 'md';
  // Мелкая метка текущей цели слева от кнопки. По умолчанию показываем (если есть выбор).
  readonly showLabel?: boolean;
};

// Telegram-style кнопка отправки: иконка-самолётик (отправить в текущую цель) + слитная
// каретка, открывающая выбор цели (Воркеру / Черновик). Используется и в композере задачи,
// и в композере комментария дравера.
export function SendTargetButton<V extends string>({
  options = [],
  value,
  onChange,
  onSend,
  submitting = false,
  disabled = false,
  size = 'md',
  showLabel = true,
}: Props<V>): React.ReactElement {
  const hasChoice = options.length >= 2 && value !== undefined && onChange !== undefined;
  const current = hasChoice ? (options.find((o) => o.value === value) ?? options[0]) : null;
  const dim = size === 'sm' ? 'size-8' : 'size-9';
  const h = size === 'sm' ? 'h-8' : 'h-9';

  // Чистая круглая solid-кнопка отправки (в тон акцентной «＋» в навбаре), а не «сплит».
  const sendButton = (
    <Button
      type="button"
      onClick={onSend}
      disabled={disabled || submitting}
      title="Отправить (Ctrl+Enter)"
      aria-label={current ? `Отправить — ${current.label}` : 'Отправить'}
      className={cn(dim, 'shrink-0 rounded-full p-0 shadow-sm')}
    >
      {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
    </Button>
  );

  if (!hasChoice) return sendButton;

  // Выбор цели (Воркеру/Черновик) — отдельная тихая ghost-каретка слева, не «приваренная» к кнопке.
  return (
    <div className="inline-flex items-center gap-1">
      {showLabel && current && (
        <span className="text-[11px] text-muted-foreground">{current.label}</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            aria-label="Куда отправить"
            title="Куда отправить"
            className={cn(h, 'w-7 shrink-0 rounded-md p-0 text-muted-foreground')}
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="min-w-40">
          <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange?.(v as V)}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                {o.icon ? <o.icon className="size-4" /> : null}
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {sendButton}
    </div>
  );
}
