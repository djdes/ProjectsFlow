import { cn } from '@/lib/utils';

// Шапка страницы дизайна C4: строка 44px с линией снизу — крошки слева, действия справа
// (счётчик «сделано сегодня», переключатели вида). Одна на все разделы, чтобы переходы
// между страницами не «прыгали» по высоте и линия шапки шла на одном уровне.
// На мобиле у приложения своя шапка (AppShell), поэтому страницы обычно прячут эту строку
// классом `hidden sm:flex` через className.
export function PageTopBar({
  children,
  end,
  sticky = false,
  className,
}: {
  children: React.ReactNode;
  end?: React.ReactNode;
  // Липкая строка (страницы с длинной прокруткой, где крошки нужны под рукой).
  sticky?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex h-11 shrink-0 items-center justify-between gap-2 border-be px-2.5',
        sticky && 'pf-sticky-surface sticky inset-bs-0 z-20 bg-background',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {end != null && <div className="flex shrink-0 items-center gap-1.5">{end}</div>}
    </div>
  );
}

// Заголовок страницы: 22px, жирный, с необязательной иконкой слева. Длинное имя режется «…».
export function PageTitle({
  icon,
  children,
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <h1
      className={cn(
        'flex min-w-0 items-center gap-2.5 text-h1 font-bold leading-tight tracking-[-0.01em]',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </h1>
  );
}
