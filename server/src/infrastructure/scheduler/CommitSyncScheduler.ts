import type { AutomationRepository } from '../../application/automation/AutomationRepository.js';
import type { EnqueueCommitSyncJob } from '../../application/commit-sync/EnqueueCommitSyncJob.js';
import type { CommitSyncBatchProgress } from '../../application/commit-sync/CommitSyncBatchProgress.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import type { WorkspaceAssigneeDigestRepository } from '../../application/digest/WorkspaceAssigneeDigestRepository.js';

// «Сейчас» в Europe/Moscow → { hour 0..23, minute 0..59, date 'YYYY-MM-DD', dayOfWeek 0..6 }.
// Зеркало WorkspaceAssigneeDigestScheduler.mskNow (dayOfWeek: 0=вс, как getUTCDay).
function mskNow(): { hour: number; minute: number; date: string; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const [year, month, day] = date.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(year!, (month ?? 1) - 1, day!)).getUTCDay();
  return {
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    date,
    dayOfWeek,
  };
}

// Серверный планировщик ежедневной commit-sync. Тик раз в минуту: для каждого проекта с
// включённым commit-sync — если МSK-время уже наступило и сегодня ещё не запускались,
// ставит job и помечает дату. Catch-up: первый тик сразу при старте (рестарт после времени).
export class CommitSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  // Re-entrancy guard (B5): не запускаем tick поверх незавершённого предыдущего.
  private running = false;

  constructor(
    private readonly deps: {
      automation: AutomationRepository;
      enqueue: EnqueueCommitSyncJob;
      // Резолв Telegram-группы проекта для ключа батча (проект → пространство → настройки сводки).
      projects: Pick<ProjectRepository, 'getWorkspaceId'>;
      settings: Pick<WorkspaceAssigneeDigestRepository, 'get'>;
      // Живой прогресс сверки (db/145). Опционален: после того как все job'ы батча поставлены,
      // шлём ОДНО «прогресс-сообщение» в группу. Отсутствие — без прогресса (тесты/старый wiring).
      progress?: Pick<CommitSyncBatchProgress, 'start'>;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e) => console.warn('[commit-sync] tick error', e));
    }, 60_000);
    void this.tick().catch((e) => console.warn('[commit-sync] tick error', e));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runTick();
    } finally {
      this.running = false;
    }
  }

  private async runTick(): Promise<void> {
    const now = mskNow();
    const nowMin = now.hour * 60 + now.minute;
    const due = await this.deps.automation.listCommitSyncEnabled();
    // Ключи батчей, для которых в этом тике реально поставлены job'ы — по ним после цикла шлём один
    // прогресс на батч. Все проекты группы@время попадают в один тик (каждый метит lastRunOn=date),
    // поэтому «батч сформирован» = конец цикла постановки.
    const startedBatches = new Set<string>();
    for (const s of due) {
      // Не тот день недели — пропускаем (per-project дни, db/141).
      if (!s.daysOfWeek.includes(now.dayOfWeek)) continue;
      const schedMin = s.hour * 60 + s.minute;
      if (nowMin < schedMin || s.lastRunOn === now.date) continue;
      try {
        // Ключ батча по РАСПИСАННОМУ времени проекта (s.hour/s.minute), а не now — чтобы catch-up
        // после простоя всё равно группировал проекты, назначенные на один час:минуту.
        const batchKey = await this.batchKeyFor(s.projectId, now.date, s.hour, s.minute);
        const job = await this.deps.enqueue.execute(s.projectId, new Date(), { batchKey });
        // Прогресс только для плановых батчей (batchKey != null) и только если job реально создан.
        if (job?.batchKey) startedBatches.add(job.batchKey);
      } catch (e) {
        console.warn('[commit-sync] enqueue failed', s.projectId, e);
      } finally {
        // Помечаем запуск в любом случае — чтобы не ретраить каждую минуту (как digest).
        await this.deps.automation.markCommitSyncRun(s.projectId, now.date).catch(() => {});
      }
    }
    // Батч сформирован (все job'ы поставлены) → шлём одно прогресс-сообщение на батч. start() сам
    // застолбит прогресс атомарно (ровно один на батч) и пропустит одиночные батчи (<2 проектов).
    for (const batchKey of startedBatches) {
      await this.deps.progress
        ?.start(batchKey)
        .catch((e) => console.warn('[commit-sync] progress start failed', batchKey, e));
    }
  }

  // Ключ батча '<groupChatId>:<YYYY-MM-DD>:<HH>:<MM>'. Проекты с одинаковыми группой, датой и
  // точным временем сверки схлопнутся в одно сообщение. Нет пространства/группы → null (одиночная
  // доставка; сводка всё равно молчит без группы).
  private async batchKeyFor(
    projectId: string,
    date: string,
    hour: number,
    minute: number,
  ): Promise<string | null> {
    const workspaceId = await this.deps.projects.getWorkspaceId(projectId).catch(() => null);
    if (!workspaceId) return null;
    const settings = await this.deps.settings.get(workspaceId).catch(() => null);
    const chatId = settings?.telegramGroupChatId ?? null;
    if (chatId === null) return null;
    return commitSyncBatchKey(chatId, date, hour, minute);
  }
}

// Ключ батча '<groupChatId>:<YYYY-MM-DD>:<HH>:<MM>'. Два проекта попадают в один батч (одно
// сообщение) ⇔ совпали группа, дата, час И минута сверки. projectsflow@17:00 и docsflow@17:01 →
// разные ключи → разные сообщения; оба @17:00 → один ключ → одно сообщение.
export function commitSyncBatchKey(
  chatId: number,
  date: string,
  hour: number,
  minute: number,
): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${chatId}:${date}:${pad(hour)}:${pad(minute)}`;
}
