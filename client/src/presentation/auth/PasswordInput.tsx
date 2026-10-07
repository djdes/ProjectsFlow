import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<InputProps, 'type'>;

// Поле пароля с кнопкой «показать/скрыть» — вход, регистрация и смена пароля.
// Кнопка size-10 совпадает по высоте с Input (h-10) и не попадает под глобальный
// min-height 44px для кнопок на сенсорных экранах (правило пропускает классы size-*).
export function PasswordInput({ className, ...props }: PasswordInputProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        aria-controls={props.id}
        title={visible ? 'Скрыть пароль' : 'Показать пароль'}
        className="absolute right-0 top-0 grid size-10 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
