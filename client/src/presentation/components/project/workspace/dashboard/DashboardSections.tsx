import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDashed,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  Github,
  Globe2,
  Link2,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { siteResultDisplayUrl, siteResultUrl } from '@/lib/publicBoardUrl';
import { cn } from '@/lib/utils';
import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type { ProjectAnalytics } from '@/domain/project/ProjectAnalytics';
import type {
  AppBackendDashboard,
  AppDashboardSettings,
  DispatcherCandidate,
  ProjectSite,
} from '@/application/project/ProjectRepository';
import {
  buildProjectOpenApi,
  formatDashboardBytes,
  normalizeCustomDomain,
} from './dashboardConfig';

export type DashboardContentProps = {
  readonly project: Project;
  readonly dashboard: AppBackendDashboard;
  readonly site: ProjectSite | null;
  readonly analytics: ProjectAnalytics | null;
  readonly dashboardSettings: AppDashboardSettings;
  readonly members: readonly ProjectMember[];
  readonly canEdit: boolean;
  readonly onOpenPreview: () => void;
  readonly onOpenAutomation: () => void;
  readonly onProjectUpdated: (project: Project) => void;
  readonly onDashboardSettingsUpdated: (settings: AppDashboardSettings) => void;
  readonly onRefresh: () => void;
};

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold tracking-tight">{title}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p></div>
      {action}
    </header>
  );
}

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }): React.ReactElement {
  return <span className={cn('inline-flex rounded-full px-2 py-1 text-xs font-medium', tone === 'ok' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', tone === 'warn' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300', tone === 'muted' && 'bg-muted text-muted-foreground')}>{children}</span>;
}

function NotConnected({ title, description }: { title: string; description: string }): React.ReactElement {
  return <div className="rounded-xl border border-dashed bg-muted/10 p-5"><div className="flex items-start gap-3"><CircleDashed className="mt-0.5 size-5 text-muted-foreground" /><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p></div></div></div>;
}

export function OverviewSection({ project, dashboard, site, members, onOpenPreview, onRefresh }: DashboardContentProps): React.ReactElement {
  const deployed = Boolean(site?.siteSlug && site.deployedAt);
  const url = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const usagePercent = dashboard.storageLimitBytes > 0 ? Math.min(100, dashboard.usageBytes / dashboard.storageLimitBytes * 100) : 0;
  const copy = async (): Promise<void> => { if (!url) return; await navigator.clipboard.writeText(url); toast.success('Ссылка скопирована'); };
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-4">
        <span className="grid size-16 shrink-0 place-items-center rounded-2xl border bg-muted/35 text-3xl" aria-hidden>{project.icon ?? '📦'}</span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-2xl font-semibold">{project.name}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{project.description || 'Результат проекта, пользователи и данные приложения в одном месте.'}</p><p className="mt-1 text-xs text-muted-foreground">Создан {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(project.createdAt)}</p></div>
        <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Обновить Dashboard"><RefreshCw className="size-4" /></Button>
      </header>
      <div className="grid gap-3 lg:grid-cols-3">
        <section className="rounded-xl border p-4 lg:col-span-2"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Результат проекта</p><p className="mt-0.5 text-xs text-muted-foreground">Опубликованный сайт воркера</p></div><StatusPill tone={deployed ? 'ok' : 'warn'}>{deployed ? 'Опубликован' : 'Ожидает запуска'}</StatusPill></div>{url ? <div className="mt-5 flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 truncate rounded-lg bg-muted/45 px-3 py-2 text-sm">{siteResultDisplayUrl(site!.siteSlug!)}</span><Button variant="outline" size="icon" onClick={() => void copy()} aria-label="Скопировать адрес"><Copy className="size-4" /></Button>{deployed && <Button size="sm" onClick={onOpenPreview}>Открыть Preview</Button>}<Button asChild variant="outline" size="icon"><a href={url} target="_blank" rel="noopener noreferrer" aria-label="Открыть результат отдельно"><ExternalLink className="size-4" /></a></Button></div> : <p className="mt-5 text-sm text-muted-foreground">Адрес появится после настройки проекта.</p>}<div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>{site?.fileCount ?? 0} файлов</span><span>{site?.routes.length ?? 0} маршрутов</span><span>{site?.deployedAt ? `Обновлено ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(site.deployedAt))}` : 'Ещё не публиковался'}</span></div></section>
        <section className="rounded-xl border p-4"><div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><p className="text-sm font-semibold">Доступ</p></div><p className="mt-4 text-2xl font-semibold">{members.length}</p><p className="text-xs text-muted-foreground">участников проекта</p><button type="button" className="mt-4 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => window.dispatchEvent(new CustomEvent('pf:open-project-share', { detail: { projectId: project.id } }))}>Управлять доступом</button></section>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Database className="size-4 text-muted-foreground" /><p className="text-sm font-semibold">База приложения</p></div><p className="mt-1 text-xs text-muted-foreground">{dashboard.status === 'active' ? `${dashboard.schema?.tables.length ?? 0} таблиц` : 'Не подключена'}</p></div><span className="text-xs text-muted-foreground">{formatDashboardBytes(dashboard.usageBytes)} / {formatDashboardBytes(dashboard.storageLimitBytes)}</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary motion-safe:transition-[width]" style={{ width: `${usagePercent}%` }} /></div>{dashboard.schema && <div className="mt-4 flex flex-wrap gap-1.5">{dashboard.schema.tables.slice(0, 8).map((table) => <span key={table.name} className="rounded-md bg-muted/60 px-2 py-1 text-xs">{table.name}</span>)}</div>}</section>
        <section className="rounded-xl border p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /><p className="text-sm font-semibold">Автоматические проверки</p></div><div className="mt-4 space-y-2.5"><HealthRow ok={Boolean(url?.startsWith('https://'))} label="HTTPS-адрес результата" /><HealthRow ok={Boolean(site?.siteSlug)} label="Изолированный поддомен проекта" /><HealthRow ok={deployed} label="Опубликованный артефакт" /><HealthRow ok={dashboard.status === 'active'} label="Управляемая база данных" optional /></div></section>
      </div>
    </div>
  );
}

function HealthRow({ ok, label, optional = false }: { ok: boolean; label: string; optional?: boolean }): React.ReactElement {
  return <div className="flex items-center gap-2 text-sm"><CheckCircle2 className={cn('size-4', ok ? 'text-emerald-500' : 'text-muted-foreground/40')} /><span className={ok ? '' : 'text-muted-foreground'}>{label}</span>{optional && !ok && <span className="ml-auto text-xs text-muted-foreground">необязательно</span>}</div>;
}

export function UsersSection({ project, members }: DashboardContentProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<ProjectRole | ''>('');
  const filtered = useMemo(() => members.filter((member) => (!role || member.role === role) && (!search.trim() || `${member.user.displayName} ${member.user.email}`.toLowerCase().includes(search.trim().toLowerCase()))), [members, role, search]);
  return <div className="space-y-4"><SectionHeader title="Пользователи" description="Участники проекта и их реальные роли в пространстве." action={<Button size="sm" className="gap-1.5" onClick={() => window.dispatchEvent(new CustomEvent('pf:open-project-share', { detail: { projectId: project.id } }))}><UserPlus className="size-3.5" />Пригласить</Button>} /><div className="overflow-hidden rounded-xl border"><div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2"><span className="rounded-md bg-muted px-3 py-2 text-sm font-medium">Участники ({members.length})</span><label className="ml-auto flex h-9 min-w-[220px] items-center gap-2 rounded-md border px-2.5"><Search className="size-3.5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Имя или email…" aria-label="Поиск участников" /></label><select aria-label="Фильтр роли" value={role} onChange={(event) => setRole(event.target.value as ProjectRole | '')} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">Все роли</option><option value="owner">Владелец</option><option value="editor">Редактор</option><option value="viewer">Наблюдатель</option></select></div><div className="divide-y">{filtered.length === 0 ? <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">Участники не найдены.</div> : filtered.map((member) => <div key={member.userId} className="grid min-h-16 grid-cols-[40px_minmax(130px,1fr)_minmax(130px,1fr)_110px] items-center gap-3 px-3 text-sm max-sm:grid-cols-[40px_1fr_auto]"><span className="grid size-8 place-items-center overflow-hidden rounded-full bg-muted font-medium">{member.user.avatarUrl ? <img src={member.user.avatarUrl} alt="" className="size-full object-cover" /> : member.user.displayName.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-medium">{member.user.displayName}</p>{member.userId === project.ownerId && <p className="text-xs text-muted-foreground">Создатель проекта</p>}</div><span className="truncate text-muted-foreground max-sm:hidden">{member.user.email}</span><span className="w-fit rounded-full bg-muted/60 px-2 py-1 text-xs">{member.role === 'owner' ? 'Владелец' : member.role === 'editor' ? 'Редактор' : 'Наблюдатель'}</span></div>)}</div></div></div>;
}

export function AnalyticsSection({ analytics, dashboard, site, members }: DashboardContentProps): React.ReactElement {
  const tableCount = dashboard.schema?.tables.length ?? 0;
  const routes = site?.routes.length ?? 0;
  const dailyMax = Math.max(1, ...(analytics?.perDay.map((day) => day.count) ?? [0]));
  const uniqueViewers = analytics?.viewers.length ?? 0;
  const metrics = [{ label: 'Просмотры', value: analytics?.totalViews ?? 0 }, { label: 'Зрители', value: uniqueViewers }, { label: 'Маршруты', value: routes }, { label: 'Таблицы', value: tableCount }];
  return <div className="space-y-5"><SectionHeader title="Аналитика" description={`Реальные просмотры страницы проекта за ${analytics?.windowDays ?? 28} дней и техническое состояние результата.`} /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => <section key={metric.label} className="rounded-xl border p-4"><p className="text-xs font-medium text-muted-foreground">{metric.label}</p><p className="mt-3 text-2xl font-semibold">{metric.value}</p></section>)}</div><section className="rounded-xl border p-4"><div className="flex items-center gap-2"><BarChart3 className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Просмотры по дням</h3></div><div className="mt-5 flex h-44 items-end gap-1 overflow-x-auto" aria-label="График просмотров">{analytics?.perDay.map((day) => <div key={day.date} className="group flex min-w-3 flex-1 flex-col items-center justify-end gap-1" title={`${day.date}: ${day.count} просмотров, ${day.unique} зрителей`}><span className="w-full rounded-t bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(day.count ? 6 : 2, day.count / dailyMax * 132)}px` }} /><span className="hidden text-[9px] text-muted-foreground xl:block">{day.date.slice(5)}</span></div>)}</div></section><section className="overflow-hidden rounded-xl border"><div className="border-b px-4 py-3 text-sm font-semibold">Последние зрители</div>{analytics?.viewers.length ? <div className="divide-y">{analytics.viewers.slice(0, 8).map((viewer) => <div key={viewer.userId} className="flex items-center gap-3 px-4 py-3"><span className="grid size-8 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold">{viewer.avatarUrl ? <img src={viewer.avatarUrl} alt="" className="size-full object-cover" /> : viewer.displayName.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{viewer.displayName}</p><p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(viewer.lastViewedAt)}</p></div><span className="text-xs tabular-nums text-muted-foreground">{viewer.viewCount}</span></div>)}</div> : <div className="grid min-h-28 place-items-center text-sm text-muted-foreground">За выбранный период просмотров не было.</div>}</section><p className="text-xs text-muted-foreground">В проекте {members.length} участников · опубликовано {site?.fileCount ?? 0} файлов.</p></div>;
}

export function MarketingSection({ project, canEdit, dashboardSettings, onProjectUpdated, onDashboardSettingsUpdated }: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [tab, setTab] = useState<'overview' | 'meta' | 'advanced'>('overview');
  const [title, setTitle] = useState(dashboardSettings.seo.title || project.name);
  const [description, setDescription] = useState(dashboardSettings.seo.description || project.description || '');
  const [robotsIndex, setRobotsIndex] = useState(dashboardSettings.seo.robotsIndex);
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const settings = await projectRepository.updateAppDashboardSettings(project.id, {
        seo: { title: title.trim(), description: description.trim(), robotsIndex },
      });
      let updated = project;
      if (project.description !== (description.trim() || null)) {
        updated = await projectRepository.update(project.id, { description: description.trim() || null });
      }
      if (updated.isPublic && updated.publicIndexing !== robotsIndex) {
        await projectRepository.setPublicIndexing(project.id, robotsIndex);
        updated = { ...updated, publicIndexing: robotsIndex };
      }
      onDashboardSettingsUpdated(settings);
      onProjectUpdated(updated);
      toast.success('Данные публикации сохранены');
    } catch { toast.error('Не удалось сохранить данные публикации'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-5"><SectionHeader title="SEO и маркетинг" description="Отдельные meta-данные приложения и реальная индексация публичной страницы проекта." action={<Button size="sm" disabled={!canEdit || saving || !title.trim()} onClick={() => void save()}>{saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}Сохранить</Button>} /><div className="inline-flex rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label="SEO"><button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'overview' && 'bg-background shadow-sm')}>Обзор</button><button type="button" role="tab" aria-selected={tab === 'meta'} onClick={() => setTab('meta')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'meta' && 'bg-background shadow-sm')}>Meta tags</button><button type="button" role="tab" aria-selected={tab === 'advanced'} onClick={() => setTab('advanced')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'advanced' && 'bg-background shadow-sm')}>Индексация</button></div>{tab === 'overview' && <div className="grid gap-3 lg:grid-cols-2"><section className="rounded-xl border p-4"><Sparkles className="size-5 text-primary" /><h3 className="mt-4 font-medium">Поисковое представление</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Meta title и description хранятся отдельно от рабочего названия проекта; описание синхронизируется с карточкой проекта.</p></section><section className="rounded-xl border bg-muted/15 p-4"><p className="truncate text-lg text-blue-700 dark:text-blue-300">{title || project.name}</p><p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">projectsflow.ru › p › {project.publicSlug ?? 'preview'}</p><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{description || 'Описание пока не задано.'}</p></section></div>}{tab === 'meta' && <div className="max-w-2xl space-y-4 rounded-xl border p-4"><label className="block space-y-1.5"><span className="text-sm font-medium">Title</span><input value={title} maxLength={70} onChange={(event) => setTitle(event.target.value)} disabled={!canEdit} className="h-10 w-full rounded-lg border bg-background px-3 text-sm" /><span className="text-xs text-muted-foreground">{title.length}/70</span></label><label className="block space-y-1.5"><span className="text-sm font-medium">Description</span><textarea value={description} maxLength={180} onChange={(event) => setDescription(event.target.value)} disabled={!canEdit} rows={4} className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" /><span className="text-xs text-muted-foreground">{description.length}/180</span></label></div>}{tab === 'advanced' && <div className="max-w-2xl rounded-xl border p-4"><label className="flex items-start justify-between gap-4"><span><span className="block text-sm font-medium">Разрешить индексацию</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Настройка сохраняется сейчас; поисковики увидят её после публикации проекта.</span>{!project.isPublic && <span className="mt-1 block text-xs text-amber-600">Проект пока не опубликован.</span>}</span><input type="checkbox" checked={robotsIndex} onChange={(event) => setRobotsIndex(event.target.checked)} disabled={!canEdit} className="mt-1 size-4" /></label></div>}</div>;
}

export function DomainsSection({ project, site, canEdit, dashboardSettings, onDashboardSettingsUpdated }: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const builtIn = site?.siteSlug ? siteResultDisplayUrl(site.siteSlug) : null;
  const [hostname, setHostname] = useState(dashboardSettings.customDomain.hostname ?? '');
  const [saving, setSaving] = useState(false);
  const copy = async (): Promise<void> => { if (!site?.siteSlug) return; await navigator.clipboard.writeText(siteResultUrl(site.siteSlug)); toast.success('Адрес скопирован'); };
  const custom = normalizeCustomDomain(hostname);
  const saveCustomDomain = async (): Promise<void> => {
    if (hostname.trim() && !custom) { toast.error('Введите домен вида app.example.com'); return; }
    setSaving(true);
    try {
      const next = await projectRepository.updateAppDashboardSettings(project.id, { customDomain: { hostname: custom } });
      onDashboardSettingsUpdated(next);
      setHostname(next.customDomain.hostname ?? '');
      toast.success(custom ? 'Домен отправлен на проверку' : 'Пользовательский домен удалён');
    } catch { toast.error('Не удалось сохранить домен'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-5"><SectionHeader title="Домены" description="Встроенный адрес работает сразу; пользовательский домен проходит внешнюю проверку DNS." /><section className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Globe2 className="size-5" /></span><div><p className="text-sm font-medium">Встроенный URL</p><p className="mt-1 break-all text-sm text-muted-foreground">{builtIn ?? 'Появится после подготовки результата'}</p><p className="mt-1 text-xs text-muted-foreground">HTTPS и поддомен выдаются автоматически.</p></div></div>{builtIn && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void copy()}><Copy className="mr-1.5 size-3.5" />Копировать</Button><Button asChild size="sm"><a href={siteResultUrl(site!.siteSlug!)} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 size-3.5" />Открыть</a></Button></div>}</div></section><section className="max-w-3xl rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Пользовательский домен</p><p className="mt-1 text-xs text-muted-foreground">После сохранения добавьте CNAME на <code className="rounded bg-muted px-1">{site?.siteSlug ?? 'project'}.projectsflow.ru</code>. Проверка и выпуск сертификата выполняются отдельно.</p></div>{dashboardSettings.customDomain.status === 'pending' && <StatusPill tone="warn">Ожидает DNS</StatusPill>}</div><div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="app.example.com" disabled={!canEdit || saving} className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm" /><Button onClick={() => void saveCustomDomain()} disabled={!canEdit || saving}>{saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}Сохранить</Button></div></section></div>;
}

export function IntegrationsSection({ project, dashboard, site, canEdit, dashboardSettings, onOpenPreview, onDashboardSettingsUpdated }: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [saving, setSaving] = useState<string | null>(null);
  const integrations = [
    { id: 'github', name: 'GitHub', description: project.gitRepoUrl ?? 'Репозиторий проекта не подключён.', icon: Github, connected: Boolean(project.gitRepoUrl), href: project.gitRepoUrl },
    { id: 'kb', name: 'База знаний', description: project.kbKind === 'github' ? 'Документы синхронизируются с GitHub.' : project.kbKind === 'local' ? 'Используется локальная база знаний ProjectsFlow.' : 'База знаний не создана.', icon: Link2, connected: project.kbKind !== 'none', href: null },
    { id: 'database', name: 'App Database', description: dashboard.status === 'active' ? `${dashboard.schema?.tables.length ?? 0} таблиц · ${formatDashboardBytes(dashboard.usageBytes)}` : 'Управляемая база приложения не создана.', icon: Database, connected: dashboard.status === 'active', href: null },
    { id: 'site', name: 'Публикация', description: site?.deployedAt ? `Обновлено ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(site.deployedAt))}` : 'Результат ещё не опубликован.', icon: Globe2, connected: Boolean(site?.deployedAt), href: null },
  ] as const;
  const requestIntegration = async (id: keyof AppDashboardSettings['integrations']): Promise<void> => {
    setSaving(id);
    try {
      const nextValue = dashboardSettings.integrations[id] === 'pending' ? 'disabled' : 'pending';
      const next = await projectRepository.updateAppDashboardSettings(project.id, { integrations: { [id]: nextValue } });
      onDashboardSettingsUpdated(next);
      toast.success(nextValue === 'pending' ? 'Запрос на подключение сохранён' : 'Запрос отменён');
    } catch { toast.error('Не удалось изменить интеграцию'); }
    finally { setSaving(null); }
  };
  const external = [
    { id: 'email' as const, name: 'Email', description: 'Транзакционные письма и уведомления приложения.' },
    { id: 'webhooks' as const, name: 'Webhooks', description: 'Исходящие события для внешних систем.' },
    { id: 'oauth' as const, name: 'OAuth', description: 'Вход через внешних провайдеров.' },
  ];
  return <div className="space-y-5"><SectionHeader title="Интеграции" description="Подключённые ресурсы показаны сразу; внешние сервисы можно отправить на настройку без ложного статуса «готово»." /><div className="grid gap-3 sm:grid-cols-2">{integrations.map((integration) => { const Icon = integration.icon; const content = <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-lg bg-muted"><Icon className="size-5" /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="font-medium">{integration.name}</span><StatusPill tone={integration.connected ? 'ok' : 'muted'}>{integration.connected ? 'Подключено' : 'Не настроено'}</StatusPill></span><span className="mt-1 block break-all text-sm leading-6 text-muted-foreground">{integration.description}</span></span></div>; return integration.href ? <a key={integration.id} href={integration.href} target="_blank" rel="noopener noreferrer" className="rounded-xl border p-4 transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</a> : <section key={integration.id} className="rounded-xl border p-4">{content}{integration.id === 'site' && integration.connected && <Button className="mt-3" size="sm" variant="outline" onClick={onOpenPreview}>Открыть Preview</Button>}</section>; })}</div><section className="overflow-hidden rounded-xl border"><div className="border-b bg-muted/15 px-4 py-3"><p className="text-sm font-semibold">Внешние подключения</p><p className="mt-1 text-xs text-muted-foreground">Статус «Ожидает настройки» означает сохранённый запрос, а не завершённое подключение.</p></div><div className="divide-y">{external.map((item) => { const pending = dashboardSettings.integrations[item.id] === 'pending'; return <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-4"><Plug className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{item.description}</span></span><StatusPill tone={pending ? 'warn' : 'muted'}>{pending ? 'Ожидает настройки' : 'Выключено'}</StatusPill><Button size="sm" variant="outline" disabled={!canEdit || saving !== null} onClick={() => void requestIntegration(item.id)}>{saving === item.id && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}{pending ? 'Отменить' : 'Запросить'}</Button></div>; })}</div></section></div>;
}

export function SecuritySection({ dashboard, site, project }: DashboardContentProps): React.ReactElement {
  const [scanned, setScanned] = useState(false);
  const url = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const checks = [
    { label: 'Для результата настроен HTTPS-адрес', ok: Boolean(url?.startsWith('https://')) },
    { label: 'Бэкенд базы данных подготовлен', ok: dashboard.status === 'active' },
    { label: 'Ссылка на репозиторий указана', ok: Boolean(project.gitRepoUrl) },
    { label: 'Есть отметка времени публикации', ok: Boolean(site?.deployedAt) },
  ];
  const issues = checks.filter((check) => !check.ok).length;
  return <div className="space-y-5"><SectionHeader title="Безопасность" description="Проверка подтверждаемых настроек проекта без выдуманных результатов сканирования." action={<Button size="sm" onClick={() => setScanned(true)}><ShieldCheck className="mr-1.5 size-4" />Проверить</Button>} />{scanned && <div role="status" className={cn('rounded-xl border p-4', issues ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}><p className="font-medium">{issues ? `Найдено замечаний: ${issues}` : 'Доступные проверки пройдены'}</p><p className="mt-1 text-sm text-muted-foreground">Статус рассчитан по текущему HTTPS-адресу, публикации, репозиторию и App Database.</p></div>}<section className="overflow-hidden rounded-xl border"><div className="border-b px-4 py-3 text-sm font-semibold">Контрольный список</div><div className="divide-y">{checks.map((check) => <div key={check.label} className="flex items-center gap-3 px-4 py-3 text-sm">{check.ok ? <CheckCircle2 className="size-4 text-emerald-500" /> : <AlertTriangle className="size-4 text-amber-500" />}<span className="flex-1">{check.label}</span><StatusPill tone={check.ok ? 'ok' : 'warn'}>{check.ok ? 'Готово' : 'Проверьте'}</StatusPill></div>)}</div></section></div>;
}

type CodeNode = { readonly id: string; readonly name: string; readonly content: string };
export function CodeSection({ project, dashboard, site }: DashboardContentProps): React.ReactElement {
  const nodes = useMemo<readonly CodeNode[]>(() => {
    const routeNodes = (site?.routes ?? []).map((route) => ({ id: `route:${route}`, name: route === '/' ? 'pages/Home' : `pages${route}`, content: [`Route: ${route}`, `Project: ${project.name}`, `Published: ${site?.deployedAt ?? 'not published'}`].join('\n') }));
    const tableNodes = (dashboard.schema?.tables ?? []).map((table) => ({ id: `table:${table.name}`, name: `database/${table.name}.schema`, content: JSON.stringify(table, null, 2) }));
    return [...routeNodes, ...tableNodes];
  }, [dashboard.schema?.tables, project.name, site?.deployedAt, site?.routes]);
  const [selectedId, setSelectedId] = useState<string | null>(nodes[0]?.id ?? null);
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  return <div className="space-y-5"><SectionHeader title="Код" description="Безопасный обзор доступных маршрутов и схем. Закрытый исходный код и секреты здесь не отображаются." /><div className="grid min-h-[500px] overflow-hidden rounded-xl border md:grid-cols-[230px_1fr]"><aside className="border-b bg-muted/10 p-2 md:border-b-0 md:border-r" aria-label="Дерево проекта"><p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Метаданные</p>{nodes.length ? nodes.map((node) => <button key={node.id} type="button" onClick={() => setSelectedId(node.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm', selected?.id === node.id ? 'bg-muted font-medium' : 'hover:bg-muted/50')}><FileCode2 className="size-3.5" /><span className="truncate">{node.name}</span></button>) : <p className="px-2 py-3 text-xs text-muted-foreground">Маршруты и схемы ещё не опубликованы.</p>}</aside><div className="min-w-0 bg-zinc-950 text-zinc-100"><div className="flex h-11 items-center border-b border-white/10 px-4 text-xs text-zinc-400">{selected?.name ?? 'Нет файла'}</div><pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-6"><code>{selected?.content ?? 'Нет доступных метаданных.'}</code></pre></div></div></div>;
}

export function AgentsSection({ project, onProjectUpdated }: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [candidates, setCandidates] = useState<readonly DispatcherCandidate[]>([]);
  const [selected, setSelected] = useState(project.dispatcherUserId ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectRepository.listDispatcherCandidates(project.id)
      .then((items) => { if (!cancelled) setCandidates(items); })
      .catch(() => { if (!cancelled) toast.error('Не удалось загрузить агентов'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, projectRepository]);
  const saveDispatcher = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await projectRepository.setDispatcher(project.id, selected || null);
      onProjectUpdated(updated);
      toast.success(selected ? 'Диспетчер назначен' : 'Автономный диспетчер отключён');
    } catch { toast.error('Не удалось изменить диспетчера'); }
    finally { setSaving(false); }
  };
  const toggleParallel = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await projectRepository.setMultiTaskWorker(project.id, !project.multiTaskWorker);
      onProjectUpdated(updated);
      toast.success(updated.multiTaskWorker ? 'Параллельная работа включена' : 'Параллельная работа выключена');
    } catch { toast.error('Не удалось изменить режим воркера'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-5"><SectionHeader title="Агенты" description="Реальный ProjectsFlow-диспетчер, который получает задачи проекта через изолированный agent token." /><div className="grid gap-4 lg:grid-cols-[1fr_300px]"><section className="space-y-4 rounded-xl border p-4"><label className="block space-y-1.5"><span className="text-sm font-medium">Диспетчер проекта</span><select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={loading || saving || project.role !== 'owner'} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">Работа вручную</option>{candidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.displayName} · {candidate.activeTokenCount} токен(а){candidate.isAdmin ? ' · admin' : ''}</option>)}</select></label>{loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Проверяем активные agent tokens…</p>} {!loading && candidates.length === 0 && <p className="text-xs leading-5 text-muted-foreground">Нет участников с активным agent token. Подключите диспетчер в настройках аккаунта.</p>}<Button disabled={saving || loading || project.role !== 'owner' || selected === (project.dispatcherUserId ?? '')} onClick={() => void saveDispatcher()}>{saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}Сохранить диспетчера</Button></section><aside className="rounded-xl border bg-muted/10 p-4"><div className="flex items-center gap-2"><Bot className="size-4 text-primary" /><h3 className="text-sm font-semibold">Режим выполнения</h3></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{project.dispatcherUserId ? 'Диспетчер назначен и может получать задачи проекта.' : 'Задачи выполняются вручную, пока диспетчер не назначен.'}</p><button type="button" role="switch" aria-checked={project.multiTaskWorker} disabled={saving || !project.dispatcherUserId} onClick={() => void toggleParallel()} className={cn('mt-4 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm', !project.dispatcherUserId && 'cursor-not-allowed opacity-50')}><span>До трёх задач параллельно</span><span className={cn('h-5 w-9 rounded-full p-0.5 transition-colors', project.multiTaskWorker ? 'bg-primary' : 'bg-muted-foreground/25')}><span className={cn('block size-4 rounded-full bg-white shadow transition-transform', project.multiTaskWorker && 'translate-x-4')} /></span></button></aside></div></div>;
}

export function WorkflowsSection({ project, canEdit, onOpenAutomation }: DashboardContentProps): React.ReactElement {
  const states = [
    { label: 'Автономный диспетчер', value: project.dispatcherUserId ? 'Назначен' : 'Не назначен', ok: Boolean(project.dispatcherUserId) },
    { label: 'Параллельная обработка', value: project.multiTaskWorker ? 'До 3 задач' : 'По одной задаче', ok: project.multiTaskWorker },
    { label: 'Репозиторий результата', value: project.gitRepoUrl ? 'Подключён' : 'Не подключён', ok: Boolean(project.gitRepoUrl) },
  ];
  return <div className="space-y-5"><SectionHeader title="Автоматизации" description="Единое окно существующего планировщика ProjectsFlow: лимиты, публикация, сводки и проверка коммитов." action={<Button size="sm" onClick={onOpenAutomation} disabled={!canEdit}><Workflow className="mr-1.5 size-4" />Открыть настройки</Button>} /><section className="overflow-hidden rounded-xl border"><div className="border-b bg-muted/15 px-4 py-3"><p className="text-sm font-semibold">Готовность проекта</p><p className="mt-1 text-xs text-muted-foreground">Перед запуском планировщик проверит эти реальные настройки.</p></div><div className="divide-y">{states.map((state) => <div key={state.label} className="flex items-center gap-3 px-4 py-4"><span className={cn('size-2 rounded-full', state.ok ? 'bg-emerald-500' : 'bg-amber-500')} /><span className="min-w-0 flex-1 text-sm font-medium">{state.label}</span><span className="text-sm text-muted-foreground">{state.value}</span></div>)}</div></section></div>;
}

export function ApiSection({ project, dashboard, site }: DashboardContentProps): React.ReactElement {
  const [tab, setTab] = useState<'docs' | 'openapi'>('docs');
  const tableNames = dashboard.schema?.tables.map((table) => table.name) ?? [];
  const runtimeUrl = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const openApi = buildProjectOpenApi(project.id, tableNames, runtimeUrl ?? undefined);
  const copy = async (value: string): Promise<void> => { await navigator.clipboard.writeText(value); toast.success('Скопировано'); };
  return <div className="space-y-5"><SectionHeader title="API" description="Документация создаётся из опубликованной схемы приложения. Ключи и приватные значения не показываются." /><div className="inline-flex rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label="API документация"><button type="button" role="tab" aria-selected={tab === 'docs'} onClick={() => setTab('docs')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'docs' && 'bg-background shadow-sm')}>Endpoints</button><button type="button" role="tab" aria-selected={tab === 'openapi'} onClick={() => setTab('openapi')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'openapi' && 'bg-background shadow-sm')}>OpenAPI</button></div>{tab === 'docs' ? <div className="space-y-3">{tableNames.length ? tableNames.map((table) => <section key={table} className="overflow-hidden rounded-xl border"><div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2"><span className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">GET</span><code className="min-w-0 flex-1 truncate text-xs">/api/data/{table}</code><Button variant="ghost" size="icon" className="size-8" onClick={() => void copy(`${runtimeUrl ?? ''}/api/data/${table}`)} aria-label={`Скопировать endpoint ${table}`} disabled={!runtimeUrl}><Copy className="size-3.5" /></Button></div><div className="px-3 py-3 text-sm text-muted-foreground">Получение и фильтрация записей таблицы <strong className="text-foreground">{table}</strong>{runtimeUrl ? ` на ${siteResultDisplayUrl(site!.siteSlug!)}` : '. Полный адрес появится после публикации результата'}.</div></section>) : <NotConnected title="API пока пуст" description="В приложении нет опубликованных таблиц, поэтому endpoints не генерируются." />}</div> : <div className="overflow-hidden rounded-xl border bg-zinc-950"><div className="flex h-11 items-center justify-between border-b border-white/10 px-3 text-xs text-zinc-400"><span>openapi.json</span><Button variant="ghost" size="sm" className="text-zinc-200 hover:bg-white/10 hover:text-white" onClick={() => void copy(openApi)}><Copy className="mr-1.5 size-3.5" />Копировать</Button></div><pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-6 text-zinc-100"><code>{openApi}</code></pre></div>}<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm"><p className="font-medium">Аутентификация</p><p className="mt-1 text-muted-foreground">Runtime API использует сессию опубликованного приложения и правила доступа таблицы; приватные ключи здесь не показываются.</p></div></div>;
}

export function SettingsSection({ project, site, dashboard, canEdit, dashboardSettings, onProjectUpdated, onDashboardSettingsUpdated }: DashboardContentProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [tab, setTab] = useState<'app' | 'access' | 'auth'>('app');
  const [description, setDescription] = useState(dashboardSettings.profile.description || project.description || '');
  const [mainRoute, setMainRoute] = useState(dashboardSettings.profile.mainRoute);
  const [visibility, setVisibility] = useState(dashboardSettings.updatedAt ? dashboardSettings.profile.visibility : project.isPublic ? 'public' : 'private');
  const [saving, setSaving] = useState(false);
  const saveProfile = async (): Promise<void> => {
    setSaving(true);
    try {
      let updated = project;
      if (project.description !== (description.trim() || null)) {
        updated = await projectRepository.update(project.id, { description: description.trim() || null });
      }
      if (project.role === 'owner' && visibility === 'public' && !updated.isPublic) {
        const published = await projectRepository.publish(project.id);
        updated = { ...updated, isPublic: true, publicSlug: published.slug };
      } else if (project.role === 'owner' && visibility === 'private' && updated.isPublic) {
        await projectRepository.unpublish(project.id);
        updated = { ...updated, isPublic: false, publicIndexing: false };
      }
      const next = await projectRepository.updateAppDashboardSettings(project.id, {
        profile: { description: description.trim(), mainRoute, visibility },
      });
      onDashboardSettingsUpdated(next);
      onProjectUpdated(updated);
      toast.success('Профиль и видимость приложения сохранены');
    } catch { toast.error('Не удалось сохранить настройки приложения'); }
    finally { setSaving(false); }
  };
  const togglePublish = async (): Promise<void> => {
    setSaving(true);
    try {
      if (project.isPublic) {
        await projectRepository.unpublish(project.id);
        const next = await projectRepository.updateAppDashboardSettings(project.id, { profile: { visibility: 'private' } });
        onDashboardSettingsUpdated(next);
        setVisibility('private');
        onProjectUpdated({ ...project, isPublic: false, publicIndexing: false });
        toast.success('Публичная страница скрыта');
      } else {
        const published = await projectRepository.publish(project.id);
        const next = await projectRepository.updateAppDashboardSettings(project.id, { profile: { visibility: 'public' } });
        onDashboardSettingsUpdated(next);
        setVisibility('public');
        onProjectUpdated({ ...project, isPublic: true, publicSlug: published.slug });
        toast.success('Публичная страница опубликована');
      }
    } catch { toast.error('Не удалось изменить публикацию'); }
    finally { setSaving(false); }
  };
  const toggleIndexing = async (): Promise<void> => {
    setSaving(true);
    try {
      await projectRepository.setPublicIndexing(project.id, !project.publicIndexing);
      onProjectUpdated({ ...project, publicIndexing: !project.publicIndexing });
      toast.success(project.publicIndexing ? 'Индексация отключена' : 'Индексация включена');
    } catch { toast.error('Не удалось изменить индексацию'); }
    finally { setSaving(false); }
  };
  const updateAuth = async (patch: Partial<AppDashboardSettings['auth']>): Promise<void> => {
    setSaving(true);
    try {
      const next = await projectRepository.updateAppDashboardSettings(project.id, { auth: patch });
      onDashboardSettingsUpdated(next);
      toast.success('Настройки входа сохранены');
    } catch { toast.error('Не удалось сохранить настройки входа'); }
    finally { setSaving(false); }
  };
  const routes = site?.routes.length ? site.routes : ['/'];
  return <div className="space-y-5"><SectionHeader title="Настройки" description="Профиль приложения, публикация и запросы на внешние способы входа." /><div className="inline-flex rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label="Настройки"><button type="button" role="tab" aria-selected={tab === 'app'} onClick={() => setTab('app')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'app' && 'bg-background shadow-sm')}>Приложение</button><button type="button" role="tab" aria-selected={tab === 'access'} onClick={() => setTab('access')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'access' && 'bg-background shadow-sm')}>Доступ</button><button type="button" role="tab" aria-selected={tab === 'auth'} onClick={() => setTab('auth')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'auth' && 'bg-background shadow-sm')}>Вход</button></div>{tab === 'app' && <div className="space-y-4"><section className="max-w-3xl space-y-4 rounded-xl border p-4"><label className="block space-y-1.5"><span className="text-sm font-medium">Описание приложения</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canEdit || saving} rows={4} className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" /></label><label className="block space-y-1.5"><span className="text-sm font-medium">Начальная страница Preview</span><select value={mainRoute} onChange={(event) => setMainRoute(event.target.value)} disabled={!canEdit || saving} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">{routes.map((route) => <option key={route} value={route}>{route}</option>)}</select></label><label className="block space-y-1.5"><span className="text-sm font-medium">Видимость страницы проекта</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'private')} disabled={project.role !== 'owner' || saving} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="private">Только участники проекта</option><option value="public">Публичная страница</option></select><span className="text-xs text-muted-foreground">Сохраняется вместе с профилем и реально публикует либо скрывает общую страницу проекта.</span></label><Button disabled={!canEdit || saving || !mainRoute.startsWith('/')} onClick={() => void saveProfile()}>{saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}Сохранить профиль</Button></section><section className="max-w-3xl rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Публичная страница проекта</p><p className="mt-1 text-xs text-muted-foreground">{project.isPublic ? `Опубликована${project.publicSlug ? ` · /p/${project.publicSlug}` : ''}` : 'Доступна только участникам проекта'}</p></div><Button variant={project.isPublic ? 'outline' : 'default'} size="sm" disabled={saving || project.role !== 'owner'} onClick={() => void togglePublish()}>{project.isPublic ? 'Скрыть' : 'Опубликовать'}</Button></div>{project.isPublic && <button type="button" role="switch" aria-checked={project.publicIndexing} disabled={saving || project.role !== 'owner'} onClick={() => void toggleIndexing()} className="mt-4 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm"><span><span className="block font-medium">Индексация поисковиками</span><span className="mt-0.5 block text-xs text-muted-foreground">Управляет реальным publicIndexing проекта.</span></span><span className={cn('h-5 w-9 rounded-full p-0.5 transition-colors', project.publicIndexing ? 'bg-primary' : 'bg-muted-foreground/25')}><span className={cn('block size-4 rounded-full bg-white shadow transition-transform', project.publicIndexing && 'translate-x-4')} /></span></button>}</section></div>}{tab === 'access' && <section className="max-w-3xl overflow-hidden rounded-xl border"><div className="divide-y"><div className="flex items-center justify-between gap-4 px-4 py-4"><span><span className="block text-sm font-medium">Участники ProjectsFlow</span><span className="mt-1 block text-xs text-muted-foreground">Доступ к Dashboard проверяется сервером по роли проекта.</span></span><StatusPill tone="ok">Включено</StatusPill></div><div className="flex items-center justify-between gap-4 px-4 py-4"><span><span className="block text-sm font-medium">Runtime-сессии приложения</span><span className="mt-1 block text-xs text-muted-foreground">{dashboard.status === 'active' ? 'App Database активна; правила CRUD применяются к каждой таблице.' : 'Статический результат не использует runtime-базу и пользовательские сессии.'}</span></span><StatusPill tone={dashboard.status === 'active' ? 'ok' : 'muted'}>{dashboard.status === 'active' ? 'Активно' : 'Не требуется'}</StatusPill></div><div className="flex items-center justify-between gap-4 px-4 py-4"><span><span className="block text-sm font-medium">GitHub-доступ воркера</span><span className="mt-1 block text-xs text-muted-foreground">Токен выдаётся через project-scoped delegation и не показывается в Dashboard.</span></span><StatusPill tone={project.gitRepoUrl ? 'ok' : 'warn'}>{project.gitRepoUrl ? 'Репо подключён' : 'Нет репо'}</StatusPill></div></div></section>}{tab === 'auth' && <section className="max-w-3xl overflow-hidden rounded-xl border"><div className="border-b bg-muted/15 px-4 py-3"><p className="text-sm font-semibold">Способы входа</p><p className="mt-1 text-xs text-muted-foreground">Email сохраняется сразу. Google и Microsoft требуют внешние ключи и поэтому получают честный статус ожидания.</p></div><div className="divide-y"><AuthRow name="Email и пароль" state={dashboardSettings.auth.emailPassword ? 'enabled' : 'disabled'} disabled={!canEdit || saving} onClick={() => void updateAuth({ emailPassword: !dashboardSettings.auth.emailPassword })} /><AuthRow name="Google" state={dashboardSettings.auth.google} disabled={!canEdit || saving} onClick={() => void updateAuth({ google: dashboardSettings.auth.google === 'pending' ? 'disabled' : 'pending' })} /><AuthRow name="Microsoft" state={dashboardSettings.auth.microsoft} disabled={!canEdit || saving} onClick={() => void updateAuth({ microsoft: dashboardSettings.auth.microsoft === 'pending' ? 'disabled' : 'pending' })} /></div></section>}</div>;
}

function AuthRow({ name, state, disabled, onClick }: { name: string; state: 'enabled' | 'disabled' | 'pending'; disabled: boolean; onClick: () => void }): React.ReactElement {
  const active = state !== 'disabled';
  return <div className="flex items-center gap-3 px-4 py-4"><span className="min-w-0 flex-1 text-sm font-medium">{name}</span><StatusPill tone={state === 'enabled' ? 'ok' : state === 'pending' ? 'warn' : 'muted'}>{state === 'enabled' ? 'Включено' : state === 'pending' ? 'Ожидает настройки' : 'Выключено'}</StatusPill><button type="button" role="switch" aria-checked={active} disabled={disabled} onClick={onClick} className={cn('h-6 w-11 rounded-full p-0.5 transition-colors disabled:opacity-50', active ? 'bg-primary' : 'bg-muted-foreground/25')}><span className={cn('block size-5 rounded-full bg-white shadow transition-transform', active && 'translate-x-5')} /></button></div>;
}
