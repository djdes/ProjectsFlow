import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectKbStore } from '../kb/ProjectKbStore.js';
import type { WriteKbDocument } from '../kb/WriteKbDocument.js';
import type { ServerRepository } from './ServerRepository.js';
import type { SnapshotRepository } from './SnapshotRepository.js';
import type { MonitoringAlertRepository } from './MonitoringAlertRepository.js';
import { renderSnapshotMarkdown } from '../../domain/monitoring/renderSnapshotMarkdown.js';

type Deps = {
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
  readonly alerts: MonitoringAlertRepository;
  readonly projects: ProjectRepository;
  readonly kb: ProjectKbStore;
  readonly writeKbDocument: WriteKbDocument;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'server';
}

// Периодически (hourly) пишет markdown-снимок последнего состояния каждого сервера в KB
// проекта (если KB подключён). ТОЛЬКО метрики — без строк логов (KB читаем editor'ом).
// Best-effort: ошибка по одному серверу не валит остальные.
export class MonitoringKbSnapshotWriter {
  constructor(private readonly deps: Deps) {}

  async writeForAll(): Promise<void> {
    const servers = await this.deps.servers.listEnabled();
    for (const s of servers) {
      try {
        const project = await this.deps.projects.getById(s.projectId);
        if (!project || project.kbKind === 'none') continue;
        const snapshot = await this.deps.snapshots.getLatest(s.id);
        if (!snapshot) continue;

        const active = await this.deps.alerts.listActiveByServer(s.id);
        const { frontmatter, body } = renderSnapshotMarkdown({
          serverName: s.name,
          snapshot,
          activeAlerts: active.map((a) => ({ severity: a.severity, message: a.message })),
        });

        const path = `monitoring/${slugify(s.name)}-latest.md`;
        // Текущий sha для optimistic-lock'а (перезаписываем «latest»-документ).
        let sha: string | null = null;
        try {
          const existing = await this.deps.kb.read(project, path, project.ownerId);
          sha = existing?.sha ?? null;
        } catch {
          sha = null;
        }
        await this.deps.writeKbDocument.execute({
          projectId: project.id,
          userId: project.ownerId,
          path,
          frontmatter,
          body,
          sha,
        });
      } catch (err) {
        console.warn('[monitoring-kb] write failed for server', s.id, err);
      }
    }
  }
}
