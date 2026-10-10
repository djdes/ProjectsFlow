import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { authFieldClass } from './AuthFormCard';

type PasswordInputProps = Omit<InputProps, 'type'>;

// Поле пароля с кнопкой «показать/скрыть» — вход, регистрация и смена пароля.
// Высота как у остальных полей экрана входа (authFieldClass): 44px на мобиле, 36px на
// десктопе; кнопка-глаз — квадрат той же высоты. Класс size-* выводит её из-под глобального
// min-height 44px для кнопок на сенсорных экранах (правило пропускает size-*).
export function PasswordInput({ className, ...props }: PasswordInputProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn(authFieldClass, 'pe-11 sm:pe-9', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        aria-controls={props.id}
        title={visible ? 'Скрыть пароль' : 'Показать пароль'}
        className="absolute end-0 inset-bs-0 grid size-11 place-items-center rounded-e-md text-muted-foreground transition-colors hover:text-foreground sm:size-9"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
