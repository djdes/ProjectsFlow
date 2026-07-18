import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  Github,
  Globe2,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { siteResultDisplayUrl, siteResultUrl } from '@/lib/publicBoardUrl';
import { cn } from '@/lib/utils';
import type { Project } from '@/domain/project/Project';
import type { ProjectMember, ProjectRole } from '@/domain/project/ProjectMembership';
import type {
  AppBackendDashboard,
  ProjectSite,
} from '@/application/project/ProjectRepository';
import {
  buildProjectOpenApi,
  formatDashboardBytes,
  normalizeCustomDomain,
  type DashboardActionHandlers,
} from './dashboardConfig';

export type DashboardContentProps = {
  readonly project: Project;
  readonly dashboard: AppBackendDashboard;
  readonly site: ProjectSite | null;
  readonly members: readonly ProjectMember[];
  readonly canEdit: boolean;
  readonly onOpenPreview: () => void;
  readonly onRefresh: () => void;
  readonly actions?: Partial<DashboardActionHandlers>;
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

function UnavailableAction({ configured, children }: { configured: boolean; children: React.ReactNode }): React.ReactElement {
  return <span title={configured ? undefined : 'Для этого действия требуется серверное подключение'}>{children}</span>;
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
  const [tab, setTab] = useState<'users' | 'pending'>('users');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<ProjectRole | ''>('');
  const filtered = useMemo(() => members.filter((member) => (!role || member.role === role) && (!search.trim() || `${member.user.displayName} ${member.user.email}`.toLowerCase().includes(search.trim().toLowerCase()))), [members, role, search]);
  return <div className="space-y-4"><SectionHeader title="Пользователи" description="Участники проекта, их роли и ожидающие запросы." action={<Button size="sm" className="gap-1.5" onClick={() => window.dispatchEvent(new CustomEvent('pf:open-project-share', { detail: { projectId: project.id } }))}><UserPlus className="size-3.5" />Пригласить</Button>} /><div className="overflow-hidden rounded-xl border"><div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2"><div role="tablist" aria-label="Пользователи"><button type="button" role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'users' ? 'bg-muted font-medium' : 'text-muted-foreground')}>Участники ({members.length})</button><button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'pending' ? 'bg-muted font-medium' : 'text-muted-foreground')}>Ожидают</button></div>{tab === 'users' && <><label className="ml-auto flex h-9 min-w-[220px] items-center gap-2 rounded-md border px-2.5"><Search className="size-3.5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Имя или email…" aria-label="Поиск участников" /></label><select aria-label="Фильтр роли" value={role} onChange={(event) => setRole(event.target.value as ProjectRole | '')} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">Все роли</option><option value="owner">Владелец</option><option value="editor">Редактор</option><option value="viewer">Наблюдатель</option></select></>}</div>{tab === 'pending' ? <div className="grid min-h-64 place-items-center px-5 text-center"><div><Mail className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Запросы пока недоступны</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Этот раздел ещё не подключён к приглашениям пространства. Здесь не показывается фиктивное пустое состояние.</p></div></div> : <div className="divide-y">{filtered.length === 0 ? <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">Участники не найдены.</div> : filtered.map((member) => <div key={member.userId} className="grid min-h-16 grid-cols-[40px_minmax(130px,1fr)_minmax(130px,1fr)_110px] items-center gap-3 px-3 text-sm max-sm:grid-cols-[40px_1fr_auto]"><span className="grid size-8 place-items-center overflow-hidden rounded-full bg-muted font-medium">{member.user.avatarUrl ? <img src={member.user.avatarUrl} alt="" className="size-full object-cover" /> : member.user.displayName.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-medium">{member.user.displayName}</p>{member.userId === project.ownerId && <p className="text-xs text-muted-foreground">Создатель проекта</p>}</div><span className="truncate text-muted-foreground max-sm:hidden">{member.user.email}</span><span className="w-fit rounded-full bg-muted/60 px-2 py-1 text-xs">{member.role === 'owner' ? 'Владелец' : member.role === 'editor' ? 'Редактор' : 'Наблюдатель'}</span></div>)}</div>}</div></div>;
}

export function AnalyticsSection({ dashboard, site, members }: DashboardContentProps): React.ReactElement {
  const tableCount = dashboard.schema?.tables.length ?? 0;
  const routes = site?.routes.length ?? 0;
  const max = Math.max(1, tableCount, routes, members.length);
  const metrics = [{ label: 'Маршруты', value: routes }, { label: 'Таблицы', value: tableCount }, { label: 'Участники', value: members.length }, { label: 'Файлы', value: site?.fileCount ?? 0 }];
  return <div className="space-y-5"><SectionHeader title="Аналитика" description="Технические метрики опубликованного приложения. Аналитика посетителей появится после подключения сборщика событий." /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => <section key={metric.label} className="rounded-xl border p-4"><p className="text-xs font-medium text-muted-foreground">{metric.label}</p><p className="mt-3 text-2xl font-semibold">{metric.value}</p></section>)}</div><section className="rounded-xl border p-4"><div className="flex items-center gap-2"><BarChart3 className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Структура приложения</h3></div><div className="mt-5 space-y-3">{metrics.slice(0, 3).map((metric) => <div key={metric.label} className="grid grid-cols-[100px_1fr_40px] items-center gap-3 text-sm"><span className="text-muted-foreground">{metric.label}</span><span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary motion-safe:transition-[width]" style={{ width: `${Math.max(metric.value ? 6 : 0, metric.value / max * 100)}%` }} /></span><span className="text-right tabular-nums">{metric.value}</span></div>)}</div></section><NotConnected title="Посетители и конверсии не подключены" description="Dashboard не придумывает статистику. Подключите безопасный сбор событий приложения, чтобы здесь появились live visitors, просмотры страниц и воронки." /></div>;
}

export function MarketingSection({ project, canEdit, actions }: DashboardContentProps): React.ReactElement {
  const [tab, setTab] = useState<'overview' | 'meta' | 'advanced'>('overview');
  const [title, setTitle] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [robotsIndex, setRobotsIndex] = useState(true);
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => { if (!actions?.saveSeo) return; setSaving(true); try { await actions.saveSeo({ title, description, robotsIndex }); toast.success('SEO-настройки сохранены'); } catch { toast.error('Не удалось сохранить SEO-настройки'); } finally { setSaving(false); } };
  return <div className="space-y-5"><SectionHeader title="SEO и маркетинг" description="Как приложение выглядит в поиске и при публикации ссылок." action={<UnavailableAction configured={Boolean(actions?.saveSeo)}><Button size="sm" disabled={!canEdit || !actions?.saveSeo || saving} onClick={() => void save()}>Сохранить</Button></UnavailableAction>} /><div className="inline-flex rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label="SEO"><button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'overview' && 'bg-background shadow-sm')}>Обзор</button><button type="button" role="tab" aria-selected={tab === 'meta'} onClick={() => setTab('meta')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'meta' && 'bg-background shadow-sm')}>Meta tags</button><button type="button" role="tab" aria-selected={tab === 'advanced'} onClick={() => setTab('advanced')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'advanced' && 'bg-background shadow-sm')}>Расширенные</button></div>{tab === 'overview' && <div className="grid gap-3 lg:grid-cols-2"><section className="rounded-xl border p-4"><Sparkles className="size-5 text-primary" /><h3 className="mt-4 font-medium">Поисковое представление</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Заполните заголовок и описание. После серверного подключения они будут применяться к опубликованному артефакту.</p></section><section className="rounded-xl border bg-muted/15 p-4"><p className="truncate text-lg text-blue-700 dark:text-blue-300">{title || project.name}</p><p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">projectsflow.ru › project</p><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{description || 'Описание пока не задано.'}</p></section></div>}{tab === 'meta' && <div className="max-w-2xl space-y-4 rounded-xl border p-4"><label className="block space-y-1.5"><span className="text-sm font-medium">Title</span><input value={title} maxLength={70} onChange={(event) => setTitle(event.target.value)} disabled={!canEdit} className="h-10 w-full rounded-lg border bg-background px-3 text-sm" /><span className="text-xs text-muted-foreground">{title.length}/70</span></label><label className="block space-y-1.5"><span className="text-sm font-medium">Description</span><textarea value={description} maxLength={180} onChange={(event) => setDescription(event.target.value)} disabled={!canEdit} rows={4} className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" /><span className="text-xs text-muted-foreground">{description.length}/180</span></label></div>}{tab === 'advanced' && <div className="max-w-2xl space-y-4 rounded-xl border p-4"><label className="flex items-start justify-between gap-4"><span><span className="block text-sm font-medium">Разрешить индексацию</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Подготовить robots и sitemap для поисковых систем.</span></span><input type="checkbox" checked={robotsIndex} onChange={(event) => setRobotsIndex(event.target.checked)} disabled={!canEdit} className="mt-1 size-4" /></label><NotConnected title="SEO-инъекция ещё не подключена" description="Форма готова, но изменения не выдаются за сохранённые без серверного обработчика публикации." /></div>}</div>;
}

export function DomainsSection({ site, canEdit, actions }: DashboardContentProps): React.ReactElement {
  const [domain, setDomain] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const builtIn = site?.siteSlug ? siteResultDisplayUrl(site.siteSlug) : null;
  const submit = (): void => { const normalized = normalizeCustomDomain(domain); if (!normalized) { setValidation('Введите домен вида app.example.com'); return; } setDomain(normalized); setValidation(null); setConfirmOpen(true); };
  const connect = async (): Promise<void> => { if (!actions?.connectDomain) return; try { await actions.connectDomain(domain); toast.success('Домен отправлен на проверку'); setConfirmOpen(false); } catch { toast.error('Не удалось подключить домен'); } };
  return <div className="space-y-5"><SectionHeader title="Домены" description="Встроенный адрес результата и подключение собственного домена." /><section className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Встроенный URL</p><p className="mt-1 text-sm text-muted-foreground">{builtIn ?? 'Появится после подготовки результата'}</p></div>{builtIn && <Button asChild size="sm" variant="outline"><a href={siteResultUrl(site!.siteSlug!)} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 size-3.5" />Открыть</a></Button>}</div></section><section className="rounded-xl border p-4"><div className="flex items-center gap-2"><Globe2 className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Собственный домен</h3></div><p className="mt-1 text-sm text-muted-foreground">После подключения потребуется добавить DNS-запись. ProjectsFlow проверит владение перед выдачей сертификата.</p><div className="mt-4 flex max-w-xl gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Собственный домен</span><input value={domain} onChange={(event) => { setDomain(event.target.value); setValidation(null); }} placeholder="app.example.com" disabled={!canEdit} className="h-10 w-full rounded-lg border bg-background px-3 text-sm" /></label><Button onClick={submit} disabled={!canEdit}>Подключить</Button></div>{validation && <p role="alert" className="mt-2 text-xs text-destructive">{validation}</p>}<NotConnected title="Проверка DNS не настроена" description="Интерфейс не показывает ложный статус подключения: требуется серверный обработчик доменов и выпуск TLS-сертификата." /></section><Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent><DialogHeader><DialogTitle>Подключить {domain}?</DialogTitle><DialogDescription>Будет создан запрос на проверку домена. До успешной DNS-проверки опубликованный сайт останется на встроенном адресе.</DialogDescription></DialogHeader><div className="rounded-lg bg-muted/45 p-3 font-mono text-xs">CNAME {domain} → projectsflow.ru</div><DialogFooter><Button variant="outline" onClick={() => setConfirmOpen(false)}>Отмена</Button><UnavailableAction configured={Boolean(actions?.connectDomain)}><Button disabled={!actions?.connectDomain} onClick={() => void connect()}>Создать проверку</Button></UnavailableAction></DialogFooter></DialogContent></Dialog></div>;
}

const INTEGRATIONS = [
  { id: 'github', name: 'GitHub', description: 'Код, коммиты и публикация проекта.', icon: Github },
  { id: 'email', name: 'Email', description: 'Транзакционные письма приложения.', icon: Mail },
  { id: 'webhook', name: 'Webhooks', description: 'События во внешние системы.', icon: Link2 },
  { id: 'oauth', name: 'OAuth', description: 'Вход пользователей через провайдера.', icon: KeyRound },
] as const;

export function IntegrationsSection({ project, canEdit, actions }: DashboardContentProps): React.ReactElement {
  const [selected, setSelected] = useState<(typeof INTEGRATIONS)[number] | null>(null);
  return <div className="space-y-5"><SectionHeader title="Интеграции" description="Подключения приложения к коду, почте, событиям и авторизации." /><div className="grid gap-3 sm:grid-cols-2">{INTEGRATIONS.map((integration) => { const connected = integration.id === 'github' && Boolean(project.gitRepoUrl); const Icon = integration.icon; return <button key={integration.id} type="button" onClick={() => setSelected(integration)} className="rounded-xl border p-4 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-lg bg-muted"><Icon className="size-5" /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="font-medium">{integration.name}</span><StatusPill tone={connected ? 'ok' : 'muted'}>{connected ? 'Подключено' : 'Не настроено'}</StatusPill></span><span className="mt-1 block text-sm leading-6 text-muted-foreground">{integration.description}</span></span></div></button>; })}</div><Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{selected?.description} Подключение будет доступно участникам приложения только после серверной настройки.</DialogDescription></DialogHeader>{selected?.id === 'github' && project.gitRepoUrl ? <div className="rounded-lg border p-3 text-sm"><p className="font-medium">Текущий репозиторий</p><p className="mt-1 break-all text-muted-foreground">{project.gitRepoUrl}</p></div> : <NotConnected title="Подключение отсутствует" description="Никакие ключи не сохраняются в браузере. Для подключения нужен защищённый серверный OAuth-flow." />}<DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Закрыть</Button><UnavailableAction configured={Boolean(actions?.connectIntegration)}><Button disabled={!canEdit || !actions?.connectIntegration || !selected} onClick={() => { if (selected && actions?.connectIntegration) void actions.connectIntegration(selected.id); }}>Настроить</Button></UnavailableAction></DialogFooter></DialogContent></Dialog></div>;
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
  return <div className="space-y-5"><SectionHeader title="Безопасность" description="Локальная проверка известных настроек проекта. Она не заменяет аудит кода и инфраструктуры." action={<Button size="sm" onClick={() => setScanned(true)}><ShieldCheck className="mr-1.5 size-4" />Проверить</Button>} />{scanned && <div role="status" className={cn('rounded-xl border p-4', issues ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}><p className="font-medium">{issues ? `Найдено замечаний: ${issues}` : 'Доступные проверки пройдены'}</p><p className="mt-1 text-sm text-muted-foreground">Проверено только то, что Dashboard может подтвердить текущими данными.</p></div>}<section className="overflow-hidden rounded-xl border"><div className="border-b px-4 py-3 text-sm font-semibold">Контрольный список</div><div className="divide-y">{checks.map((check) => <div key={check.label} className="flex items-center gap-3 px-4 py-3 text-sm">{check.ok ? <CheckCircle2 className="size-4 text-emerald-500" /> : <AlertTriangle className="size-4 text-amber-500" />}<span className="flex-1">{check.label}</span><StatusPill tone={check.ok ? 'ok' : 'warn'}>{check.ok ? 'Готово' : 'Проверьте'}</StatusPill></div>)}</div></section><NotConnected title="Глубокий security scan не запускался" description="Для анализа зависимостей, секретов и политик CSP требуется отдельный серверный job с журналом результатов." /></div>;
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

export function AgentsSection({ canEdit, actions }: DashboardContentProps): React.ReactElement {
  const [name, setName] = useState(''); const [instructions, setInstructions] = useState(''); const [tools, setTools] = useState<string[]>([]);
  const toggleTool = (tool: string): void => setTools((current) => current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool]);
  const save = async (): Promise<void> => { if (!actions?.saveAgent) return; await actions.saveAgent({ name, instructions, tools }); toast.success('Агент сохранён'); };
  return <div className="space-y-5"><SectionHeader title="Агенты" description="Настройте помощника приложения: инструкции и разрешённые инструменты." /><div className="grid gap-4 lg:grid-cols-[1fr_280px]"><section className="space-y-4 rounded-xl border p-4"><label className="block space-y-1.5"><span className="text-sm font-medium">Название</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} placeholder="Консультант проекта" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" /></label><label className="block space-y-1.5"><span className="text-sm font-medium">Инструкции</span><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} disabled={!canEdit} rows={7} placeholder="Как агент должен отвечать и чего не должен делать…" className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" /></label><div><p className="text-sm font-medium">Инструменты</p><div className="mt-2 flex flex-wrap gap-2">{['Чтение данных', 'Поиск', 'Создание задач'].map((tool) => <label key={tool} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><input type="checkbox" checked={tools.includes(tool)} onChange={() => toggleTool(tool)} disabled={!canEdit} />{tool}</label>)}</div></div><UnavailableAction configured={Boolean(actions?.saveAgent)}><Button disabled={!canEdit || !actions?.saveAgent || !name.trim() || !instructions.trim()} onClick={() => void save()}><Bot className="mr-1.5 size-4" />Создать агента</Button></UnavailableAction></section><aside className="rounded-xl border bg-muted/10 p-4"><h3 className="text-sm font-semibold">Безопасный запуск</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Агент не создаётся локально. Нужен серверный обработчик, project scope и аудит каждого вызова инструмента.</p></aside></div></div>;
}

export function WorkflowsSection({ canEdit, actions }: DashboardContentProps): React.ReactElement {
  const [name, setName] = useState(''); const [trigger, setTrigger] = useState('schedule'); const [action, setAction] = useState('notify');
  const save = async (): Promise<void> => { if (!actions?.saveWorkflow) return; await actions.saveWorkflow({ name, trigger, action }); toast.success('Автоматизация сохранена'); };
  return <div className="space-y-5"><SectionHeader title="Автоматизации" description="Триггеры и действия приложения. Новые правила не запускаются без серверного планировщика." /><section className="max-w-3xl space-y-4 rounded-xl border p-4"><label className="block space-y-1.5"><span className="text-sm font-medium">Название</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} className="h-10 w-full rounded-lg border bg-background px-3 text-sm" placeholder="Ежедневная проверка" /></label><div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]"><label className="space-y-1.5"><span className="text-sm font-medium">Когда</span><select value={trigger} onChange={(event) => setTrigger(event.target.value)} disabled={!canEdit} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="schedule">По расписанию</option><option value="record-created">Создана запись</option><option value="publish">Опубликован сайт</option></select></label><ChevronRight className="mt-9 hidden size-5 text-muted-foreground sm:block" /><label className="space-y-1.5"><span className="text-sm font-medium">Что сделать</span><select value={action} onChange={(event) => setAction(event.target.value)} disabled={!canEdit} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="notify">Отправить уведомление</option><option value="task">Создать задачу</option><option value="webhook">Вызвать webhook</option></select></label></div><UnavailableAction configured={Boolean(actions?.saveWorkflow)}><Button disabled={!canEdit || !actions?.saveWorkflow || !name.trim()} onClick={() => void save()}><Workflow className="mr-1.5 size-4" />Создать правило</Button></UnavailableAction></section><NotConnected title="Планировщик автоматизаций не подключён" description="Форма описывает будущий контракт, но не имитирует сохранение и выполнение в браузере." /></div>;
}

export function ApiSection({ project, dashboard, site }: DashboardContentProps): React.ReactElement {
  const [tab, setTab] = useState<'docs' | 'openapi'>('docs');
  const tableNames = dashboard.schema?.tables.map((table) => table.name) ?? [];
  const runtimeUrl = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const openApi = buildProjectOpenApi(project.id, tableNames, runtimeUrl ?? undefined);
  const copy = async (value: string): Promise<void> => { await navigator.clipboard.writeText(value); toast.success('Скопировано'); };
  return <div className="space-y-5"><SectionHeader title="API" description="Документация создаётся из опубликованной схемы приложения. Ключи и приватные значения не показываются." /><div className="inline-flex rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label="API документация"><button type="button" role="tab" aria-selected={tab === 'docs'} onClick={() => setTab('docs')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'docs' && 'bg-background shadow-sm')}>Endpoints</button><button type="button" role="tab" aria-selected={tab === 'openapi'} onClick={() => setTab('openapi')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'openapi' && 'bg-background shadow-sm')}>OpenAPI</button></div>{tab === 'docs' ? <div className="space-y-3">{tableNames.length ? tableNames.map((table) => <section key={table} className="overflow-hidden rounded-xl border"><div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2"><span className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">GET</span><code className="min-w-0 flex-1 truncate text-xs">/api/data/{table}</code><Button variant="ghost" size="icon" className="size-8" onClick={() => void copy(`${runtimeUrl ?? ''}/api/data/${table}`)} aria-label={`Скопировать endpoint ${table}`} disabled={!runtimeUrl}><Copy className="size-3.5" /></Button></div><div className="px-3 py-3 text-sm text-muted-foreground">Получение и фильтрация записей таблицы <strong className="text-foreground">{table}</strong>{runtimeUrl ? ` на ${siteResultDisplayUrl(site!.siteSlug!)}` : '. Полный адрес появится после публикации результата'}.</div></section>) : <NotConnected title="API пока пуст" description="В приложении нет опубликованных таблиц, поэтому endpoints не генерируются." />}</div> : <div className="overflow-hidden rounded-xl border bg-zinc-950"><div className="flex h-11 items-center justify-between border-b border-white/10 px-3 text-xs text-zinc-400"><span>openapi.json</span><Button variant="ghost" size="sm" className="text-zinc-200 hover:bg-white/10 hover:text-white" onClick={() => void copy(openApi)}><Copy className="mr-1.5 size-3.5" />Копировать</Button></div><pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-6 text-zinc-100"><code>{openApi}</code></pre></div>}<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm"><p className="font-medium">Аутентификация</p><p className="mt-1 text-muted-foreground">Runtime API использует сессию опубликованного приложения и правила доступа таблицы; приватные ключи здесь не показываются.</p></div></div>;
}

export function SettingsSection({ project, site, canEdit, actions }: DashboardContentProps): React.ReactElement {
  const [tab, setTab] = useState<'app' | 'auth'>('app');
  const [description, setDescription] = useState(project.description ?? '');
  const [mainRoute, setMainRoute] = useState(site?.routes[0] ?? '/');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [emailPassword, setEmailPassword] = useState(true); const [google, setGoogle] = useState(false); const [microsoft, setMicrosoft] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const saveApp = async (): Promise<void> => { if (!actions?.saveAppSettings) return; await actions.saveAppSettings({ description, mainRoute, visibility }); toast.success('Настройки приложения сохранены'); };
  const saveAuth = async (): Promise<void> => { if (!actions?.saveAuthSettings) return; await actions.saveAuthSettings({ emailPassword, google, microsoft }); toast.success('Настройки входа сохранены'); };
  return <div className="space-y-5"><SectionHeader title="Настройки" description="Описание приложения, главная страница, видимость и способы входа." /><div className="inline-flex rounded-lg bg-muted/50 p-0.5" role="tablist" aria-label="Настройки"><button type="button" role="tab" aria-selected={tab === 'app'} onClick={() => setTab('app')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'app' && 'bg-background shadow-sm')}>Приложение</button><button type="button" role="tab" aria-selected={tab === 'auth'} onClick={() => setTab('auth')} className={cn('h-9 rounded-md px-3 text-sm', tab === 'auth' && 'bg-background shadow-sm')}>Аутентификация</button></div>{tab === 'app' ? <div className="space-y-4"><section className="max-w-3xl space-y-4 rounded-xl border p-4"><label className="block space-y-1.5"><span className="text-sm font-medium">Описание</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canEdit} rows={4} className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-sm font-medium">Главная страница</span><select value={mainRoute} onChange={(event) => setMainRoute(event.target.value)} disabled={!canEdit} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">{(site?.routes.length ? site.routes : ['/']).map((route) => <option key={route} value={route}>{route}</option>)}</select></label><label className="space-y-1.5"><span className="text-sm font-medium">Видимость</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'private')} disabled={!canEdit} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="private">Только приглашённые</option><option value="public">Публичное приложение</option></select></label></div><UnavailableAction configured={Boolean(actions?.saveAppSettings)}><Button disabled={!canEdit || !actions?.saveAppSettings} onClick={() => void saveApp()}>Сохранить приложение</Button></UnavailableAction></section><section className="max-w-3xl rounded-xl border border-destructive/25 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-destructive">Удалить приложение</p><p className="mt-1 text-xs text-muted-foreground">Только после отдельного подтверждения. Проект и задачи не затрагиваются без серверного контракта.</p></div><Button variant="destructive" size="sm" disabled={!canEdit || !actions?.deleteApp} onClick={() => setDeleteOpen(true)}><Trash2 className="mr-1.5 size-3.5" />Удалить</Button></div></section></div> : <section className="max-w-3xl overflow-hidden rounded-xl border"><div className="divide-y">{[
    { label: 'Email и пароль', description: 'Вход с локальной учётной записью.', checked: emailPassword, set: setEmailPassword },
    { label: 'Google', description: 'OAuth через Google.', checked: google, set: setGoogle },
    { label: 'Microsoft', description: 'OAuth через Microsoft.', checked: microsoft, set: setMicrosoft },
  ].map((provider) => <label key={provider.label} className="flex items-center justify-between gap-4 px-4 py-4"><span><span className="block text-sm font-medium">{provider.label}</span><span className="mt-1 block text-xs text-muted-foreground">{provider.description}</span></span><input type="checkbox" checked={provider.checked} onChange={(event) => provider.set(event.target.checked)} disabled={!canEdit} className="size-4" /></label>)}</div><div className="border-t p-4"><UnavailableAction configured={Boolean(actions?.saveAuthSettings)}><Button disabled={!canEdit || !actions?.saveAuthSettings} onClick={() => void saveAuth()}><LockKeyhole className="mr-1.5 size-4" />Сохранить способы входа</Button></UnavailableAction><p className="mt-2 text-xs text-muted-foreground">OAuth нельзя включить только переключателем: требуется защищённая серверная конфигурация.</p></div></section>}<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>Удалить приложение проекта?</DialogTitle><DialogDescription>Это разрушительное действие. Оно должно удалить только опубликованный app backend и артефакты, но не сам проект; точный контракт проверит сервер.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Отмена</Button><Button variant="destructive" disabled={!actions?.deleteApp} onClick={() => { if (actions?.deleteApp) void actions.deleteApp(); }}>Удалить приложение</Button></DialogFooter></DialogContent></Dialog></div>;
}
