import {
  activeCustomSlots,
  firstFreeCustomSlot,
  type CustomKanbanSlot,
  type KanbanBoardSettings,
} from '../../domain/kanban/KanbanSettings.js';
import { NotWorkspaceOwnerError } from '../../domain/workspace/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import { requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import { normalizeColumnLabel } from './ManageKanbanColumns.js';

const FALLBACK_STATUS = 'backlog' as const;

type Deps = {
  readonly workspaces: WorkspaceRepository;
  readonly projects: Pick<
    ProjectRepository,
    'listByWorkspace' | 'getKanbanSettings' | 'setKanbanSettings'
  >;
  readonly tasks: Pick<TaskRepository, 'bulkChangeStatus'>;
};

export type BulkColumnResult = {
  // Сколько проектов реально изменилось.
  readonly affected: number;
  // Проекты, которые пропустили (для create — нет свободных слотов; колонка уже есть).
  readonly skipped: readonly { readonly projectId: string; readonly name: string; readonly reason: string }[];
  // Сколько задач переселено в «Черновики» (только для удаления).
  readonly movedTasks: number;
};

// Название колонки, доступное в пространстве: label + в скольких проектах она заведена.
export type WorkspaceColumnSummary = {
  readonly label: string;
  readonly projectCount: number;
};

/**
 * Массовые операции с кастомными колонками на уровне ПРОСТРАНСТВА.
 *
 * Колонка идентифицируется по названию (без регистра и краевых пробелов), а не по слоту:
 * в разных проектах одна и та же «Ревью» может занимать разные слоты, и пользователь
 * думает названиями, а не номерами слотов.
 *
 * Право — lead/owner пространства (как у приёмки и тумблера воркера): операция меняет
 * доски всей команды разом.
 */
export class BulkManageWorkspaceKanbanColumns {
  constructor(private readonly deps: Deps) {}

  // Какие кастомные колонки уже есть в пространстве — для списка «удалить у всех».
  async list(workspaceId: string, actorUserId: string): Promise<WorkspaceColumnSummary[]> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    const projects = await this.deps.projects.listByWorkspace(workspaceId);
    // Считаем по нормализованному ключу, а показываем первое встреченное написание.
    const byKey = new Map<string, { label: string; projectCount: number }>();
    for (const project of projects) {
      const settings = await this.settingsOf(project.id);
      for (const slot of activeCustomSlots(settings)) {
        const label = settings[slot]?.label?.trim() ?? '';
        if (label.length === 0) continue;
        const key = normalizeColumnLabel(label);
        const entry = byKey.get(key);
        if (entry) entry.projectCount += 1;
        else byKey.set(key, { label, projectCount: 1 });
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }

  async createEverywhere(
    workspaceId: string,
    actorUserId: string,
    rawLabel: string,
  ): Promise<BulkColumnResult> {
    await this.requireLead(workspaceId, actorUserId);
    const label = rawLabel.trim();
    const key = normalizeColumnLabel(label);
    const projects = await this.deps.projects.listByWorkspace(workspaceId);

    let affected = 0;
    const skipped: { projectId: string; name: string; reason: string }[] = [];
    for (const project of projects) {
      const settings = await this.settingsOf(project.id);
      if (this.findSlotByLabel(settings, key)) {
        skipped.push({ projectId: project.id, name: project.name, reason: 'Колонка уже есть' });
        continue;
      }
      const slot = firstFreeCustomSlot(settings);
      if (!slot) {
        skipped.push({ projectId: project.id, name: project.name, reason: 'Нет свободных слотов' });
        continue;
      }
      await this.deps.projects.setKanbanSettings(project.id, { ...settings, [slot]: { label } });
      affected += 1;
    }
    return { affected, skipped, movedTasks: 0 };
  }

  async deleteEverywhere(
    workspaceId: string,
    actorUserId: string,
    rawLabel: string,
  ): Promise<BulkColumnResult> {
    await this.requireLead(workspaceId, actorUserId);
    const key = normalizeColumnLabel(rawLabel);
    const projects = await this.deps.projects.listByWorkspace(workspaceId);

    let affected = 0;
    let movedTasks = 0;
    for (const project of projects) {
      const settings = await this.settingsOf(project.id);
      const slot = this.findSlotByLabel(settings, key);
      if (!slot) continue; // колонки с таким названием тут нет — это не ошибка
      // Порядок как в ManageKanbanColumns.delete: сначала задачи, потом гасим слот.
      movedTasks += await this.deps.tasks.bulkChangeStatus([project.id], slot, FALLBACK_STATUS);
      const next: KanbanBoardSettings = { ...settings };
      delete next[slot];
      await this.deps.projects.setKanbanSettings(project.id, next);
      affected += 1;
    }
    return { affected, skipped: [], movedTasks };
  }

  private async settingsOf(projectId: string): Promise<KanbanBoardSettings> {
    return (await this.deps.projects.getKanbanSettings(projectId)) ?? {};
  }

  private findSlotByLabel(
    settings: KanbanBoardSettings,
    normalizedLabel: string,
  ): CustomKanbanSlot | null {
    return (
      activeCustomSlots(settings).find(
        (slot) => normalizeColumnLabel(settings[slot]?.label ?? '') === normalizedLabel,
      ) ?? null
    );
  }

  // Массовая правка досок всей команды — право уровня приёмки/воркера (lead или owner).
  private async requireLead(workspaceId: string, actorUserId: string): Promise<void> {
    const member = await requireWorkspaceMember(this.deps.workspaces, workspaceId, actorUserId);
    if (member.role !== 'owner' && member.role !== 'lead') throw new NotWorkspaceOwnerError();
  }
}
