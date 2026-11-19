import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, CreditCard, Eye, FolderGit2, History, KeyRound, Loader2, LogOut, Pencil, Shield, ShieldOff, Trash2,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useMobileSheet } from '@/components/ui/mobile-sheet';
import { Skeleton, LoadingRegion } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toneClass, toneOf } from '@/lib/tone';
import type { AdminUser, AdminUserOverview } from '@/application/admin/AdminRepository';
import { useContainer } from '@/infrastructure/di/container';
import { getInitials } from '@/presentation/layout/projectIcons';
import { formatUsd } from '@/presentation/usage/usageFormat';
import { AdminError, errorText } from '@/presentation/components/admin/AdminState';
import { pluralRu } from '@/presentation/components/admin/mailing/mailingFormat';
import type { AdminUserActions } from './useAdminUserActions';
import { activityText, auditText, planBadge, shortDate } from './userConsoleState';

const ROLE_RU: Record<string, string> = { owner: 'владелец', lead: 'руководитель', editor: 'редактор', viewer: 'наблюдатель' };
const PROJECTS_PREVIEW = 8;

export function UserAvatar({ user, className }: { user: Pick<AdminUser, 'id' | 'displayName' | 'avatarUrl'>; className?: string }): React.ReactElement {
  return (
    <Avatar className={cn('size-7', className)}>
      {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
      <AvatarFallback className={cn('bg-tone-solid text-2xs text-tone-on-solid', toneClass(toneOf(user.id)))}>
        {getInitials(user.displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

export function UserBadges({ user, now }: { user: AdminUser; now: number }): React.ReactElement {
  const plan = planBadge(user, now);
  return (
    <>
      {user.deletedAt
        ? <span className="pf-tag pf-tone-gray shrink-0 text-2xs">удалён</span>
        : user.plan === 'free'
          // Free is the default: plain text, so paid and expired plans stand out in the list.
          ? <span className="shrink-0 text-meta text-muted-foreground" title={plan.title}>Free</span>
          : <span className={cn('pf-tag shrink-0 text-2xs', plan.tone)} title={plan.title}>{plan.label}</span>}
      {user.isAdmin && <span className="pf-tag pf-tone-blue shrink-0 text-2xs">админ</span>}
    </>
  );
}

function Section({ title, icon: Icon, children, aside }: {
  title: string; icon?: React.ComponentType<{ className?: string }>; children: ReactNode; aside?: ReactNode;
}): React.ReactElement {
  return (
    <section className="space-y-2 border-bs border-border pbs-4" aria-label={title}>
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-ui font-semibold">
          {Icon && <Icon className="size-3.5 text-muted-foreground" />}
          {title}
        </h3>
        {aside && <div className="ms-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: readonly [string, ReactNode][] }): React.ReactElement {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// The user panel: everything about one account and every action on it. Right side on desktop,
// bottom sheet on phones. Opens by ?user=<id>, so a link to it can be shared between admins.
export function AdminUserDrawer({
  userId,
  refreshKey,
  actions,
  onClose,
}: {
  userId: string | null;
  refreshKey: number;
  actions: AdminUserActions;
  onClose: () => void;
}): React.ReactElement {
  const { adminRepository } = useContainer();
  const mobile = useMobileSheet();
  const [data, setData] = useState<AdminUserOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback((): (() => void) | void => {
    if (!userId) return;
    let alive = true;
    setError(null);
    adminRepository.getUserOverview(userId)
      .then((o) => { if (alive) { setData(o); setNow(Date.now()); } })
      .catch((e: unknown) => { if (alive) setError(errorText(e, 'Не удалось загрузить пользователя')); });
    return () => { alive = false; };
  }, [adminRepository, userId]);

  useEffect(() => { setData(null); setAllProjects(false); }, [userId]);
  useEffect(() => load(), [load, refreshKey]);

  const u = data?.user.id === userId ? data.user : null;
  const self = u ? actions.isSelf(u) : false;
  const deleted = Boolean(u?.deletedAt);

  return (
    <Sheet open={userId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={mobile ? 'bottom' : 'right'}
        dimmed
        aria-describedby={undefined}
        data-admin-user-drawer={userId ?? undefined}
        className={cn('flex flex-col gap-0 p-0', mobile ? 'h-[92dvh] rounded-t-xl' : 'w-full sm:max-w-xl')}
      >
        <SheetHeader className="space-y-0 border-be border-border px-4 pbe-3 pbs-4 text-start">
          {u ? (
            <div className="flex items-start gap-3 pe-8">
              <UserAvatar user={u} className="size-10" />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base">{u.displayName}</SheetTitle>
                <SheetDescription className="truncate text-meta">{u.email}</SheetDescription>
                <div className="mbs-1.5 flex flex-wrap items-center gap-1.5"><UserBadges user={u} now={now} /></div>
              </div>
            </div>
          ) : (
            <SheetTitle className="sr-only">Пользователь</SheetTitle>
          )}
          {u && !deleted && (
            <div className="grid grid-cols-2 gap-1.5 pbs-3 sm:flex">
              <Button size="sm" variant="outline" disabled={self || actions.impersonating !== null} onClick={() => actions.impersonate(u)}
                title={self ? 'Это вы' : 'Открыть платформу так, как её видит пользователь'}>
                {actions.impersonating === u.id ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <Eye className="size-3.5" />}
                Войти как
              </Button>
              <Button size="sm" variant="outline" onClick={() => actions.edit(u)}><Pencil className="size-3.5" /> Изменить профиль</Button>
            </div>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pbe-[calc(1.5rem_+_env(safe-area-inset-bottom))] pbs-4">
          {error && <AdminError message={error} onRetry={() => { load(); }} />}
          {!u && !error && (
            <LoadingRegion className="space-y-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </LoadingRegion>
          )}
          {u && data && (
            <>
              <Facts rows={[
                ['Telegram', u.telegramLinked ? (u.telegramUsername ? `@${u.telegramUsername}` : 'привязан') : 'не привязан'],
                ['Регистрация', shortDate(u.createdAt)],
                ['Последний вход', data.activity.lastLoginAt ? activityText(data.activity.lastLoginAt, now) : 'нет данных'],
                ['Активность', activityText(data.activity.lastSeenAt, now)],
                ...(deleted ? [['Удалён', shortDate(u.deletedAt!)] as [string, ReactNode]] : []),
              ]} />

              {!deleted && (
                <Section title="Тариф и срок" icon={CreditCard}
                  aside={<Button size="sm" variant="ghost" onClick={() => actions.plan(u)}>Изменить тариф</Button>}>
                  <p className="text-ui">{planBadge(u, now).title}</p>
                </Section>
              )}

              {!deleted && (
                <Section title="Роль и доступ" icon={Shield}>
                  <Facts rows={[
                    ['Роль', u.isAdmin ? 'администратор' : 'пользователь'],
                    ['Активные сессии', data.activity.activeSessions],
                  ]} />
                  <div className="flex flex-col gap-1.5 pbs-1 sm:flex-row sm:flex-wrap [&>button]:justify-start">
                    <Button size="sm" variant="outline" disabled={self} title={self ? 'Нельзя изменить свою роль' : undefined}
                      onClick={() => actions.toggleAdmin(u)}>
                      {u.isAdmin ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />}
                      {u.isAdmin ? 'Снять права администратора' : 'Сделать администратором'}
                    </Button>
                    <Button size="sm" variant="outline" disabled={self || data.activity.activeSessions === 0}
                      title={self ? 'Свои сессии завершайте через выход из аккаунта' : undefined}
                      onClick={() => actions.signOutAll(u)}>
                      <LogOut className="size-3.5" /> Завершить все сессии
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => actions.sendPasswordReset(u)}>
                      <KeyRound className="size-3.5" /> Ссылка для смены пароля
                    </Button>
                  </div>
                </Section>
              )}

              <Section title="Активность за 30 дней">
                <Facts rows={[
                  ['Создано задач', data.activity.tasksCreated30d],
                  ['Комментариев', data.activity.comments30d],
                  ['Расход ИИ', <>{formatUsd(data.usage.costUsd30d)} <span className="text-muted-foreground">· {data.usage.runs30d} {pluralRu(data.usage.runs30d, 'запуск', 'запуска', 'запусков')}, всего {formatUsd(data.usage.costUsdTotal)}</span></>],
                ]} />
              </Section>

              <Section title={`Пространства · ${data.workspaces.length}`}>
                {data.workspaces.length === 0 ? <p className="text-meta text-muted-foreground">Не состоит ни в одном пространстве.</p> : (
                  <ul className="space-y-1 text-ui">
                    {data.workspaces.map((w) => (
                      <li key={w.id} className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate">{w.name}</span>
                        <span className="ms-auto shrink-0 text-meta text-muted-foreground">
                          {w.kind === 'default' ? 'личное · ' : ''}{ROLE_RU[w.role] ?? w.role} · {w.memberCount} {pluralRu(w.memberCount, 'участник', 'участника', 'участников')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={`Проекты · ${data.projects.length}`} icon={FolderGit2}
                aside={!deleted && <Button size="sm" variant="ghost" onClick={() => actions.dispatchers(u)}><Bot className="size-3.5" /> Диспетчеры</Button>}>
                {data.projects.length === 0 ? <p className="text-meta text-muted-foreground">Проектов нет.</p> : (
                  <>
                    <ul className="space-y-1 text-ui">
                      {(allProjects ? data.projects : data.projects.slice(0, PROJECTS_PREVIEW)).map((p) => (
                        <li key={p.id} className="flex min-w-0 items-center gap-2">
                          <Link to={`/projects/${p.id}`} className="min-w-0 truncate hover:underline focus-visible:underline">{p.name}</Link>
                          <span className="ms-auto shrink-0 text-meta tabular-nums text-muted-foreground">
                            {ROLE_RU[p.role] ?? p.role} · {p.taskCount} {pluralRu(p.taskCount, 'задача', 'задачи', 'задач')}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {data.projects.length > PROJECTS_PREVIEW && (
                      <Button size="sm" variant="link" className="px-0" onClick={() => setAllProjects((v) => !v)}>
                        {allProjects ? 'Свернуть' : `Показать все ${data.projects.length}`}
                      </Button>
                    )}
                  </>
                )}
              </Section>

              <Section title="История действий" icon={History}>
                {data.history.length === 0 ? (
                  <p className="text-meta text-muted-foreground">Администраторы ещё ничего не меняли.</p>
                ) : (
                  <ol className="space-y-2" data-admin-history>
                    {data.history.map((e) => (
                      <li key={e.id} className="text-ui">
                        <p className="break-words">{auditText(e)}</p>
                        <p className="text-meta text-muted-foreground">
                          {e.actorDisplayName ?? 'Администратор'}, {new Date(e.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              {!deleted && (
                <Section title="Удаление">
                  <p className="text-meta text-muted-foreground">
                    Перед удалением покажем, что удалится и что перейдёт команде. Удалить себя и других администраторов нельзя.
                  </p>
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive-soft"
                    disabled={self} onClick={() => actions.remove(u)}>
                    <Trash2 className="size-3.5" /> Удалить пользователя
                  </Button>
                </Section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
