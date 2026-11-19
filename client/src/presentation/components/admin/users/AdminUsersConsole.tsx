import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownNarrowWide, ArrowUpWideNarrow, ChevronLeft, ChevronRight, CreditCard, Download, Eye, Loader2, Megaphone,
  MoreHorizontal, Pencil, Search, Send, Shield, ShieldOff, Trash2, UserRound, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  ADMIN_USER_FILTERS, ADMIN_USER_SORTS, type AdminUser, type AdminUserFilter, type AdminUserPage, type AdminUserSort,
} from '@/application/admin/AdminRepository';
import { useContainer } from '@/infrastructure/di/container';
import { AdminEmpty, AdminError, AdminLoading, errorText } from '@/presentation/components/admin/AdminState';
import { pluralRu } from '@/presentation/components/admin/mailing/mailingFormat';
import { AdminUserDrawer, UserAvatar, UserBadges } from './AdminUserDrawer';
import { BulkPlanDialog } from './AdminUserActionDialogs';
import { useAdminUserActions, type AdminUserActions } from './useAdminUserActions';
import {
  FILTER_LABEL, INACTIVE_DAY_OPTIONS, SORT_LABEL, activityText, parseConsoleState, shortDate,
  toListQuery, updateConsoleState, usersToCsv, writeConsoleState, type ConsoleState,
} from './userConsoleState';

const SELECT_ALL_LIMIT = 500;

// «Пользователи»: search, filters with counts, sorting and paging on the server; a dense
// table on desktop and cards on phones; bulk actions over the selection; the user panel.
export function AdminUsersConsole({ onMailSelected }: { onMailSelected: (userIds: readonly string[]) => void }): React.ReactElement {
  const { adminRepository } = useContainer();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseConsoleState(params), [params]);
  const openUserId = params.get('user');

  const [page, setPage] = useState<AdminUserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Map<string, AdminUser>>(() => new Map());
  const [bulkPlan, setBulkPlan] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  // «Now» for relative times and plan terms, taken when the page arrives (render stays pure).
  const [now, setNow] = useState(() => Date.now());

  const setState = useCallback((patch: Partial<ConsoleState>, replace = false): void => {
    setParams((prev) => writeConsoleState(prev, updateConsoleState(parseConsoleState(prev), patch)), { replace });
  }, [setParams]);
  const openUser = useCallback((id: string | null): void => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('user', id); else next.delete('user');
      return next;
    });
  }, [setParams]);

  const queryKey = JSON.stringify(toListQuery(state));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    adminRepository.listUsers(toListQuery(state))
      .then((p) => { if (alive) { setPage(p); setNow(Date.now()); } })
      .catch((e: unknown) => { if (alive) setError(errorText(e, 'Не удалось загрузить пользователей')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // queryKey stands for state: the parsed object is recreated on every URL change.
  }, [adminRepository, queryKey, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The panel reloads after changes to its user; after a deletion only the list does.
  const [drawerKey, setDrawerKey] = useState(0);
  const reloadList = useCallback(() => setReloadKey((k) => k + 1), []);
  const refresh = useCallback(() => { reloadList(); setDrawerKey((k) => k + 1); }, [reloadList]);
  const { actions, dialogs } = useAdminUserActions({
    onChanged: refresh,
    onDeleted: (u) => {
      setSelected((s) => { const n = new Map(s); n.delete(u.id); return n; });
      if (openUserId === u.id) openUser(null);
      reloadList();
    },
  });

  const users = page?.users ?? [];
  const pageSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const someSelected = users.some((u) => selected.has(u.id));
  const toggle = (u: AdminUser, on: boolean): void => setSelected((s) => {
    const n = new Map(s);
    if (on) n.set(u.id, u); else n.delete(u.id);
    return n;
  });
  const togglePage = (on: boolean): void => setSelected((s) => {
    const n = new Map(s);
    for (const u of users) if (u.deletedAt === null) { if (on) n.set(u.id, u); else n.delete(u.id); }
    return n;
  });
  const selectAllMatching = async (): Promise<void> => {
    if (!page) return;
    setSelectingAll(true);
    try {
      const all = await adminRepository.listUsers({ ...toListQuery(state), page: 1, pageSize: SELECT_ALL_LIMIT });
      setSelected((s) => {
        const n = new Map(s);
        for (const u of all.users) if (u.deletedAt === null) n.set(u.id, u);
        return n;
      });
    } catch (e) {
      toast.error(errorText(e, 'Не удалось выбрать пользователей'));
    } finally {
      setSelectingAll(false);
    }
  };

  const exportCsv = (list: readonly AdminUser[]): void => {
    const blob = new Blob([usersToCsv(list)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selection = [...selected.values()];
  const from = page && page.total > 0 ? (page.page - 1) * page.pageSize + 1 : 0;
  const to = page ? Math.min(page.page * page.pageSize, page.total) : 0;
  const lastPage = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <div className="space-y-3" data-admin-users>
      <Toolbar state={state} onChange={setState} loading={loading && page !== null} />
      <FilterChips state={state} counts={page?.counts ?? null} onChange={setState} />

      {error && <AdminError message={error} onRetry={refresh} />}
      {!page && !error && <AdminLoading rows={8} />}
      {page && users.length === 0 && !error && (
        <AdminEmpty icon={state.q || state.filter !== 'all' ? Search : Users}
          title={state.q || state.filter !== 'all' ? 'Никто не подходит под условия' : 'Пользователей пока нет'}
          action={(state.q || state.filter !== 'all') && (
            <Button size="sm" variant="outline" onClick={() => setState({ q: '', filter: 'all' })}>Сбросить поиск и фильтр</Button>
          )}>
          {state.q ? `По запросу «${state.q}» в разделе «${FILTER_LABEL[state.filter]}» ничего нет.` : null}
        </AdminEmpty>
      )}

      {page && users.length > 0 && (
        <>
          {pageSelected && page.total > users.length && selected.size < Math.min(page.total, SELECT_ALL_LIMIT) && (
            <p className="flex flex-wrap items-center gap-x-2 rounded-md bg-selection px-3 py-1.5 text-meta">
              Выбраны все {users.length} на странице.
              <Button size="sm" variant="link" className="h-auto px-0" disabled={selectingAll} onClick={() => void selectAllMatching()}>
                {selectingAll && <Loader2 className="size-3 motion-safe:animate-spin" />}
                Выбрать всех {Math.min(page.total, SELECT_ALL_LIMIT)} по условиям
              </Button>
            </p>
          )}
          <UsersTable users={users} selected={selected} pageSelected={pageSelected} someSelected={someSelected}
            onToggle={toggle} onTogglePage={togglePage} onOpen={(u) => openUser(u.id)} actions={actions}
            dimmed={loading} now={now} />
          <UsersCards users={users} selected={selected} onToggle={toggle} onOpen={(u) => openUser(u.id)}
            pageSelected={pageSelected} someSelected={someSelected} onTogglePage={togglePage} dimmed={loading} now={now} />
          <nav className="flex flex-wrap items-center justify-between gap-2 text-meta text-muted-foreground" aria-label="Страницы">
            <span className="tabular-nums" aria-live="polite">{from}–{to} из {page.total}</span>
            {lastPage > 1 && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={page.page <= 1} onClick={() => setState({ page: page.page - 1 })} aria-label="Предыдущая страница">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="tabular-nums">{page.page} / {lastPage}</span>
                <Button size="sm" variant="ghost" disabled={page.page >= lastPage} onClick={() => setState({ page: page.page + 1 })} aria-label="Следующая страница">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </nav>
        </>
      )}

      {selection.length > 0 && (
        <BulkBar count={selection.length} onClear={() => setSelected(new Map())}
          onPlan={() => setBulkPlan(true)}
          onMail={() => onMailSelected(selection.map((u) => u.id))}
          onExport={() => exportCsv(selection)} />
      )}

      {bulkPlan && (
        <BulkPlanDialog count={selection.length} onClose={() => setBulkPlan(false)} onSubmit={async (input) => {
          const result = await adminRepository.bulkSetPlan({ userIds: selection.map((u) => u.id), ...input });
          toast.success(`Тариф изменён у ${result.updated} ${pluralRu(result.updated, 'пользователя', 'пользователей', 'пользователей')}`
            + (result.missing.length > 0 ? `, не найдено: ${result.missing.length}` : ''));
          setSelected(new Map());
          refresh();
        }} />
      )}

      <AdminUserDrawer userId={openUserId} refreshKey={drawerKey} actions={actions} onClose={() => openUser(null)} />
      {dialogs}
    </div>
  );
}

function Toolbar({ state, onChange, loading }: {
  state: ConsoleState; onChange: (patch: Partial<ConsoleState>, replace?: boolean) => void; loading: boolean;
}): React.ReactElement {
  // Typing updates the URL after a pause, replacing the history entry: Back leaves the console.
  const [draft, setDraft] = useState(state.q);
  const pending = useRef<number | null>(null);
  useEffect(() => { setDraft(state.q); }, [state.q]);
  const type = (value: string): void => {
    setDraft(value);
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => onChange({ q: value }, true), 250);
  };
  useEffect(() => () => { if (pending.current) window.clearTimeout(pending.current); }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-64">
        {loading
          ? <Loader2 className="pointer-events-none absolute start-2.5 inset-bs-1/2 size-3.5 -translate-y-1/2 text-muted-foreground motion-safe:animate-spin" />
          : <Search className="pointer-events-none absolute start-2.5 inset-bs-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />}
        <Input type="search" value={draft} onChange={(e) => type(e.target.value)} aria-label="Поиск пользователей"
          placeholder="Имя, почта или @telegram" className="ps-8"
          onKeyDown={(e) => { if (e.key === 'Escape' && draft) { e.preventDefault(); type(''); } }} />
      </div>
      <div className="flex items-center gap-1">
        <label className="sr-only" htmlFor="admin-users-sort">Сортировка</label>
        <select id="admin-users-sort" value={state.sort} onChange={(e) => onChange({ sort: e.target.value as AdminUserSort })}
          className="h-11 rounded-md border border-input bg-background ps-2 pe-7 text-ui sm:h-8">
          {ADMIN_USER_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
        </select>
        <Button variant="outline" size="icon" onClick={() => onChange({ dir: state.dir === 'asc' ? 'desc' : 'asc' })}
          aria-label={state.dir === 'asc' ? 'По возрастанию — переключить' : 'По убыванию — переключить'}
          title={state.dir === 'asc' ? 'По возрастанию' : 'По убыванию'}>
          {state.dir === 'asc' ? <ArrowDownNarrowWide className="size-4" /> : <ArrowUpWideNarrow className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

// The overview of the user base: every filter with its count for the current search.
function FilterChips({ state, counts, onChange }: {
  state: ConsoleState; counts: Readonly<Record<AdminUserFilter, number>> | null; onChange: (patch: Partial<ConsoleState>) => void;
}): React.ReactElement {
  return (
    <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pf-scrollbar-hide sm:mx-0 sm:px-0">
      <div role="radiogroup" aria-label="Фильтр пользователей" className="flex w-max items-center gap-1.5 sm:w-auto sm:flex-wrap">
        {ADMIN_USER_FILTERS.map((f) => {
          const active = state.filter === f;
          const count = counts?.[f];
          return (
            <button key={f} type="button" role="radio" aria-checked={active} onClick={() => onChange({ filter: f })}
              data-admin-filter={f}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-ui transition-colors sm:h-7 sm:px-2.5',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                active ? 'border-transparent bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
                f === 'deleted' && !active && 'border-dashed',
              )}>
              {f === 'inactive' ? `${FILTER_LABEL[f]} ${state.inactiveDays} дн` : FILTER_LABEL[f]}
              <span className={cn('tabular-nums', active ? 'opacity-70' : 'opacity-80')}>{count ?? '·'}</span>
            </button>
          );
        })}
        {state.filter === 'inactive' && (
          <select aria-label="Сколько дней без активности" value={state.inactiveDays}
            onChange={(e) => onChange({ inactiveDays: Number(e.target.value) })}
            className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-ui sm:h-7">
            {INACTIVE_DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} дней</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

type RowProps = {
  users: readonly AdminUser[];
  selected: ReadonlyMap<string, AdminUser>;
  pageSelected: boolean;
  someSelected: boolean;
  onToggle: (u: AdminUser, on: boolean) => void;
  onTogglePage: (on: boolean) => void;
  onOpen: (u: AdminUser) => void;
  dimmed: boolean;
  now: number;
};

function UsersTable({ users, selected, pageSelected, someSelected, onToggle, onTogglePage, onOpen, actions, dimmed, now }: RowProps & { actions: AdminUserActions }): React.ReactElement {
  const th = 'sticky inset-bs-0 z-10 bg-card px-2 py-2 text-start text-meta font-medium text-muted-foreground first:rounded-ss-lg last:rounded-se-lg';
  return (
    <div className={cn('hidden rounded-lg bg-card shadow-card md:block', dimmed && 'opacity-60')}>
      <table className="w-full table-fixed border-collapse text-ui" data-admin-users-table>
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-44" />
          <col className="w-20" />
          <col className="hidden w-28 lg:table-column" />
          <col className="w-32" />
          <col className="hidden w-28 xl:table-column" />
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr className="border-be border-border">
            <th className={cn(th, 'ps-3')}>
              <Checkbox aria-label="Выбрать всех на странице" checked={pageSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(v) => onTogglePage(v === true)} />
            </th>
            <th className={th}>Пользователь</th>
            <th className={th}>Тариф</th>
            <th className={cn(th, 'text-end')}>Проекты</th>
            <th className={cn(th, 'hidden text-end lg:table-cell')}>Пространства</th>
            <th className={th}>Активность</th>
            <th className={cn(th, 'hidden xl:table-cell')}>Регистрация</th>
            <th className={th}><span className="sr-only">Действия</span></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelected = selected.has(u.id);
            return (
              <tr key={u.id} data-admin-user={u.id}
                className={cn('group cursor-pointer border-be border-border last:border-be-0', isSelected ? 'bg-selection' : 'hover:bg-hover',
                  u.deletedAt && 'text-muted-foreground')}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('button,a,input,[role="checkbox"],[role="menuitem"]')) onOpen(u); }}>
                <td className="ps-3 pe-2 py-1.5">
                  <Checkbox aria-label={`Выбрать ${u.displayName}`} checked={isSelected} disabled={u.deletedAt !== null}
                    onCheckedChange={(v) => onToggle(u, v === true)} />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <UserAvatar user={u} />
                    <div className="min-w-0">
                      <button type="button" onClick={() => onOpen(u)}
                        className="block max-w-full truncate text-start font-medium hover:underline focus-visible:underline focus-visible:outline-none">
                        {u.displayName}
                        {actions.isSelf(u) && <span className="ms-1.5 text-meta font-normal text-muted-foreground">это вы</span>}
                      </button>
                      <p className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
                        <span className="truncate">{u.email}</span>
                        {u.telegramLinked && <Send className="size-3 shrink-0" aria-label="Telegram привязан" />}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5"><div className="flex min-w-0 flex-wrap gap-1"><UserBadges user={u} now={now} /></div></td>
                <td className="px-2 py-1.5 text-end tabular-nums">{u.projectCount}</td>
                <td className="hidden px-2 py-1.5 text-end tabular-nums lg:table-cell">{u.workspaceCount}</td>
                <td className="truncate px-2 py-1.5 text-meta text-muted-foreground" title={u.lastLoginAt ? `Последний вход: ${shortDate(u.lastLoginAt)}` : undefined}>
                  {activityText(u.lastActivityAt, now)}
                </td>
                <td className="hidden px-2 py-1.5 text-meta tabular-nums text-muted-foreground xl:table-cell">{shortDate(u.createdAt)}</td>
                <td className="pe-2 py-1.5">
                  {!u.deletedAt && <RowActions user={u} actions={actions} onOpen={onOpen} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({ user: u, actions, onOpen }: { user: AdminUser; actions: AdminUserActions; onOpen: (u: AdminUser) => void }): React.ReactElement {
  const self = actions.isSelf(u);
  return (
    <div className="flex items-center justify-end gap-0.5">
      {/* Quick action on hover; always reachable through the menu and the keyboard. */}
      <Button size="icon" variant="ghost" className="size-7 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        disabled={self || actions.impersonating !== null} onClick={() => actions.impersonate(u)}
        aria-label={`Войти как ${u.displayName}`} title="Войти как">
        {actions.impersonating === u.id ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <Eye className="size-3.5" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-7" aria-label={`Действия: ${u.displayName}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onSelect={() => onOpen(u)}><UserRound className="size-3.5" /> Открыть карточку</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.plan(u)}><CreditCard className="size-3.5" /> Тариф и срок</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.edit(u)}><Pencil className="size-3.5" /> Изменить профиль</DropdownMenuItem>
          <DropdownMenuItem disabled={self} onSelect={() => actions.impersonate(u)}><Eye className="size-3.5" /> Войти как</DropdownMenuItem>
          <DropdownMenuItem disabled={self} onSelect={() => actions.toggleAdmin(u)}>
            {u.isAdmin ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />}
            {u.isAdmin ? 'Снять права администратора' : 'Сделать администратором'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={self} className="text-destructive focus:text-destructive" onSelect={() => actions.remove(u)}>
            <Trash2 className="size-3.5" /> Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function UsersCards({ users, selected, pageSelected, someSelected, onToggle, onTogglePage, onOpen, dimmed, now }: RowProps): React.ReactElement {
  return (
    <div className={cn('space-y-2 md:hidden', dimmed && 'opacity-60')}>
      <label className="flex min-h-11 items-center gap-2.5 px-1 text-meta text-muted-foreground">
        <Checkbox checked={pageSelected ? true : someSelected ? 'indeterminate' : false} onCheckedChange={(v) => onTogglePage(v === true)} />
        Выбрать всех на странице
      </label>
      <ul className="divide-y divide-border overflow-clip rounded-lg bg-card shadow-card">
        {users.map((u) => {
          const isSelected = selected.has(u.id);
          return (
            <li key={u.id} data-admin-user={u.id} className={cn('flex items-start gap-1', isSelected && 'bg-selection', u.deletedAt && 'text-muted-foreground')}>
              <label className="grid size-11 shrink-0 place-items-center">
                <Checkbox aria-label={`Выбрать ${u.displayName}`} checked={isSelected} disabled={u.deletedAt !== null}
                  onCheckedChange={(v) => onToggle(u, v === true)} />
              </label>
              <button type="button" onClick={() => onOpen(u)}
                className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 pe-3 text-start active:bg-active focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                <UserAvatar user={u} className="mbs-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium">{u.displayName}</span>
                  <span className="block truncate text-meta text-muted-foreground">{u.email}</span>
                  <span className="mbs-1 flex flex-wrap items-center gap-1"><UserBadges user={u} now={now} /></span>
                  <span className="mbs-1 block text-meta text-muted-foreground">
                    {u.projectCount} {pluralRu(u.projectCount, 'проект', 'проекта', 'проектов')} · {activityText(u.lastActivityAt, now)}
                    {u.telegramLinked ? ' · Telegram' : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BulkBar({ count, onClear, onPlan, onMail, onExport }: {
  count: number; onClear: () => void; onPlan: () => void; onMail: () => void; onExport: () => void;
}): React.ReactElement {
  return (
    <div role="toolbar" aria-label={`Действия с выбранными: ${count}`} data-admin-bulk-bar
      className="fixed start-3 end-3 inset-be-[calc(4.5rem_+_env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-lg items-center gap-1 rounded-xl bg-toast p-1 text-toast-foreground shadow-float sm:inset-be-6 sm:p-1.5">
      <span className="flex shrink-0 items-center gap-1.5 ps-2 text-ui font-medium tabular-nums">
        <span className="max-[399px]:sr-only">Выбрано:</span>
        <span className="grid min-w-6 place-items-center rounded-md bg-toast-foreground/15 px-1.5">{count}</span>
      </span>
      <div className="ms-auto flex min-w-0 items-center">
        <BulkButton onClick={onPlan} icon={CreditCard}>Тариф</BulkButton>
        <BulkButton onClick={onMail} icon={Megaphone}>Рассылка</BulkButton>
        <BulkButton onClick={onExport} icon={Download}>CSV</BulkButton>
        <button type="button" onClick={onClear} aria-label="Снять выбор"
          className="grid size-10 place-items-center rounded-lg hover:bg-toast-foreground/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-toast-accent sm:size-8">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function BulkButton({ onClick, icon: Icon, children }: { onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: string }): React.ReactElement {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-ui font-medium transition-colors hover:bg-toast-foreground/10 active:bg-toast-foreground/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-toast-accent sm:h-8 sm:px-2.5">
      <Icon className="size-3.5 max-[359px]:hidden" /> {children}
    </button>
  );
}
