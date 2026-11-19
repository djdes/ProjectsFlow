import { Check, ChevronDown, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  ISO_WEEKDAYS,
  TASK_RECURRENCE_KINDS,
  TASK_RECURRENCE_KIND_LABEL,
  WEEKDAY_FULL,
  dayOfMonthOf,
  taskRecurrenceForKind,
  taskRecurrenceLabel,
  toggleRecurrenceWeekday,
  type TaskRecurrence,
  type TaskRecurrenceKind,
} from '@/domain/task/TaskRecurrence';
import { PROPERTY_CARET_CLASS } from './PropertyRow';

type Props = {
  value: TaskRecurrence | null;
  onChange: (next: TaskRecurrence | null) => void;
  // Дата-якорь 'YYYY-MM-DD' (срок задачи; без срока — сегодня): от неё берутся день недели
  // для «Каждую неделю» и число для «Каждый месяц».
  anchorDate: string;
  disabled?: boolean;
  className?: string;
  // Значок для панели композера (как у Срока): подпись появляется, только когда повтор задан.
  iconOnly?: boolean;
};

// Выбор повтора задачи. Обычный dropdown на десктопе; на телефоне DropdownMenu сам
// открывается нижним листом — как остальные пикеры ряда свойств (Срок, Приоритет, Тип).
// «Каждую неделю» оставляет меню открытым и показывает дни недели: выбрать вид и дни —
// одно действие, без второго захода в меню.
export function TaskRecurrenceSelect({
  value,
  onChange,
  anchorDate,
  disabled,
  className,
  iconOnly = false,
}: Props): React.ReactElement {
  const inPropertyRow = (className ?? '').includes('justify-start');
  const label = value ? taskRecurrenceLabel(value) : inPropertyRow ? 'Не повторять' : 'Повтор';

  const kindLabel = (kind: TaskRecurrenceKind): string =>
    kind === 'monthly'
      ? `${TASK_RECURRENCE_KIND_LABEL.monthly}, ${value?.kind === 'monthly' ? value.day : dayOfMonthOf(anchorDate)}-го`
      : TASK_RECURRENCE_KIND_LABEL[kind];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={iconOnly && !value ? 'icon' : 'sm'}
          disabled={disabled}
          className={cn(
            iconOnly ? 'shrink-0 gap-1.5 text-xs' : inPropertyRow ? '' : 'h-7 gap-1.5 px-2 text-xs',
            className,
            value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
          title={value ? `Повтор: ${taskRecurrenceLabel(value)}` : 'Повтор задачи'}
          aria-label={value ? `Повтор: ${taskRecurrenceLabel(value)}` : 'Повтор задачи'}
        >
          {!inPropertyRow && <Repeat className={iconOnly ? 'size-4' : 'size-3.5'} aria-hidden />}
          {(!iconOnly || value) && <span className="min-w-0 truncate">{label}</span>}
          {!iconOnly && !disabled && <ChevronDown className={inPropertyRow ? PROPERTY_CARET_CLASS : 'size-3'} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem onSelect={() => onChange(null)} className={cn(!value && 'font-medium')}>
          <Check className={cn('text-muted-foreground', value && 'invisible')} aria-hidden />
          Не повторять
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {TASK_RECURRENCE_KINDS.map((kind) => {
          const selected = value?.kind === kind;
          return (
            <DropdownMenuItem
              key={kind}
              className={cn(selected && 'font-medium')}
              onSelect={(event) => {
                // Дни недели выбирают в этом же меню — не закрываем его.
                if (kind === 'weekly') event.preventDefault();
                if (!selected) onChange(taskRecurrenceForKind(kind, anchorDate));
              }}
            >
              <Check className={cn('text-muted-foreground', !selected && 'invisible')} aria-hidden />
              {kindLabel(kind)}
            </DropdownMenuItem>
          );
        })}
        {value?.kind === 'weekly' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Дни недели</DropdownMenuLabel>
            {ISO_WEEKDAYS.map((day) => {
              const checked = value.days.includes(day);
              const last = checked && value.days.length === 1;
              return (
                <DropdownMenuCheckboxItem
                  key={day}
                  checked={checked}
                  // Хотя бы один день должен остаться — иначе это уже не «каждую неделю».
                  disabled={last}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => onChange(toggleRecurrenceWeekday(value, day))}
                >
                  {WEEKDAY_FULL[day]}
                </DropdownMenuCheckboxItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
