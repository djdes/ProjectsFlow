import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';

export type PendingToggle = 'disabled' | 'pending';
export type AppDashboardSettings = {
  readonly profile: { readonly description: string; readonly mainRoute: string; readonly visibility: 'public' | 'private' };
  readonly seo: { readonly title: string; readonly description: string; readonly robotsIndex: boolean };
  readonly customDomain: { readonly hostname: string | null; readonly status: 'none' | 'pending' };
  readonly integrations: { readonly email: PendingToggle; readonly webhooks: PendingToggle; readonly oauth: PendingToggle };
  readonly auth: { readonly emailPassword: boolean; readonly google: PendingToggle; readonly microsoft: PendingToggle };
  readonly updatedAt: string | null;
};

export const DEFAULT_APP_DASHBOARD_SETTINGS: AppDashboardSettings = {
  profile: { description: '', mainRoute: '/', visibility: 'private' },
  seo: { title: '', description: '', robotsIndex: false },
  customDomain: { hostname: null, status: 'none' },
  integrations: { email: 'disabled', webhooks: 'disabled', oauth: 'disabled' },
  auth: { emailPassword: true, google: 'disabled', microsoft: 'disabled' },
  updatedAt: null,
};

export interface AppDashboardSettingsRepository {
  get(projectId: string): Promise<AppDashboardSettings | null>;
  put(projectId: string, settings: AppDashboardSettings): Promise<AppDashboardSettings>;
}

type Deps = ProjectAccessDeps & { readonly settings: AppDashboardSettingsRepository };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function pending(value: unknown): PendingToggle {
  return value === 'pending' ? 'pending' : 'disabled';
}

function domain(value: unknown): string | null {
  const candidate = text(value, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!candidate) return null;
  if (candidate.includes('/') || candidate.includes(':')) throw new Error('invalid_custom_domain');
  const labels = candidate.split('.');
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('invalid_custom_domain');
  }
  return candidate;
}

export class ManageAppDashboardSettings {
  constructor(private readonly deps: Deps) {}

  async get(projectId: string, userId: string): Promise<AppDashboardSettings> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    return await this.deps.settings.get(projectId) ?? DEFAULT_APP_DASHBOARD_SETTINGS;
  }

  async update(projectId: string, userId: string, raw: unknown): Promise<AppDashboardSettings> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_dashboard_settings');
    const current = await this.get(projectId, userId);
    const input = raw as Record<string, unknown>;
    const profile = input['profile'] && typeof input['profile'] === 'object' ? input['profile'] as Record<string, unknown> : {};
    const seo = input['seo'] && typeof input['seo'] === 'object' ? input['seo'] as Record<string, unknown> : {};
    const custom = input['customDomain'] && typeof input['customDomain'] === 'object' ? input['customDomain'] as Record<string, unknown> : {};
    const integrations = input['integrations'] && typeof input['integrations'] === 'object' ? input['integrations'] as Record<string, unknown> : {};
    const auth = input['auth'] && typeof input['auth'] === 'object' ? input['auth'] as Record<string, unknown> : {};
    const hostname = 'hostname' in custom ? domain(custom['hostname']) : current.customDomain.hostname;
    const next: AppDashboardSettings = {
      profile: {
        description: 'description' in profile ? text(profile['description'], 500) : current.profile.description,
        mainRoute: 'mainRoute' in profile ? normalizeRoute(profile['mainRoute']) : current.profile.mainRoute,
        visibility: profile['visibility'] === 'public' ? 'public' : profile['visibility'] === 'private' ? 'private' : current.profile.visibility,
      },
      seo: {
        title: 'title' in seo ? text(seo['title'], 70) : current.seo.title,
        description: 'description' in seo ? text(seo['description'], 180) : current.seo.description,
        robotsIndex: typeof seo['robotsIndex'] === 'boolean' ? seo['robotsIndex'] : current.seo.robotsIndex,
      },
      customDomain: { hostname, status: hostname ? 'pending' : 'none' },
      integrations: {
        email: 'email' in integrations ? pending(integrations['email']) : current.integrations.email,
        webhooks: 'webhooks' in integrations ? pending(integrations['webhooks']) : current.integrations.webhooks,
        oauth: 'oauth' in integrations ? pending(integrations['oauth']) : current.integrations.oauth,
      },
      auth: {
        emailPassword: typeof auth['emailPassword'] === 'boolean' ? auth['emailPassword'] : current.auth.emailPassword,
        google: 'google' in auth ? pending(auth['google']) : current.auth.google,
        microsoft: 'microsoft' in auth ? pending(auth['microsoft']) : current.auth.microsoft,
      },
      updatedAt: new Date().toISOString(),
    };
    return this.deps.settings.put(projectId, next);
  }
}

function normalizeRoute(value: unknown): string {
  const route = text(value, 500);
  if (!route || !route.startsWith('/') || route.startsWith('//')) throw new Error('invalid_main_route');
  return route;
}
