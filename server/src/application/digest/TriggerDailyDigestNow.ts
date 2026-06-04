import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { SendDailyDigest } from './SendDailyDigest.js';

type Deps = ProjectAccessDeps & { readonly send: SendDailyDigest };

// Кнопка «Отправить сейчас»: немедленная рассылка сводки по текущим настройкам
// (force — даже если daily выключен). Editor+ (как настройка сводки).
export class TriggerDailyDigestNow {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<{ taskCount: number }> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    return this.deps.send.execute(projectId, { force: true });
  }
}
