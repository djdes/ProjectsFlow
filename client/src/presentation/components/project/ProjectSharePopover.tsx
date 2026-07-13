import { useState } from 'react';
import { ChevronDown, Link2, Loader2, Plus, Share2, UserPlus } from 'lucide-react';
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
    const settled = await Promise.allSettled(
      emails.map((email) => workspaceRepository.createInvite(workspace.id, { role, email })),
    );
    setSubmitting(false);
    const ok = settled.filter((s) => s.status === 'fulfilled').length;
    if (ok === settled.length) {
      toast.success(ok === 1 ? 'Приглашение отправлено' : `Отправлено приглашений: ${ok}`);
      setDraft('');
    } else {
      toast.error(`${ok} ок, ${settled.length - ok} с ошибкой`);
    }
  };

  const copyLink = (): void => {
    void navigator.clipboard.writeText(`${window.location.origin}/projects/${project.id}`);
    toast.success('Ссылка скопирована');
  };

  return (
    <div className="px-4 py-3">
      {/* Email + Invite. */}
      <div className="flex items-center gap-2">
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
        <div className="flex shrink-0 items-center gap-1">
          {/* Роль будущего инвайта. */}
          <button
            type="button"
            onClick={() => setRole((r) => (r === 'editor' ? 'viewer' : 'editor'))}
            disabled={!canInvite}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {role === 'editor' ? 'Редактор' : 'Наблюдатель'}
          </button>
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

      {/* General access — заглушка (серым). */}
      <div className="mt-3 border-t pt-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Общий доступ</p>
        <div className="flex cursor-not-allowed items-center gap-2.5 text-muted-foreground/60" aria-disabled>
          <span className="grid size-8 place-items-center rounded-full bg-muted/60 text-base">🌐</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">Все участники пространства</p>
          </div>
          <span className="flex items-center gap-0.5 text-xs">
            Нет доступа <ChevronDown className="size-3.5" />
          </span>
        </div>
      </div>

      {/* Page-level access — заглушка (серым). */}
      <button
        type="button"
        disabled
        className="mt-3 flex w-full cursor-not-allowed items-center gap-2.5 rounded-md border border-dashed border-black/[0.1] px-2.5 py-2 text-left text-muted-foreground/60 dark:border-white/10"
        aria-disabled
      >
        <Plus className="size-4" />
        <span className="text-sm">Добавить правило доступа</span>
      </button>

      <div className="mt-3 flex items-center justify-between border-t pt-2.5">
        <span className="cursor-not-allowed text-xs text-muted-foreground/60">О совместном доступе</span>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={copyLink}>
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

export function ProjectSharePopover({ project, members, canInvite, isOwner }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ShareTabId>('share');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          aria-label="Поделиться"
        >
          <Share2 className="size-4" />
          <span className="text-sm">Поделиться</span>
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
        <div className="flex items-center gap-4 border-b px-4 pt-2.5">
          {(['share', 'board', 'site'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
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
