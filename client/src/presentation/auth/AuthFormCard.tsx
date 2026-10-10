import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  description?: ReactNode;
  // Значок состояния над заголовком (успех, ошибка, ожидание) — встаёт вместо знака продукта.
  icon?: ReactNode;
  children?: ReactNode;
  // Второстепенное действие под чертой: «Нет аккаунта? Зарегистрироваться» и т.п.
  footer?: ReactNode;
};

// Поля формы входа на десктопе выше обычных (36px против 32px) — вровень с главной кнопкой
// size="lg"; на мобиле Input и так 44px.
export const authFieldClass = 'sm:h-9 sm:px-3 sm:text-sm';

// Знак продукта — монограмма «PF» на акцентной плашке (тот же знак, что на лендинге).
export function ProductMark({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground',
        className,
      )}
    >
      PF
    </span>
  );
}

/**
 * Экран входа, регистрации, сброса пароля, приглашения и подключения агента — дизайн C4
 * в духе входа Notion: спокойный лист bg-background без карточки (одинаково ровно в светлой
 * и тёмной теме), по центру колонка 384px — знак продукта, заголовок 22px, описание, поля.
 * Отступы от краёв не меньше safe-area: страница входа — стартовая в PWA на iPhone.
 */
export function AuthFormCard({ title, description, icon, children, footer }: Props): React.ReactElement {
  return (
    <main className="flex min-h-dvh flex-col bg-background pbe-[max(2rem,env(safe-area-inset-bottom))] pbs-[max(2rem,env(safe-area-inset-top))] pe-[max(1rem,env(safe-area-inset-right))] ps-[max(1rem,env(safe-area-inset-left))]">
      <div className="m-auto flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col gap-2">
          {icon ? (
            <div className="mbe-2">{icon}</div>
          ) : (
            <div className="mbe-3 flex items-center gap-2">
              <ProductMark />
              <span className="text-sm font-semibold">ProjectsFlow</span>
            </div>
          )}
          <h1 className="text-h1 font-bold leading-tight tracking-[-0.01em]">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </header>
        {children}
        {footer && <div className="border-bs pbs-5 text-center text-ui text-muted-foreground">{footer}</div>}
      </div>
    </main>
  );
}
