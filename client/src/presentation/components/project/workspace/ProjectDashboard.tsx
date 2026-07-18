import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Globe2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { siteResultDisplayUrl, siteResultUrl } from '@/lib/publicBoardUrl';
import { cn } from '@/lib/utils';
import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { AppBackendDashboard, ProjectSite } from '@/application/project/ProjectRepository';
import { AppDataExplorer } from './AppDataExplorer';
import { AppLogsPanel } from './AppLogsPanel';

type Section = 'overview' | 'users' | 'data' | 'logs';
const SECTION = [
  { id: 'overview' as const, label: 'Обзор', icon: Globe2 },
  { id: 'users' as const, label: 'Пользователи', icon: Users },
  { id: 'data' as const, label: 'Данные', icon: Database },
  { id: 'logs' as const, label: 'Логи', icon: Activity },
];

function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}
export function ProjectDashboard({
  project,
  members,
  canEdit,
  onOpenPreview,
}: {
  project: Project;
  members: readonly ProjectMember[];
  canEdit: boolean;
  onOpenPreview: () => void;
}): React.ReactElement {
  const { projectRepository } = useContainer();
  const [section, setSection] = useState<Section>('overview');
  const [dashboard, setDashboard] = useState<AppBackendDashboard | null>(null);
  const [site, setSite] = useState<ProjectSite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([
      projectRepository.getAppBackendDashboard(project.id),
      projectRepository.getProjectSite(project.id),
    ]).then(([backend, projectSite]) => {
      if (cancelled) return;
      setDashboard(backend);
      setSite(projectSite);
    }).catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, projectRepository, reload]);

  if (loading) return <div className="grid min-h-[480px] place-items-center text-sm text-muted-foreground"><span><Loader2 className="mr-2 inline size-4 animate-spin" />Загружаем Dashboard…</span></div>;
  if (error || !dashboard) return <div className="grid min-h-[480px] place-items-center text-center"><div><p className="font-medium">Dashboard не загрузился</p><p className="mt-1 text-sm text-muted-foreground">Данные проекта остались в безопасности. Попробуйте ещё раз.</p><Button variant="outline" className="mt-4" onClick={() => setReload((value) => value + 1)}>Повторить</Button></div></div>;

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/10">
      <div className="flex min-h-[620px] flex-col md:flex-row">
        <aside className="hidden w-48 shrink-0 border-r bg-background p-2 md:block">
          <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Dashboard</p>
          <nav className="space-y-0.5">{SECTION.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setSection(id)} className={cn('flex h-10 w-full items-center gap-2 rounded-md px-2.5 text-sm transition-colors', section === id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}><Icon className="size-4" />{label}</button>)}</nav>
          <div className="mt-4 border-t px-2 pt-3 text-xs text-muted-foreground"><p className="truncate font-medium text-foreground">{project.name}</p><p className="mt-1">{dashboard.status === 'active' ? `${dashboard.schema?.tables.length ?? 0} таблиц` : 'Без базы'}</p></div>
        </aside>

        <div className="min-w-0 flex-1 bg-background">
          <div className="flex items-center gap-2 border-b p-2 md:hidden">
            <select value={section} onChange={(event) => setSection(event.target.value as Section)} className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm font-medium">{SECTION.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <Button variant="ghost" size="icon" className="size-10" onClick={() => setReload((value) => value + 1)}><RefreshCw className="size-4" /><span className="sr-only">Обновить</span></Button>
          </div>
          <div className="p-3 sm:p-5 lg:p-6">
            {section === 'overview' && <Overview project={project} dashboard={dashboard} site={site} members={members} onOpenPreview={onOpenPreview} onRefresh={() => setReload((value) => value + 1)} />}
            {section === 'users' && <UsersSection project={project} members={members} />}
            {section === 'data' && <AppDataExplorer projectId={project.id} dashboard={dashboard} canEdit={canEdit} onDashboardChange={setDashboard} />}
            {section === 'logs' && <AppLogsPanel projectId={project.id} tables={dashboard.schema?.tables ?? []} members={members} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Overview({ project, dashboard, site, members, onOpenPreview, onRefresh }: { project: Project; dashboard: AppBackendDashboard; site: ProjectSite | null; members: readonly ProjectMember[]; onOpenPreview: () => void; onRefresh: () => void }): React.ReactElement {
  const deployed = Boolean(site?.siteSlug && site.deployedAt);
  const url = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const usagePercent = dashboard.storageLimitBytes > 0 ? Math.min(100, dashboard.usageBytes / dashboard.storageLimitBytes * 100) : 0;
  const copy = async (): Promise<void> => { if (!url) return; await navigator.clipboard.writeText(url); toast.success('Ссылка скопирована'); };
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-4">
        <span className="grid size-16 shrink-0 place-items-center rounded-2xl border bg-muted/35 text-3xl">{project.icon ?? '📦'}</span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-2xl font-semibold">{project.name}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{project.description || 'Результат проекта, пользователи и данные приложения в одном месте.'}</p><p className="mt-1 text-xs text-muted-foreground">Создан {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(project.createdAt)}</p></div>
        <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Обновить Dashboard"><RefreshCw className="size-4" /></Button>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <section className="rounded-xl border p-4 lg:col-span-2"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Результат проекта</p><p className="mt-0.5 text-xs text-muted-foreground">Опубликованный сайт воркера</p></div><span className={cn('rounded-full px-2 py-1 text-xs font-medium', deployed ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>{deployed ? 'Опубликован' : 'Ожидает запуска'}</span></div>{url ? <div className="mt-5 flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 truncate rounded-lg bg-muted/45 px-3 py-2 text-sm">{siteResultDisplayUrl(site!.siteSlug!)}</span><Button variant="outline" size="icon" onClick={() => void copy()}><Copy className="size-4" /></Button>{deployed && <Button size="sm" onClick={onOpenPreview}>Открыть Preview</Button>}<Button asChild variant="outline" size="icon"><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" /></a></Button></div> : <p className="mt-5 text-sm text-muted-foreground">Адрес появится после настройки проекта.</p>}<div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>{site?.fileCount ?? 0} файлов</span><span>{site?.routes.length ?? 0} маршрутов</span><span>{site?.deployedAt ? `Обновлено ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(site.deployedAt))}` : 'Ещё не публиковался'}</span></div></section>
        <section className="rounded-xl border p-4"><div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><p className="text-sm font-semibold">Доступ</p></div><p className="mt-4 text-2xl font-semibold">{members.length || 1}</p><p className="text-xs text-muted-foreground">участников проекта</p><button type="button" className="mt-4 text-sm font-medium text-primary hover:underline" onClick={() => window.dispatchEvent(new CustomEvent('pf:open-project-share', { detail: { projectId: project.id } }))}>Управлять доступом</button></section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border p-4"><div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><Database className="size-4 text-muted-foreground" /><p className="text-sm font-semibold">База приложения</p></div><p className="mt-1 text-xs text-muted-foreground">{dashboard.status === 'active' ? `${dashboard.schema?.tables.length ?? 0} таблиц` : 'Не подключена'}</p></div><span className="text-xs text-muted-foreground">{formatBytes(dashboard.usageBytes)} / {formatBytes(dashboard.storageLimitBytes)}</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${usagePercent}%` }} /></div>{dashboard.schema && <div className="mt-4 flex flex-wrap gap-1.5">{dashboard.schema.tables.slice(0, 8).map((table) => <span key={table.name} className="rounded-md bg-muted/60 px-2 py-1 text-xs">{table.name}</span>)}</div>}</section>
        <section className="rounded-xl border p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /><p className="text-sm font-semibold">Автоматические проверки</p></div><div className="mt-4 space-y-2.5"><HealthRow ok={Boolean(url?.startsWith('https://'))} label="HTTPS-адрес результата" /><HealthRow ok={Boolean(site?.siteSlug)} label="Изолированный поддомен проекта" /><HealthRow ok={deployed} label="Опубликованный артефакт" /><HealthRow ok={dashboard.status === 'active'} label="Управляемая база данных" optional /></div></section>
      </div>
    </div>
  );
}

function HealthRow({ ok, label, optional = false }: { ok: boolean; label: string; optional?: boolean }): React.ReactElement { return <div className="flex items-center gap-2 text-sm"><CheckCircle2 className={cn('size-4', ok ? 'text-emerald-500' : 'text-muted-foreground/40')} /><span className={ok ? '' : 'text-muted-foreground'}>{label}</span>{optional && !ok && <span className="ml-auto text-xs text-muted-foreground">необязательно</span>}</div>; }

function UsersSection({ project, members }: { project: Project; members: readonly ProjectMember[] }): React.ReactElement {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<ProjectRole | ''>('');
  const filtered = useMemo(() => members.filter((member) => (!role || member.role === role) && (!search.trim() || `${member.user.displayName} ${member.user.email}`.toLowerCase().includes(search.trim().toLowerCase()))), [members, role, search]);
  return <div className="overflow-hidden rounded-xl border"><div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2"><label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border px-2.5 sm:max-w-sm"><Search className="size-3.5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Имя или email…" /></label><select value={role} onChange={(event) => setRole(event.target.value as ProjectRole | '')} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">Все роли</option><option value="owner">Владелец</option><option value="editor">Редактор</option><option value="viewer">Наблюдатель</option></select><Button size="sm" className="h-9 gap-1.5" onClick={() => window.dispatchEvent(new CustomEvent('pf:open-project-share', { detail: { projectId: project.id } }))}><UserPlus className="size-3.5" />Пригласить</Button></div><div className="divide-y">{filtered.length === 0 ? <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">Участники не найдены.</div> : filtered.map((member) => <div key={member.userId} className="grid min-h-16 grid-cols-[40px_minmax(160px,1fr)_minmax(160px,1fr)_110px] items-center gap-3 px-3 text-sm"><span className="grid size-8 place-items-center overflow-hidden rounded-full bg-muted font-medium">{member.user.avatarUrl ? <img src={member.user.avatarUrl} alt="" className="size-full object-cover" /> : member.user.displayName.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-medium">{member.user.displayName}</p>{member.userId === project.ownerId && <p className="text-xs text-muted-foreground">Создатель проекта</p>}</div><span className="truncate text-muted-foreground">{member.user.email}</span><span className="w-fit rounded-full bg-muted/60 px-2 py-1 text-xs">{member.role === 'owner' ? 'Владелец' : member.role === 'editor' ? 'Редактор' : 'Наблюдатель'}</span></div>)}</div></div>;
}
