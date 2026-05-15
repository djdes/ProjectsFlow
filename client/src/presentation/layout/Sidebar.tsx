import { Link } from 'react-router-dom';
import { NewProjectButton } from '@/presentation/components/forms/NewProjectButton';
import { SidebarProjectList } from './SidebarProjectList';
import { SidebarUserMenu } from './SidebarUserMenu';

export function Sidebar(): React.ReactElement {
  return (
    <aside className="grid h-full grid-rows-[auto_auto_auto_1fr_auto] gap-3 border-r bg-card/40 p-3">
      <Link
        to="/"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-base font-semibold tracking-tight transition-colors hover:bg-muted"
      >
        <span
          className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
          aria-hidden="true"
        >
          PF
        </span>
        ProjectsFlow
      </Link>

      <NewProjectButton className="w-full justify-start gap-2" />

      <div className="px-2 pt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        Проекты
      </div>

      <nav className="-mx-1 overflow-y-auto px-1">
        <SidebarProjectList />
      </nav>

      <div className="border-t pt-2">
        <SidebarUserMenu />
      </div>
    </aside>
  );
}
