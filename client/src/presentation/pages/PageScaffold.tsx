import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

// Общие куски страниц дизайна C4 (docs/superpowers/specs/2026-10-10-redesign-c4-design.md):
// ритм контента, сообщение по центру экрана (пусто / ошибка / не найдено), плашка ошибки и
// пустая панель. Собраны здесь, чтобы страницы не расходились в отступах: раньше каждая
// считала их сама, и шапки «прыгали» при переходах. Модуль лёгкий намеренно — его берут
// экраны входа и страница 404 из основного бандла; каркас раздела с крошками — SectionPage.

// Ритм контента под шапкой — один на все страницы: поля 16/24px, отступ сверху 16/20px,
// 20px между блоками и воздух под последним блоком.
export const PAGE_BODY_CLASS = 'flex w-full flex-col gap-5 px-4 pbe-12 pbs-4 sm:px-6 sm:pbs-5';

// Сообщение по центру: страница не найдена, нет доступа, не удалось загрузить, пустой раздел.
// Само занимает высоту родителя (min-h-full); под строкой шапки во flex-колонке вместо этого
// передают className="min-h-0 flex-1".
export function PageMessage({
  icon,
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  // Кнопки и ссылки под текстом.
  children?: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('grid min-h-full place-items-center px-4 py-12 sm:px-6', className)}>
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        {icon && <div className="mbe-1">{icon}</div>}
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
        )}
        <h1 className="text-h1 font-bold leading-tight tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {children && <div className="mbs-3 flex flex-wrap items-center justify-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

// Плашка ошибки: красный текст на мягкой красной подложке. Иконка — чтобы ошибку было видно
// не только по цвету.
export function ErrorNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-ui text-destructive',
        className,
      )}
    >
      <CircleAlert className="mbs-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

// Пустое состояние внутри страницы: нейтральная серая панель с подписью по центру.
export function EmptyPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('rounded-xl bg-panel px-4 py-10 text-center text-sm text-muted-foreground', className)}>
      {children}
    </div>
  );
}
