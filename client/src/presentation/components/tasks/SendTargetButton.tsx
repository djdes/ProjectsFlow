import { ChevronDown, Loader2, Send } from 'lucide-react';
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

// Telegram-style кнопка отправки: круглая иконка-самолётик (отправить в текущую цель) + тихая
// каретка выбора цели (Воркеру / Черновик). Используется и в композере задачи, и в композере
// комментария дравера.
//
// ВАЖНО: тут НЕ используем shadcn <Button> — у него дефолтный size-вариант тянет
// `sm:px-4 sm:h-10`, а `size-9`/`p-0` в className беспрефиксные и не перебивают `sm:`-варианты →
// на десктопе паддинг «раздувал» кнопку в эллипс. Обычный <button> с фиксированным `size-*`
// (как в inline-композере) даёт ровный круг. См. память icon-button-size-vs-input-height.
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
  // Каретка — той же высоты, что и кнопка, но уже по ширине (тихий вторичный контрол).
  const caretDim = size === 'sm' ? 'h-8 w-6' : 'h-9 w-7';

  const sendButton = (
    <button
      type="button"
      onClick={onSend}
      disabled={disabled || submitting}
      title="Отправить (Ctrl+Enter)"
      aria-label={current ? `Отправить — ${current.label}` : 'Отправить'}
      className={cn(
        dim,
        'grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm ring-offset-background transition-all duration-150 hover:bg-primary/90 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.97] disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground/50 disabled:shadow-none disabled:active:scale-100',
      )}
    >
      {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
    </button>
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
          <button
            type="button"
            disabled={submitting}
            aria-label="Куда отправить"
            title="Куда отправить"
            className={cn(
              caretDim,
              'grid shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <ChevronDown className="size-4" />
          </button>
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
