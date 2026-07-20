import { useEffect, useState } from 'react';
import { Check, ChevronDown, Link2, Loader2, Share2, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { ProjectPublishTab } from './ProjectPublishTab';
import { ProjectSiteTab } from './ProjectSiteTab';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { actionErrorMessage } from '@/lib/actionFeedback';
import { trackProjectAction } from '@/lib/productAnalytics';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: 'Полный доступ',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
};

type Props = {
  project: Project;
  members: ProjectMember[];
  canInvite: boolean; // editor+ — может приглашать
  isOwner: boolean; // owner — может публиковать
  compact?: boolean;
};

function Initial({ name }: { name: string }): React.ReactElement {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function ShareTab({ project, members, canInvite }: Omit<Props, 'isOwner'>): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const { workspace } = useCurrentWorkspace();
  const { user } = useCurrentUser();
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<WorkspaceInviteRole>('editor');
  const [submitting, setSubmitting] = useState(false);

  const emails = draft
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && EMAIL_RE.test(s));

  // Инвайт теперь в ПРОСТРАНСТВО проекта: приглашённый увидит все проекты пространства.
  const invite = async (): Promise<void> => {
    if (emails.length === 0 || !workspace) return;
    setSubmitting(true);
    try {
      const settled = await Promise.allSettled(
        emails.map((email) => workspaceRepository.createInvite(workspace.id, { role, email })),
      );
      const ok = settled.filter((s) => s.status === 'fulfilled').length;
      if (ok === settled.length) {
        toast.success(ok === 1 ? 'Приглашение отправлено' : `Отправлено приглашений: ${ok}`);
        setDraft('');
      } else {
        const firstError = settled.find((item) => item.status === 'rejected');
        toast.error(
          firstError?.status === 'rejected'
            ? actionErrorMessage(firstError.reason, `${ok} из ${settled.length} приглашений отправлено`)
            : `${ok} из ${settled.length} приглашений отправлено`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = (): void => {
    void navigator.clipboard
      .writeText(`${window.location.origin}/projects/${project.id}`)
      .then(() => toast.success('Ссылка скопирована'))
      .catch((error) => toast.error(actionErrorMessage(error, 'Не удалось скопировать ссылку')));
  };

  return (
    <div className="px-4 py-3">
      {/* Email + Invite. */}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void invite();
            }
          }}
          placeholder="Email, через запятую"
          className="h-9"
          disabled={!canInvite}
        />
        <div className="flex shrink-0 items-center justify-end gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!canInvite}
                className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                {role === 'editor' ? 'Редактор' : 'Наблюдатель'}
                <ChevronDown className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem className="items-start gap-2 py-2" onClick={() => setRole('editor')}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Редактор</span>
                  <span className="block text-xs text-muted-foreground">
                    Может создавать и изменять задачи и представления.
                  </span>
                </span>
                {role === 'editor' && <Check className="mt-0.5 size-4 text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuItem className="items-start gap-2 py-2" onClick={() => setRole('viewer')}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Наблюдатель</span>
                  <span className="block text-xs text-muted-foreground">
                    Может только просматривать проект и обсуждение.
                  </span>
                </span>
                {role === 'viewer' && <Check className="mt-0.5 size-4 text-primary" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="sm"
            className="h-9"
            disabled={!canInvite || submitting || emails.length === 0}
            onClick={() => void invite()}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Пригласить
          </Button>
        </div>
      </div>

      {/* Список участников. */}
      <ul className="mt-3 space-y-2">
        {members.map((m) => {
          const isYou = m.userId === user?.id;
          return (
            <li key={m.userId} className="flex items-center gap-2.5">
              <Initial name={m.user.displayName || m.user.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {m.user.displayName}
                  {isYou && <span className="text-muted-foreground"> (Вы)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
              </div>
              {/* Управление ролью живёт в панели участников; здесь — статичная метка. */}
              <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</span>
            </li>
          );
        })}
      </ul>

      {/* Проекты принадлежат пространству: доступ наследуется от его участников. */}
      <div className="mt-3 border-t pt-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Общий доступ</p>
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
            <Users className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              Все участники пространства{workspace ? ` «${workspace.name}»` : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              Доступ наследуется · {workspace?.memberCount ?? members.length} участн.
            </p>
          </div>
          {workspace && (
            <Button asChild variant="ghost" size="sm" className="h-9 px-2">
              <Link to={`/workspaces/${workspace.id}/settings`}>Управлять</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t pt-2.5">
        <span className="text-xs text-muted-foreground">Доступ управляется через пространство</span>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={copyLink}>
          <Link2 className="size-3.5" />
          Копировать ссылку
        </Button>
      </div>
    </div>
  );
}

// Окно «Поделиться» (Notion-style): вкладки Share | Publish. Якорь — кнопка «Поделиться»
// в шапке проекта. См. spec 2026-07-05-project-public-link-and-share-design.md.
type ShareTabId = 'share' | 'board' | 'site';
const TAB_LABEL: Record<ShareTabId, string> = {
  share: 'Доступ',
  board: 'Публичная доска',
  site: 'Сайт проекта',
};

export function ProjectSharePopover({ project, members, canInvite, isOwner, compact = false }: Props): React.ReactElement {
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
        align="end"
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[420px] max-w-[calc(100vw-1rem)] p-0"
      >
        {/* Табы: Доступ · Публичная доска (канбан) · Сайт проекта (результат). */}
        <div className="flex items-center gap-4 border-b px-4 pt-2.5" role="tablist" aria-label="Поделиться проектом">
          {(['share', 'board', 'site'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              role="tab"
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              className={cn(
                'relative whitespace-nowrap pb-2 text-sm transition-colors',
                tab === t ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {TAB_LABEL[t]}
              {tab === t && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground" />}
            </button>
          ))}
        </div>

        {tab === 'share' ? (
          <ShareTab project={project} members={members} canInvite={canInvite} />
        ) : tab === 'board' ? (
          <ProjectPublishTab project={project} isOwner={isOwner} />
        ) : (
          <ProjectSiteTab projectId={project.id} />
        )}
      </PopoverContent>
    </Popover>
  );
}
