import { cn } from '@/lib/utils';

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
};

// Лёгкий переключатель без radix-зависимости (стек уже большой). Доступен: role=switch + aria-checked.
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  'aria-label': ariaLabel,
}: SwitchProps): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
        // Off-состояние: заметный светло-серый трек. В тёмной теме bg-input сливался с фоном,
        // а тёмный ползунок читался как «чёрный эллипс» — поэтому ползунок теперь всегда белый.
        checked ? 'bg-primary' : 'bg-black/15 dark:bg-white/20',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
