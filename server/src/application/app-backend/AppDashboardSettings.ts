import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import { lookup, resolveCname } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { classifyField, sensitiveColumns } from '../../domain/app-backend/sensitiveFields.js';
import type { AppBackendRepository } from './AppBackendRepository.js';
import type { AppAdminAuditRepository } from './AppAdminAuditRepository.js';

export type PendingToggle = 'disabled' | 'pending';
export type ConnectionStatus = 'disabled' | 'pending' | 'configured' | 'error';
export type AppDashboardSettings = {
  readonly profile: { readonly description: string; readonly mainRoute: string; readonly visibility: 'public' | 'private' };
  readonly branding: {
    readonly logoUrl: string;
    readonly socialImageUrl: string;
    readonly showPlatformBadge: boolean;
  };
  readonly seo: {
    readonly title: string;
    readonly description: string;
    readonly robotsIndex: boolean;
    readonly canonicalUrl: string;
    readonly structuredData: string;
  };
  readonly customDomain: {
    readonly hostname: string | null;
    readonly status: 'none' | 'pending' | 'verified' | 'error';
    readonly lastCheckedAt: string | null;
    readonly error: string | null;
  };
  readonly integrations: {
    readonly email: ConnectionStatus;
    readonly webhooks: ConnectionStatus;
    readonly oauth: ConnectionStatus;
    readonly emailSender: string;
    readonly webhookUrl: string;
    readonly oauthIssuer: string;
  };
  readonly auth: {
    readonly emailPassword: boolean;
    readonly google: PendingToggle;
    readonly microsoft: PendingToggle;
    readonly facebook: PendingToggle;
    readonly apple: PendingToggle;
    readonly sso: PendingToggle;
  };
  readonly advanced: {
    readonly testData: boolean;
    readonly sessionRecordings: boolean;
  };
  readonly socialContent: {
    readonly goal: string;
    readonly channels: readonly string[];
    readonly generated: readonly string[];
  };
  readonly updatedAt: string | null;
};
export type AppSecurityFinding = {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly title: string;
  readonly remediation: string;
};
export type AppSecurityScan = { readonly scannedAt: string; readonly findings: readonly AppSecurityFinding[] };

export const DEFAULT_APP_DASHBOARD_SETTINGS: AppDashboardSettings = {
  profile: { description: '', mainRoute: '/', visibility: 'private' },
  branding: { logoUrl: '', socialImageUrl: '', showPlatformBadge: false },
  seo: { title: '', description: '', robotsIndex: false, canonicalUrl: '', structuredData: '' },
  customDomain: { hostname: null, status: 'none', lastCheckedAt: null, error: null },
  integrations: {
    email: 'disabled', webhooks: 'disabled', oauth: 'disabled',
    emailSender: '', webhookUrl: '', oauthIssuer: '',
  },
  auth: {
    emailPassword: true, google: 'disabled', microsoft: 'disabled',
    facebook: 'disabled', apple: 'disabled', sso: 'disabled',
  },
  advanced: { testData: false, sessionRecordings: false },
  socialContent: { goal: '', channels: [], generated: [] },
  updatedAt: null,
};

export interface AppDashboardSettingsRepository {
  get(projectId: string): Promise<AppDashboardSettings | null>;
  put(projectId: string, settings: AppDashboardSettings): Promise<AppDashboardSettings>;
}

type Deps = ProjectAccessDeps & {
  readonly settings: AppDashboardSettingsRepository;
  // Опционально: реестр бэкендов приложения (для скана схемы — публичные таблицы с
  // чувствительными полями, поля без явного флага чувствительности). Срез 4.
  readonly appBackends?: AppBackendRepository;
  // Опционально: надёжный административный аудит (снятие флага чувствительности, объёмы
  // выгрузок). Без него скан просто не выдаёт эти findings — деградирует безопасно. Срез 4.
  readonly adminAudit?: AppAdminAuditRepository;
};

// Окна анализа аудита для скана безопасности.
const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000; // «за сутки» из плана (срез 4)
const EXPORT_ROW_THRESHOLD = 1_000; // выгрузка сверх этого за окно — finding
const SENSITIVITY_REMOVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // «недавнее» снятие флага

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function pending(value: unknown): PendingToggle {
  return value === 'pending' ? 'pending' : 'disabled';
}

function connection(value: unknown): ConnectionStatus {
  return value === 'pending' || value === 'configured' || value === 'error' ? value : 'disabled';
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringArray(value: unknown, maxItems: number, maxLength: number): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => text(item, maxLength)).filter(Boolean);
}

function safeUrl(value: unknown, max = 1_000): string {
  const candidate = text(value, max);
  if (!candidate) return '';
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new Error('invalid_dashboard_url'); }
  if (parsed.protocol !== 'https:') throw new Error('invalid_dashboard_url');
  return parsed.toString();
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
    const stored = await this.deps.settings.get(projectId);
    if (!stored) return DEFAULT_APP_DASHBOARD_SETTINGS;
    return {
      ...DEFAULT_APP_DASHBOARD_SETTINGS,
      ...stored,
      profile: { ...DEFAULT_APP_DASHBOARD_SETTINGS.profile, ...stored.profile },
      branding: { ...DEFAULT_APP_DASHBOARD_SETTINGS.branding, ...stored.branding },
      seo: { ...DEFAULT_APP_DASHBOARD_SETTINGS.seo, ...stored.seo },
      customDomain: { ...DEFAULT_APP_DASHBOARD_SETTINGS.customDomain, ...stored.customDomain },
      integrations: { ...DEFAULT_APP_DASHBOARD_SETTINGS.integrations, ...stored.integrations },
      auth: { ...DEFAULT_APP_DASHBOARD_SETTINGS.auth, ...stored.auth },
      advanced: { ...DEFAULT_APP_DASHBOARD_SETTINGS.advanced, ...stored.advanced },
      socialContent: { ...DEFAULT_APP_DASHBOARD_SETTINGS.socialContent, ...stored.socialContent },
    };
  }

  async update(projectId: string, userId: string, raw: unknown): Promise<AppDashboardSettings> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_dashboard_settings');
    const current = await this.get(projectId, userId);
    const input = raw as Record<string, unknown>;
    const profile = input['profile'] && typeof input['profile'] === 'object' ? input['profile'] as Record<string, unknown> : {};
    const branding = input['branding'] && typeof input['branding'] === 'object' ? input['branding'] as Record<string, unknown> : {};
    const seo = input['seo'] && typeof input['seo'] === 'object' ? input['seo'] as Record<string, unknown> : {};
    const custom = input['customDomain'] && typeof input['customDomain'] === 'object' ? input['customDomain'] as Record<string, unknown> : {};
    const integrations = input['integrations'] && typeof input['integrations'] === 'object' ? input['integrations'] as Record<string, unknown> : {};
    const auth = input['auth'] && typeof input['auth'] === 'object' ? input['auth'] as Record<string, unknown> : {};
    const advanced = input['advanced'] && typeof input['advanced'] === 'object' ? input['advanced'] as Record<string, unknown> : {};
    const socialContent = input['socialContent'] && typeof input['socialContent'] === 'object' ? input['socialContent'] as Record<string, unknown> : {};
    const hostname = 'hostname' in custom ? domain(custom['hostname']) : current.customDomain.hostname;
    const next: AppDashboardSettings = {
      profile: {
        description: 'description' in profile ? text(profile['description'], 500) : current.profile.description,
        mainRoute: 'mainRoute' in profile ? normalizeRoute(profile['mainRoute']) : current.profile.mainRoute,
        visibility: profile['visibility'] === 'public' ? 'public' : profile['visibility'] === 'private' ? 'private' : current.profile.visibility,
      },
      branding: {
        logoUrl: 'logoUrl' in branding ? safeUrl(branding['logoUrl']) : current.branding.logoUrl,
        socialImageUrl: 'socialImageUrl' in branding ? safeUrl(branding['socialImageUrl']) : current.branding.socialImageUrl,
        showPlatformBadge: boolean(branding['showPlatformBadge'], current.branding.showPlatformBadge),
      },
      seo: {
        title: 'title' in seo ? text(seo['title'], 70) : current.seo.title,
        description: 'description' in seo ? text(seo['description'], 180) : current.seo.description,
        robotsIndex: typeof seo['robotsIndex'] === 'boolean' ? seo['robotsIndex'] : current.seo.robotsIndex,
        canonicalUrl: 'canonicalUrl' in seo ? safeUrl(seo['canonicalUrl'], 500) : current.seo.canonicalUrl,
        structuredData: 'structuredData' in seo ? validateStructuredData(seo['structuredData']) : current.seo.structuredData,
      },
      customDomain: hostname === current.customDomain.hostname
        ? current.customDomain
        : { hostname, status: hostname ? 'pending' : 'none', lastCheckedAt: null, error: null },
      integrations: {
        email: 'email' in integrations ? connection(integrations['email']) : current.integrations.email,
        webhooks: 'webhooks' in integrations ? connection(integrations['webhooks']) : current.integrations.webhooks,
        oauth: 'oauth' in integrations ? connection(integrations['oauth']) : current.integrations.oauth,
        emailSender: 'emailSender' in integrations ? text(integrations['emailSender'], 320) : current.integrations.emailSender,
        webhookUrl: 'webhookUrl' in integrations ? safeUrl(integrations['webhookUrl']) : current.integrations.webhookUrl,
        oauthIssuer: 'oauthIssuer' in integrations ? safeUrl(integrations['oauthIssuer']) : current.integrations.oauthIssuer,
      },
      auth: {
        emailPassword: typeof auth['emailPassword'] === 'boolean' ? auth['emailPassword'] : current.auth.emailPassword,
        google: 'google' in auth ? pending(auth['google']) : current.auth.google,
        microsoft: 'microsoft' in auth ? pending(auth['microsoft']) : current.auth.microsoft,
        facebook: 'facebook' in auth ? pending(auth['facebook']) : current.auth.facebook,
        apple: 'apple' in auth ? pending(auth['apple']) : current.auth.apple,
        sso: 'sso' in auth ? pending(auth['sso']) : current.auth.sso,
      },
      advanced: {
        testData: boolean(advanced['testData'], current.advanced.testData),
        sessionRecordings: boolean(advanced['sessionRecordings'], current.advanced.sessionRecordings),
      },
      socialContent: {
        goal: 'goal' in socialContent ? text(socialContent['goal'], 500) : current.socialContent.goal,
        channels: 'channels' in socialContent ? stringArray(socialContent['channels'], 8, 40) : current.socialContent.channels,
        generated: 'generated' in socialContent ? stringArray(socialContent['generated'], 12, 2_000) : current.socialContent.generated,
      },
      updatedAt: new Date().toISOString(),
    };
    return this.deps.settings.put(projectId, next);
  }

  async verifyCustomDomain(projectId: string, userId: string): Promise<AppDashboardSettings> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const current = await this.get(projectId, userId);
    const hostname = current.customDomain.hostname;
    if (!hostname) throw new Error('custom_domain_not_configured');
    const project = await this.deps.projects.getById(projectId);
    if (!project?.siteSlug) throw new Error('site_slug_not_configured');
    const expected = `${project.siteSlug}.projectsflow.ru`;
    let verified = false;
    let error: string | null = null;
    try {
      const records = (await resolveCname(hostname)).map((record) => record.toLowerCase().replace(/\.$/, ''));
      verified = records.includes(expected);
      if (!verified) error = `CNAME должен указывать на ${expected}`;
    } catch {
      error = `CNAME для ${hostname} пока не найден`;
    }
    return this.deps.settings.put(projectId, {
      ...current,
      customDomain: {
        ...current.customDomain,
        status: verified ? 'verified' : 'error',
        lastCheckedAt: new Date().toISOString(),
        error,
      },
      updatedAt: new Date().toISOString(),
    });
  }

  async testWebhook(projectId: string, userId: string): Promise<AppDashboardSettings> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const current = await this.get(projectId, userId);
    if (!current.integrations.webhookUrl) throw new Error('webhook_not_configured');
    await assertPublicHttpsTarget(current.integrations.webhookUrl);
    let status: ConnectionStatus = 'error';
    try {
      const response = await fetch(current.integrations.webhookUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
        headers: { 'content-type': 'application/json', 'user-agent': 'ProjectsFlow-Webhook-Test/1.0' },
        body: JSON.stringify({ id: randomUUID(), type: 'projectsflow.webhook.test', projectId, createdAt: new Date().toISOString() }),
      });
      status = response.ok ? 'configured' : 'error';
    } catch { status = 'error'; }
    return this.deps.settings.put(projectId, {
      ...current,
      integrations: { ...current.integrations, webhooks: status },
      updatedAt: new Date().toISOString(),
    });
  }

  async scanSecurity(projectId: string, userId: string): Promise<AppSecurityScan> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    const project = await this.deps.projects.getById(projectId);
    if (!project) throw new Error('project_not_found');
    const settings = await this.get(projectId, userId);
    const findings: AppSecurityFinding[] = [];
    if (!project.gitRepoUrl) findings.push({ code: 'repository_missing', severity: 'warning', title: 'Репозиторий не подключён', remediation: 'Подключите GitHub-репозиторий, чтобы изменения и аудит кода были воспроизводимыми.' });
    if (settings.profile.visibility === 'public' && !settings.auth.emailPassword && settings.auth.google === 'disabled' && settings.auth.microsoft === 'disabled' && settings.auth.facebook === 'disabled' && settings.auth.apple === 'disabled' && settings.auth.sso === 'disabled') {
      findings.push({ code: 'auth_missing', severity: 'critical', title: 'Для публичного приложения отключены все способы входа', remediation: 'Включите email или настройте хотя бы одного внешнего провайдера.' });
    }
    if (settings.customDomain.hostname && settings.customDomain.status !== 'verified') findings.push({ code: 'domain_unverified', severity: 'warning', title: 'Пользовательский домен не подтверждён', remediation: 'Проверьте CNAME в разделе «Домены».' });
    if (settings.integrations.webhooks === 'error') findings.push({ code: 'webhook_error', severity: 'warning', title: 'Webhook не проходит проверку', remediation: 'Проверьте HTTPS URL и ответ сервера.' });
    if (settings.seo.robotsIndex && settings.profile.visibility !== 'public') findings.push({ code: 'indexing_private', severity: 'info', title: 'Индексация включена для закрытого приложения', remediation: 'Отключите индексацию либо измените видимость приложения.' });
    if (settings.advanced.sessionRecordings) findings.push({ code: 'recording_privacy', severity: 'info', title: 'Включены записи сессий', remediation: 'Укажите это в политике конфиденциальности и исключите чувствительные поля из записи.' });
    // Тестовые данные на публичном приложении: демо-записи видны реальным пользователям.
    if (settings.advanced.testData && settings.profile.visibility === 'public') {
      findings.push({ code: 'test_data_public', severity: 'warning', title: 'Тестовые данные включены на публичном приложении', remediation: 'Отключите тестовые данные: на публичном приложении демонстрационные записи попадают к реальным пользователям.' });
    }
    findings.push(...(await this.scanSchemaSurfaces(projectId)));
    findings.push(...(await this.scanAuditSurfaces(projectId)));
    return { scannedAt: new Date().toISOString(), findings };
  }

  // Скан объявленной схемы приложения (срез 4): публичное чтение таблицы с чувствительной
  // колонкой — критично (значения секретов/PII отдаются без авторизации); поле с чувствительным
  // именем без явного флага — защита держится только на эвристике имени.
  private async scanSchemaSurfaces(projectId: string): Promise<AppSecurityFinding[]> {
    const backend = await this.deps.appBackends?.getByProject(projectId);
    const schema = backend?.schema;
    if (!schema) return [];
    const findings: AppSecurityFinding[] = [];
    for (const table of schema.tables) {
      const sensitive = sensitiveColumns(table.fields);
      if (table.rules.read === 'anyone' && sensitive.size > 0) {
        const columns = [...sensitive.keys()].join(', ');
        findings.push({
          code: `public_read_sensitive:${table.name}`,
          severity: 'critical',
          title: `Таблица «${table.name}» открыта на чтение всем и содержит чувствительные поля`,
          remediation: `Ограничьте чтение таблицы (authenticated или owner) либо уберите чувствительные поля (${columns}) — сейчас их значения доступны без авторизации.`,
        });
      }
      // Поле, которое ловит только эвристика имени: явный флаг надёжнее переименования колонки.
      const unflagged = table.fields.filter((field) => !field.sensitive && classifyField(field.name));
      if (unflagged.length > 0) {
        const columns = unflagged.map((field) => field.name).join(', ');
        findings.push({
          code: `sensitive_unflagged:${table.name}`,
          severity: 'warning',
          title: `В таблице «${table.name}» чувствительные поля не помечены явно`,
          remediation: `Проставьте флаг чувствительности полям (${columns}) в настройках доступа: сейчас защита держится только на имени и пропадёт при переименовании.`,
        });
      }
    }
    return findings;
  }

  // Скан надёжного административного аудита (срез 4): недавнее снятие флага чувствительности
  // и массовые выгрузки за сутки. Важно: аудит НИКОГДА не хранит сами значения (см. раздел 4
  // плана) — используем только факт события, число строк и имена полей/колонок.
  private async scanAuditSurfaces(projectId: string): Promise<AppSecurityFinding[]> {
    const audit = this.deps.adminAudit;
    if (!audit) return [];
    const findings: AppSecurityFinding[] = [];
    const now = Date.now();

    const sensitivity = await audit.list(projectId, { operation: 'dashboard.sensitivity_changed', limit: 100 });
    const removed = sensitivity.rows.filter((row) => {
      const detail = row.detail as Record<string, unknown> | null | undefined;
      const removedFlag = detail != null && 'to' in detail && detail['to'] == null;
      return removedFlag && Date.parse(row.createdAt) >= now - SENSITIVITY_REMOVAL_WINDOW_MS;
    });
    if (removed.length > 0) {
      const fields = removed
        .map((row) => String((row.detail as Record<string, unknown> | null | undefined)?.['field'] ?? '?'))
        .join(', ');
      findings.push({
        code: 'sensitivity_flag_removed',
        severity: 'warning',
        title: 'Недавно снят флаг чувствительности с поля',
        remediation: `С полей (${fields}) недавно сняли флаг чувствительности — их значения снова могут раскрываться. Убедитесь, что колонка действительно не содержит секретов или PII.`,
      });
    }

    const exports = await audit.list(projectId, { operation: 'dashboard.export', limit: 200 });
    const exportedRows = exports.rows
      .filter((row) => Date.parse(row.createdAt) >= now - EXPORT_WINDOW_MS)
      .reduce((sum, row) => {
        const rows = (row.detail as Record<string, unknown> | null | undefined)?.['rows'];
        return sum + (typeof rows === 'number' && Number.isFinite(rows) ? rows : 0);
      }, 0);
    if (exportedRows > EXPORT_ROW_THRESHOLD) {
      findings.push({
        code: 'export_volume_high',
        severity: 'warning',
        title: `За сутки выгружено строк: ${exportedRows}`,
        remediation: 'Проверьте, кто и зачем выгружает большие объёмы данных: массовая выгрузка — частый вектор утечки. Ограничьте доступ к экспорту при необходимости.',
      });
    }
    return findings;
  }
}

async function assertPublicHttpsTarget(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_webhook_url');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('unsafe_webhook_url');
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const value = address.toLowerCase();
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.');
}

function validateStructuredData(value: unknown): string {
  const candidate = text(value, 20_000);
  if (!candidate) return '';
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { throw new Error('invalid_structured_data'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_structured_data');
  return JSON.stringify(parsed, null, 2);
}

function normalizeRoute(value: unknown): string {
  const route = text(value, 500);
  if (!route || !route.startsWith('/') || route.startsWith('//')) throw new Error('invalid_main_route');
  return route;
}
