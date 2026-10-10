import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PageTitle, PageTopBar } from '@/presentation/layout/PageChrome';
import { WorkspaceCrumbs } from '@/presentation/layout/InboxBreadcrumbs';
import { PAGE_BODY_CLASS } from '@/presentation/pages/PageScaffold';

type SectionIcon = ComponentType<{ className?: string }>;

// Страница-раздел пространства (профиль, настройки, администрирование, мониторинг, алерты) в
// дизайне C4. Сверху строка 44px с крошками «Пространство › Раздел»; на мобиле её нет — там
// своя шапка приложения, а вернуться помогает кнопка «Назад» (back). Ниже — заголовок 22px
// с иконкой раздела и, справа, действия страницы. narrow — колонка форм настроек (max-w-2xl).
// Отдельный модуль, а не часть PageScaffold: крошки тянут меню и хуки пространства, а лёгкие
// куски (сообщения, плашки) нужны и экранам входа, и странице 404 из основного бандла.
export function SectionPage({
  icon: Icon,
  label,
  title,
  titleIcon,
  titleAside,
  actions,
  back,
  narrow = false,
  children,
}: {
  icon: SectionIcon;
  // Подпись раздела в крошках; она же заголовок, если title не задан.
  label: string;
  title?: ReactNode;
  // Своя иконка заголовка (например, иконка пространства) вместо иконки раздела.
  titleIcon?: ReactNode;
  // Стоит вплотную к заголовку — счётчик, метка.
  titleAside?: ReactNode;
  // Прижаты к правому краю строки заголовка.
  actions?: ReactNode;
  back?: { to: string; label: string };
  narrow?: boolean;
  children?: ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-full flex-col">
      <PageTopBar className="hidden sm:flex">
        <WorkspaceCrumbs icon={<Icon className="size-3.5 shrink-0" />} label={label} />
      </PageTopBar>
      <div className={cn(PAGE_BODY_CLASS, narrow && 'mx-auto max-w-2xl')}>
        {back && (
          <Button asChild variant="ghost" size="sm" className="-mbe-2 -ms-3 gap-1 self-start sm:hidden">
            <Link to={back.to}>
              <ArrowLeft />
              {back.label}
            </Link>
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PageTitle icon={titleIcon ?? <Icon className="size-5 shrink-0 text-muted-foreground" />}>
            {title ?? label}
          </PageTitle>
          {titleAside}
          {actions != null && <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
