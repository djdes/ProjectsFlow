import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Link2, Loader2, Share2, UserPlus, Users } from 'lucide-react';
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
import { useProjectWorkspace } from '@/presentation/hooks/useProjectWorkspace';
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
  lead: 'Руководитель',
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

// Вкладка «Участники»: здесь ПРИГЛАШАЮТ людей, а не делятся ссылкой. Доступ к проекту даёт
// только членство в его пространстве, поэтому и форма зовёт в пространство — и прямо об этом
// говорит. Показать проект без входа — отдельная вкладка «Публичная доска» (onOpenPublic).
function ShareTab({
  project,
  members,
  canInvite,
  onOpenPublic,
}: Omit<Props, 'isOwner'> & { onOpenPublic: () => void }): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const workspace = useProjectWorkspace(project);
  const { user } = useCurrentUser();
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<WorkspaceInviteRole>('editor');
  const [submitting, setSubmitting] = useState(false);
  // В личное пространство приглашать нельзя (сервер отвечает CannotInviteToDefaultWorkspace).
  const isPersonal = workspace?.kind === 'default';
  const workspaceLabel = workspace ? `«${workspace.name}»` : '';

  const emails = draft
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && EMAIL_RE.test(s));

  const invite = async (): Promise<void> => {
    if (emails.length === 0 || !workspace || isPersonal) return;
    setSubmitting(true);
    try {
      const settled = await Promise.allSettled(
        emails.map((email) => workspaceRepository.createInvite(workspace.id, { role, email })),
      );
      const ok = settled.filter((s) => s.status === 'fulfilled').length;
      if (ok === settled.length) {
        toast.success(
          ok === 1
            ? `Приглашение в пространство ${workspaceLabel} отправлено`
            : `Отправлено приглашений в пространство: ${ok}`,
        );
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
      .then(() => toast.success('Ссылка скопирована — откроется у участников пространства'))
      .catch((error) => toast.error(actionErrorMessage(error, 'Не удалось скопировать ссылку')));
  };

  return (
    <div className="px-4 py-3">
      {/* 1. Пригласить человека = добавить его в пространство проекта. */}
      <p className="text-sm font-medium text-foreground">Пригласить в пространство {workspaceLabel}</p>
      {isPersonal ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Проект лежит в вашем личном пространстве — в него пригласить нельзя. Чтобы работать вместе,
          перенесите проект в командное пространство: «Перенести в…» в{' '}
          {workspace && (
            <Link to={`/workspaces/${workspace.id}/settings`} className="font-medium text-primary hover:underline">
              настройках пространства
            </Link>
          )}
          .
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Приглашённый станет участником пространства и увидит все его проекты, включая этот.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
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
              aria-label={`Email для приглашения в пространство ${workspaceLabel}`}
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
                        Может создавать и изменять задачи во всех проектах пространства.
                      </span>
                    </span>
                    {role === 'editor' && <Check className="mt-0.5 size-4 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="items-start gap-2 py-2" onClick={() => setRole('viewer')}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">Наблюдатель</span>
                      <span className="block text-xs text-muted-foreground">
                        Может только просматривать проекты пространства и обсуждения.
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
                disabled={!canInvite || submitting || emails.length === 0 || !workspace}
                onClick={() => void invite()}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                Пригласить
              </Button>
            </div>
          </div>
        </>
      )}

      {/* 2. У кого уже есть доступ: участники пространства, роль — статичная метка. */}
      <p className="mb-1.5 mt-4 text-xs font-medium text-muted-foreground">Доступ к проекту</p>
      <ul className="space-y-2">
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
              <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</span>
            </li>
          );
        })}
        {!isPersonal && (
          <li className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <Users className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">Все участники пространства {workspaceLabel}</p>
              <p className="text-xs text-muted-foreground">
                {workspace?.memberCount ?? members.length} участн. · роли и состав — в настройках пространства
              </p>
            </div>
            {workspace && (
              <Button asChild variant="ghost" size="sm" className="h-9 shrink-0 px-2">
                <Link to={`/workspaces/${workspace.id}/settings`}>Настройки</Link>
              </Button>
            )}
          </li>
        )}
      </ul>

      {/* 3. Ссылка — это не приглашение: открывается только у участников. Показать без входа —
          публичная доска. */}
      <div className="mt-4 border-t pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Ссылка на проект</p>
            <p className="text-xs text-muted-foreground">Откроется только у участников пространства.</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1.5" onClick={copyLink}>
            <Link2 className="size-3.5" />
            Копировать
          </Button>
        </div>
        <button
          type="button"
          onClick={onOpenPublic}
          className="mt-2 flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          <span>
            Показать проект без входа и приглашения —{' '}
            <span className="font-medium text-primary">Публичная доска</span>
          </span>
          <ChevronRight className="size-3.5 shrink-0" />
        </button>
      </div>
    </div>
  );
}

// Окно «Поделиться» (Notion-style): вкладки Share | Publish. Якорь — кнопка «Поделиться»
// в шапке проекта. См. spec 2026-07-05-project-public-link-and-share-design.md.
type ShareTabId = 'share' | 'board' | 'site';
const TAB_LABEL: Record<ShareTabId, string> = {
  share: 'Участники',
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
        {/* Табы: Участники (пригласить в пространство) · Публичная доска (показать без входа) ·
            Сайт проекта (результат). */}
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
          <ShareTab project={project} members={members} canInvite={canInvite} onOpenPublic={() => setTab('board')} />
        ) : tab === 'board' ? (
          <ProjectPublishTab project={project} isOwner={isOwner} />
        ) : (
          <ProjectSiteTab projectId={project.id} />
        )}
      </PopoverContent>
    </Popover>
  );
}
