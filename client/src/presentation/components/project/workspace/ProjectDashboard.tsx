import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Bot,
  Braces,
  Code2,
  Database,
  Globe2,
  Loader2,
  Megaphone,
  Plug,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useContainer } from "@/infrastructure/di/container";
import { cn } from "@/lib/utils";
import type { Project } from "@/domain/project/Project";
import type { ProjectMember } from "@/domain/project/ProjectMembership";
import type { ProjectAnalytics } from "@/domain/project/ProjectAnalytics";
import type {
  AppBackendDashboard,
  AppDashboardSettings,
  ProjectSite,
} from "@/application/project/ProjectRepository";
import { AppDataExplorer } from "./AppDataExplorer";
import { AppLogsPanel } from "./AppLogsPanel";
import {
  AgentsSection,
  AnalyticsSection,
  ApiSection,
  CodeSection,
  DomainsSection,
  IntegrationsSection,
  MarketingSection,
  OverviewSection,
  SecuritySection,
  SettingsSection,
  UsersSection,
  WorkflowsSection,
  type DashboardContentProps,
} from "./dashboard/DashboardSections";
import {
  DASHBOARD_SECTIONS,
  resolveDashboardSection,
  type DashboardIconName,
  type DashboardSection,
} from "./dashboard/dashboardConfig";

const SECTION_ICON: Record<DashboardIconName, typeof Globe2> = {
  overview: Globe2,
  users: Users,
  data: Database,
  analytics: BarChart3,
  marketing: Megaphone,
  domains: Globe2,
  integrations: Plug,
  security: ShieldCheck,
  code: Code2,
  agents: Bot,
  workflows: Workflow,
  logs: Activity,
  api: Braces,
  settings: Settings2,
};

export type ProjectDashboardProps = {
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly canEdit: boolean;
  readonly onOpenPreview: () => void;
  readonly onOpenAutomation: () => void;
  readonly initialSection?: DashboardSection | string;
  readonly onSectionChange?: (section: DashboardSection) => void;
  readonly fillAvailable?: boolean;
};

export function ProjectDashboard({
  project,
  members,
  canEdit,
  onOpenPreview,
  onOpenAutomation,
  initialSection,
  onSectionChange,
  fillAvailable = false,
}: ProjectDashboardProps): React.ReactElement {
  const { projectRepository } = useContainer();
  const [section, setSection] = useState<DashboardSection>(() =>
    resolveDashboardSection(initialSection),
  );
  const [dashboard, setDashboard] = useState<AppBackendDashboard | null>(null);
  const [site, setSite] = useState<ProjectSite | null>(null);
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);
  const [dashboardSettings, setDashboardSettings] =
    useState<AppDashboardSettings | null>(null);
  const [currentProject, setCurrentProject] = useState(project);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setSection(resolveDashboardSection(initialSection));
  }, [initialSection]);

  useEffect(() => {
    setCurrentProject(project);
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.allSettled([
      projectRepository.getAppBackendDashboard(project.id),
      projectRepository.getProjectSite(project.id),
      projectRepository.getProjectAnalytics(project.id, 28),
      projectRepository.getAppDashboardSettings(project.id),
    ])
      .then(([backend, projectSite, projectAnalytics, settings]) => {
        if (cancelled) return;
        if (backend.status === "rejected" || settings.status === "rejected") {
          setError(true);
          return;
        }
        setDashboard(backend.value);
        setDashboardSettings(settings.value);
        setSite(projectSite.status === "fulfilled" ? projectSite.value : null);
        setAnalytics(
          projectAnalytics.status === "fulfilled"
            ? projectAnalytics.value
            : null,
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, projectRepository, reload]);

  const selectSection = (next: DashboardSection): void => {
    setSection(next);
    onSectionChange?.(next);
    window.requestAnimationFrame(() =>
      panelRef.current?.focus({ preventScroll: true }),
    );
  };

  if (loading)
    return (
      <div
        className="grid min-h-[480px] place-items-center text-sm text-muted-foreground"
        role="status"
      >
        <span>
          <Loader2 className="mr-2 inline size-4 animate-spin motion-reduce:animate-none" />
          Загружаем Dashboard…
        </span>
      </div>
    );
  if (error || !dashboard || !dashboardSettings)
    return (
      <div className="grid min-h-[480px] place-items-center px-4 text-center">
        <div>
          <p className="font-medium">Dashboard не загрузился</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Данные проекта остались в безопасности. Попробуйте ещё раз.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setReload((value) => value + 1)}
          >
            Повторить
          </Button>
        </div>
      </div>
    );

  const common: DashboardContentProps = {
    project: currentProject,
    members,
    canEdit,
    dashboard,
    site,
    analytics,
    dashboardSettings,
    onOpenPreview,
    onOpenAutomation,
    onProjectUpdated: setCurrentProject,
    onDashboardSettingsUpdated: setDashboardSettings,
    onRefresh: () => setReload((value) => value + 1),
  };

  return (
    <div className={cn('overflow-hidden bg-muted/10', fillAvailable ? 'h-full' : 'rounded-xl border')}>
      <div className={cn('flex min-h-0 flex-col md:flex-row', fillAvailable ? 'h-full' : 'h-[clamp(620px,74vh,840px)]')}>
        <aside className="hidden w-52 shrink-0 overflow-y-auto overscroll-contain border-r bg-background p-2 md:flex md:flex-col">
          <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Dashboard
          </p>
          <nav className="space-y-0.5" aria-label="Разделы Dashboard">
            {DASHBOARD_SECTIONS.map(({ id, label, icon }) => {
              const Icon = SECTION_ICON[icon];
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => selectSection(id)}
                  className={cn(
                    "flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors motion-reduce:transition-none",
                    section === id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto border-t px-2 pt-3 text-xs text-muted-foreground">
            <p className="truncate font-medium text-foreground">
              {currentProject.name}
            </p>
            <p className="mt-1">
              {dashboard.status === "active"
                ? `${dashboard.schema?.tables.length ?? 0} таблиц`
                : "Без базы"}
            </p>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <div className="flex shrink-0 items-center gap-2 border-b p-2 md:hidden">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Раздел Dashboard</span>
              <select
                value={section}
                onChange={(event) =>
                  selectSection(resolveDashboardSection(event.target.value))
                }
                className="h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium"
              >
                {DASHBOARD_SECTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              onClick={() => setReload((value) => value + 1)}
              aria-label="Обновить Dashboard"
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
          <main
            ref={panelRef}
            id={`dashboard-panel-${section}`}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 lg:p-6"
            tabIndex={-1}
          >
            {section === "overview" && <OverviewSection {...common} />}
            {section === "users" && <UsersSection {...common} />}
            {section === "data" && (
              <AppDataExplorer
                projectId={project.id}
                dashboard={dashboard}
                canEdit={canEdit}
                onDashboardChange={setDashboard}
              />
            )}
            {section === "analytics" && <AnalyticsSection {...common} />}
            {section === "marketing" && <MarketingSection {...common} />}
            {section === "domains" && <DomainsSection {...common} />}
            {section === "integrations" && <IntegrationsSection {...common} />}
            {section === "security" && <SecuritySection {...common} />}
            {section === "code" && <CodeSection {...common} />}
            {section === "agents" && <AgentsSection {...common} />}
            {section === "workflows" && <WorkflowsSection {...common} />}
            {section === "logs" && (
              <AppLogsPanel
                projectId={project.id}
                tables={dashboard.schema?.tables ?? []}
                members={members}
              />
            )}
            {section === "api" && <ApiSection {...common} />}
            {section === "settings" && <SettingsSection {...common} />}
          </main>
        </div>
      </div>
    </div>
  );
}
