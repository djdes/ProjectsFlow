import { useEffect, useId, useState } from 'react';
import { ChevronRight, Link2, Share2, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Project } from '@/domain/project/Project';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useProjectWorkspace } from '@/presentation/hooks/useProjectWorkspace';
import { ProjectPublishTab } from './ProjectPublishTab';
import { ProjectSiteTab } from './ProjectSiteTab';
import { WorkspaceMembersPanel } from './WorkspaceMembersPanel';
import { trackProjectAction } from '@/lib/productAnalytics';

type Props = { project: Project; members: ProjectMember[]; canInvite: boolean; isOwner: boolean; compact?: boolean };

function ShareTab({ project, onOpenPublic }: { project: Project; onOpenPublic: () => void }): React.ReactElement {
  const workspace = useProjectWorkspace(project);
  const copyLink = (): void => {
    void navigator.clipboard.writeText(`${window.location.origin}/projects/${project.id}`)
      .then(() => toast.success('Ссылка скопирована'))
      .catch(() => toast.error('Не удалось скопировать ссылку'));
  };
  return <div className="space-y-4 px-4 py-3">
    {project.isInbox ? <p className="text-sm text-muted-foreground">Личные входящие доступны только вам. Отдельную задачу можно назначить коллеге.</p> : workspace ? <>
      <WorkspaceMembersPanel key={workspace.id} workspace={workspace} projectId={project.id} />
      <Button asChild variant="outline" size="sm" className="w-full"><Link to={`/workspaces/${workspace.id}/settings`}><Settings2 className="size-4" />Настройки пространства</Link></Button>
    </> : <p className="text-sm text-muted-foreground">Загружаем пространство…</p>}
    <div className="border-bs pbs-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-sm">Ссылка на проект</p><p className="text-xs text-muted-foreground">Только для участников с доступом к этому проекту.</p></div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={copyLink}><Link2 className="size-3.5" />Копировать</Button>
      </div>
      <button type="button" onClick={onOpenPublic} className="mbs-2 flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-start text-xs text-muted-foreground hover:bg-hover">
        <span>Показать без входа — <span className="font-medium text-primary-ink">Публичная доска</span></span><ChevronRight className="size-3.5 shrink-0" />
      </button>
    </div>
  </div>;
}

// Окно «Поделиться» (Notion-style): вкладки Share | Publish. Якорь — кнопка «Поделиться»
// в шапке проекта. См. spec 2026-07-05-project-public-link-and-share-design.md.
type ShareTabId = 'share' | 'board' | 'site';
const TAB_LABEL: Record<ShareTabId, string> = {
  share: 'Участники',
  board: 'Публичная доска',
  site: 'Сайт проекта',
};

export function ProjectSharePopover({ project, isOwner, compact = false }: Props): React.ReactElement {
  const tabId = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ShareTabId>('share');
  useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId !== project.id) return;
      setTab('share');
      setOpen(true);
    };
    window.addEventListener('pf:open-project-share', onOpen);
    return () => window.removeEventListener('pf:open-project-share', onOpen);
  }, [project.id]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          trackProjectAction({
            projectId: project.id,
            action: 'share_project',
            result: 'success',
          });
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'gap-1.5 text-muted-foreground hover:text-foreground',
            // 28px / 14px — высота и кегль кнопок верхней панели в Notion (MEASURED.md §3).
            // Дубли с sm: обязательны: у size="sm" в самом варианте лежат sm:h-9/sm:px-3/
            // sm:text-xs, и без явного sm-аналога они перебивают базовые классы на десктопе
            // (медиазапрос идёт в CSS позже). Кегль задаём на самой кнопке, а не на <span> —
            // иначе на десктопе у любого будущего текста прямо в кнопке остаётся sm:text-xs.
            // Базовая (мобильная) высота — h-10, а не h-7: non-compact ветка достижима с
            // телефона (эти же действия рендерятся в портале окна активности), а глобальный
            // min-height:44px из globals.css до Button не достаёт — в его базовых классах
            // есть подстрока `size-`. Compact-ветка (мобильная шапка) остаётся крупной.
            compact ? 'size-10 px-0 sm:size-9' : 'h-10 px-2 text-sm sm:h-7 sm:px-2 sm:text-sm',
          )}
          aria-label="Поделиться"
        >
          <Share2 className="size-4" />
          {!compact && <span>Поделиться</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Поделиться проектом"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="w-[460px] max-w-[calc(100vw-1rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain p-0"
      >
        {/* Табы: Участники (пригласить в пространство) · Публичная доска (показать без входа) ·
            Сайт проекта (результат). */}
        <div className="sticky inset-bs-0 z-10 flex items-center gap-3 overflow-x-auto overflow-y-hidden border-be bg-popover px-4 pbs-2.5" role="tablist" aria-label="Поделиться проектом">
          {(['share', 'board', 'site'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              onKeyDown={(event) => {
                const tabs = ['share', 'board', 'site'] as const;
                const index = tabs.indexOf(t);
                const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
                if (next === null) return;
                event.preventDefault();
                setTab(tabs[next]);
                document.getElementById(`${tabId}-${tabs[next]}`)?.focus();
              }}
              id={`${tabId}-${t}`}
              aria-controls={`${tabId}-panel`}
              role="tab"
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              className={cn(
                'relative whitespace-nowrap pbe-2 text-sm transition-colors',
                tab === t ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {TAB_LABEL[t]}
              {tab === t && <span className="absolute inset-x-0 -inset-be-px h-0.5 rounded-full bg-foreground" />}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`}>
        {tab === 'share' ? (
          <ShareTab project={project} onOpenPublic={() => setTab('board')} />
        ) : tab === 'board' ? (
          <ProjectPublishTab project={project} isOwner={isOwner} />
        ) : (
          <ProjectSiteTab projectId={project.id} />
        )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
