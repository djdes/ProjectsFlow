import {
  activeCustomSlots,
  firstFreeCustomSlot,
  isCustomColumnActive,
  isCustomKanbanSlot,
  type CustomKanbanSlot,
  type KanbanBoardSettings,
  type KanbanColor,
} from '../../domain/kanban/KanbanSettings.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';

// Куда переселяются задачи удаляемой колонки. «Черновики» — та же семантика, что у
// выключения воркера (db/152): задача не должна исчезнуть с доски вместе с колонкой.
const FALLBACK_STATUS = 'backlog' as const;

export class KanbanColumnLimitError extends Error {
  constructor() {
    super('Достигнут максимум кастомных колонок (5)');
    this.name = 'KanbanColumnLimitError';
  }
}

export class KanbanColumnNotFoundError extends Error {
  constructor() {
    super('Колонка не найдена');
    this.name = 'KanbanColumnNotFoundError';
  }
}

export class KanbanColumnDuplicateError extends Error {
  constructor() {
    super('Колонка с таким названием уже есть');
    this.name = 'KanbanColumnDuplicateError';
  }
}

export class KanbanColumnForbiddenError extends Error {
  constructor() {
    super('Недостаточно прав для изменения колонок доски');
    this.name = 'KanbanColumnForbiddenError';
  }
}

type Deps = {
  readonly projects: Pick<ProjectRepository, 'getKanbanSettings' | 'setKanbanSettings'>;
  readonly members: Pick<ProjectMemberRepository, 'findForProject'>;
  readonly tasks: Pick<TaskRepository, 'bulkChangeStatus'>;
};

export type CreateKanbanColumnCommand = {
  readonly projectId: string;
  readonly actorUserId: string;
  readonly label: string;
  readonly color?: KanbanColor;
  readonly position?: number;
};

export type DeleteKanbanColumnCommand = {
  readonly projectId: string;
  readonly actorUserId: string;
  readonly slot: string;
};

export type KanbanColumnResult = {
  readonly slot: CustomKanbanSlot;
  readonly settings: KanbanBoardSettings;
  // Сколько задач переселено в «Черновики» (только для удаления).
  readonly movedTasks: number;
};

// Сравнение названий колонок: без регистра и краевых пробелов. Так «Ревью» и «ревью »
// считаются одной колонкой — и при проверке дублей, и при массовых операциях (C2).
export function normalizeColumnLabel(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Создание и удаление кастомных колонок доски проекта.
 *
 * Колонка = занятый слот статуса (db/154) с непустым label в projects.kanban_settings.
 * Создание берёт первый свободный слот, удаление — освобождает слот и переселяет его
 * задачи в «Черновики» (иначе они пропали бы с доски вместе с колонкой).
 */
export class ManageKanbanColumns {
  constructor(private readonly deps: Deps) {}

  async create(cmd: CreateKanbanColumnCommand): Promise<KanbanColumnResult> {
    await this.requireEditor(cmd.projectId, cmd.actorUserId);
    const label = cmd.label.trim();
    const settings = (await this.deps.projects.getKanbanSettings(cmd.projectId)) ?? {};

    const exists = activeCustomSlots(settings).some(
      (slot) => normalizeColumnLabel(settings[slot]?.label ?? '') === normalizeColumnLabel(label),
    );
    if (exists) throw new KanbanColumnDuplicateError();

    const slot = firstFreeCustomSlot(settings);
    if (!slot) throw new KanbanColumnLimitError();

    const next: KanbanBoardSettings = {
      ...settings,
      [slot]: {
        // Слот мог остаться от удалённой колонки — старый цвет/скрытость не наследуем.
        label,
        ...(cmd.color ? { color: cmd.color } : {}),
        ...(cmd.position !== undefined ? { position: cmd.position } : {}),
      },
    };
    await this.deps.projects.setKanbanSettings(cmd.projectId, next);
    return { slot, settings: next, movedTasks: 0 };
  }

  async delete(cmd: DeleteKanbanColumnCommand): Promise<KanbanColumnResult> {
    await this.requireEditor(cmd.projectId, cmd.actorUserId);
    if (!isCustomKanbanSlot(cmd.slot)) throw new KanbanColumnNotFoundError();
    const slot = cmd.slot;
    const settings = (await this.deps.projects.getKanbanSettings(cmd.projectId)) ?? {};
    if (!isCustomColumnActive(settings[slot])) throw new KanbanColumnNotFoundError();

    // Сначала переселяем задачи, потом гасим колонку: при обратном порядке падение на
    // переносе оставило бы задачи в слоте, которого на доске уже нет.
    const movedTasks = await this.deps.tasks.bulkChangeStatus(
      [cmd.projectId],
      slot,
      FALLBACK_STATUS,
    );

    const next: KanbanBoardSettings = { ...settings };
    delete next[slot];
    await this.deps.projects.setKanbanSettings(cmd.projectId, next);
    return { slot, settings: next, movedTasks };
  }

  private async requireEditor(projectId: string, userId: string): Promise<void> {
    const membership = await this.deps.members.findForProject(projectId, userId);
    if (!membership) throw new ProjectNotFoundError();
    // Доска — общее состояние проекта: viewer её не меняет (то же правило, что у
    // PUT /kanban-settings).
    if (membership.role === 'viewer') throw new KanbanColumnForbiddenError();
  }
}
