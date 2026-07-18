import { eq } from 'drizzle-orm';
import type { AppDashboardSettings, AppDashboardSettingsRepository } from '../../application/app-backend/AppDashboardSettings.js';
import { DEFAULT_APP_DASHBOARD_SETTINGS } from '../../application/app-backend/AppDashboardSettings.js';
import type { Database } from '../db/index.js';
import { appDashboardSettings } from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';

export class DrizzleAppDashboardSettingsRepository implements AppDashboardSettingsRepository {
  constructor(private readonly db: Database) {}

  async get(projectId: string): Promise<AppDashboardSettings | null> {
    const [row] = await this.db.select().from(appDashboardSettings).where(eq(appDashboardSettings.projectId, projectId)).limit(1);
    if (!row) return null;
    const parsed = parseJsonCol<Omit<AppDashboardSettings, 'updatedAt'>>(row.settingsJson, DEFAULT_APP_DASHBOARD_SETTINGS);
    return { ...DEFAULT_APP_DASHBOARD_SETTINGS, ...parsed, updatedAt: row.updatedAt.toISOString() };
  }

  async put(projectId: string, settings: AppDashboardSettings): Promise<AppDashboardSettings> {
    const settingsJson = JSON.stringify({ ...settings, updatedAt: undefined });
    await this.db.insert(appDashboardSettings).values({ projectId, settingsJson }).onDuplicateKeyUpdate({ set: { settingsJson } });
    return await this.get(projectId) ?? settings;
  }
}
