import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { AiAction, AiActionPlan, AiAffectedEntity } from '@/domain/ai-action/AiAction';
import { aiActionProjectTarget } from '@/domain/ai-action/AiAction';
import { classifyAiActionPlan } from '@/application/ai-action/classifyAiActionPlan';
import type { DestructiveTarget } from '@/application/ai-action/ResolveDestructiveTargets';
import { AiDestructiveReviewCard, pluralizeTasks } from './AiDestructiveReviewCard';
import { AiActionResultCard, type AiActionOutcome } from './AiActionResultCard';

export type { AiAction, AiActionPlan } from '@/domain/ai-action/AiAction';

const ACTION_BLOCK = /```projectsflow-actions\s*([\s\S]*?)```/iu;
const STATUSES = new Set<TaskStatus>(['backlog', 'todo', 'in_progress', 'awaiting_clarification', 'done', 'manual']);
const STORAGE_PREFIX = 'pf-ai-action-plan:';

type UndoEntry = { projectId: string; undo: () => Promise<void> };
type Phase = 'running' | 'review' | 'result';

// Журнал применения плана. Живёт в localStorage, потому что карточка перерисовывается
// на каждый рендер истории: без него F5 или переключение чата запускали бы уже
// выполненный план заново (действия исполняет клиент, серверного батча пока нет).
type StoredRecord = {
  version: 1;
  autoDone: number;
  autoFailed: number;
  created: AiAffectedEntity[];
  refs: Record<string, string>;
  review: 'none' | 'pending' | 'applied' | 'rejected';
  affected: AiAffectedEntity[];
};

// Один и тот же план не должен исполниться дважды из-за StrictMode/двойного монтирования
// до того, как запись доедет до localStorage.
const inFlight = new Set<string>();

export function extractAiActionPlan(body: string): { text: string; plan: AiActionPlan | null } {
  const match = ACTION_BLOCK.exec(body);
  if (!match) return { text: body, plan: null };
  try {
    const candidate = JSON.parse(match[1] ?? '') as unknown;
    const plan = normalizePlan(candidate);
    if (!plan) return { text: body, plan: null };
    return { text: body.replace(match[0], '').trim(), plan };
  } catch {
    return { text: body, plan: null };
  }
}

function normalizePlan(value: unknown): AiActionPlan | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { title?: unknown; summary?: unknown; actions?: unknown };
  if (!Array.isArray(raw.actions) || raw.actions.length === 0 || raw.actions.length > 200) return null;
  const actions = raw.actions.map(normalizeAction).filter((item): item is AiAction => item !== null);
  if (actions.length !== raw.actions.length) return null;
  if (new Set(actions.map((action) => action.id)).size !== actions.length) return null;
  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 180) : 'Предложенные действия',
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 600) : undefined,
    actions,
  };
}

function normalizeAction(value: unknown): AiAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim().slice(0, 80) : '';
  if (!id) return null;
  const project = {
    projectId: typeof raw['projectId'] === 'string' ? raw['projectId'] : undefined,
    projectRef: typeof raw['projectRef'] === 'string' ? raw['projectRef'] : undefined,
  };
  if (raw['type'] === 'create_project' && typeof raw['name'] === 'string' && raw['name'].trim()) return { id, type: 'create_project', name: raw['name'].trim().slice(0, 200) };
  if (raw['type'] === 'create_task' && typeof raw['description'] === 'string' && raw['description'].trim()) return {
    ...project, id, type: 'create_task', description: raw['description'].trim().slice(0, 20_000),
    status: isStatus(raw['status']) ? raw['status'] : undefined,
    deadline: typeof raw['deadline'] === 'string' || raw['deadline'] === null ? raw['deadline'] : undefined,
    priority: isPriority(raw['priority']) || raw['priority'] === null ? raw['priority'] : undefined,
    assigneeUserId: typeof raw['assigneeUserId'] === 'string' ? raw['assigneeUserId'] : undefined,
  };
  if (raw['type'] === 'update_task' && typeof raw['taskId'] === 'string') return {
    ...project, id, type: 'update_task', taskId: raw['taskId'],
    description: typeof raw['description'] === 'string' ? raw['description'].slice(0, 20_000) : undefined,
    status: isStatus(raw['status']) ? raw['status'] : undefined,
    deadline: typeof raw['deadline'] === 'string' || raw['deadline'] === null ? raw['deadline'] : undefined,
    priority: isPriority(raw['priority']) || raw['priority'] === null ? raw['priority'] : undefined,
  };
  if (raw['type'] === 'delete_task' && typeof raw['taskId'] === 'string') return { ...project, id, type: 'delete_task', taskId: raw['taskId'] };
  if (raw['type'] === 'delete_all_tasks') return { ...project, id, type: 'delete_all_tasks' };
  return null;
}

function isStatus(value: unknown): value is TaskStatus { return typeof value === 'string' && STATUSES.has(value as TaskStatus); }
function isPriority(value: unknown): value is TaskPriority { return value === 1 || value === 2 || value === 3 || value === 4; }

export function AiActionPlanCard({ plan, defaultProjectId, messageId }: { plan: AiActionPlan; defaultProjectId?: string; messageId?: string }): React.ReactElement | null {
  const { projectRepository, taskRepository, resolveDestructiveTargets } = useContainer();
  const { user } = useCurrentUser();
  const classification = useMemo(() => classifyAiActionPlan(plan), [plan]);
  const storageKey = useMemo(() => STORAGE_PREFIX + (messageId ?? planFingerprint(plan)), [messageId, plan]);

  // Журнал читается синхронно при первом рендере: иначе уже применённый план
  // мигал бы «Применяю действия…» на каждом рендере истории.
  const stored = useMemo(() => readRecord(storageKey), [storageKey]);
  const [phase, setPhase] = useState<Phase>(storedPhase(stored));
  const [record, setRecord] = useState<StoredRecord | null>(stored);
  const [affected, setAffected] = useState<readonly AiAffectedEntity[]>(stored?.affected ?? []);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undoing, setUndoing] = useState(false);
  // Журнал отката живёт только в этой вкладке: после перезагрузки откатывать нечем,
  // поэтому доступность кнопки — состояние, а не длина ref'а.
  const [canUndo, setCanUndo] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<AiActionOutcome>(stored?.review === 'rejected' ? 'rejected' : 'applied');
  const journalRef = useRef<UndoEntry[]>([]);
  const refsRef = useRef<Map<string, string>>(new Map(Object.entries(stored?.refs ?? {})));

  const persist = (next: StoredRecord): void => {
    setRecord(next);
    writeRecord(storageKey, next);
  };

  const resolveProject = (action: AiAction): string => {
    const target = aiActionProjectTarget(action);
    const value = target.projectId ?? (target.projectRef ? refsRef.current.get(target.projectRef) : undefined) ?? defaultProjectId;
    if (!value) throw new Error('Не указан проект для действия');
    return value;
  };

  // Стадия 1: неразрушительные действия применяются молча, сразу при появлении плана.
  useEffect(() => {
    if (!user || stored) return;
    if (inFlight.has(storageKey)) return;
    inFlight.add(storageKey);
    void (async () => {
      try {
        const result = await applySafeActions();
        persist(result);
        setCanUndo(journalRef.current.length > 0);
        setPhase(classification.requiresReview ? 'review' : 'result');
      } finally {
        inFlight.delete(storageKey);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- план и ключ неизменны для смонтированного сообщения; перезапуск по смене user/repo привёл бы к повторному исполнению
  }, [storageKey, user?.id]);

  // Стадия 2: список объектов под удаление резолвится ДО решения пользователя.
  useEffect(() => {
    if (phase !== 'review' || affected.length > 0) return;
    setResolving(true);
    void (async () => {
      try {
        const targets: DestructiveTarget[] = classification.reviewActions.map((action) => ({ action, projectId: resolveProject(action) }));
        setAffected(await resolveDestructiveTargets.execute(targets));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Не удалось собрать список задач');
      } finally {
        setResolving(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- резолв делаем один раз на вход в review
  }, [phase]);

  const applySafeActions = async (): Promise<StoredRecord> => {
    const created: AiAffectedEntity[] = [];
    let failed = 0;
    for (const action of classification.autoActions) {
      try {
        if (action.type === 'create_project') {
          const project = await projectRepository.create({ name: action.name });
          refsRef.current.set(action.id, project.id);
          journalRef.current.push({ projectId: project.id, undo: () => projectRepository.delete(project.id) });
          created.push({ actionId: action.id, kind: 'project', projectId: project.id, entityId: project.id, title: `Проект «${action.name}»` });
          announceProjectChange(project.id);
        } else if (action.type === 'create_task') {
          const projectId = resolveProject(action);
          const task = await taskRepository.create(projectId, {
            description: action.description,
            status: action.status ?? 'todo',
            deadline: action.deadline,
            priority: action.priority,
            assigneeUserId: action.assigneeUserId ?? user?.id ?? '',
          });
          journalRef.current.push({ projectId, undo: () => taskRepository.delete(projectId, task.id) });
          created.push({ actionId: action.id, kind: 'task', projectId, entityId: task.id, title: firstLine(action.description) });
          announceProjectChange(projectId, task.id);
        } else if (action.type === 'update_task') {
          const projectId = resolveProject(action);
          const before = (await taskRepository.list(projectId)).find((task) => task.id === action.taskId);
          if (!before) throw new Error('Задача не найдена или уже удалена');
          await taskRepository.update(projectId, action.taskId, { description: action.description, deadline: action.deadline, priority: action.priority });
          if (action.status && action.status !== before.status) await taskRepository.move(projectId, action.taskId, { targetStatus: action.status, beforeTaskId: null, afterTaskId: null });
          journalRef.current.push({ projectId, undo: async () => {
            await taskRepository.update(projectId, before.id, { description: before.description ?? '', deadline: before.deadline, priority: before.priority });
            if (action.status && before.status !== action.status) await taskRepository.move(projectId, before.id, { targetStatus: before.status, beforeTaskId: null, afterTaskId: null });
          } });
          created.push({ actionId: action.id, kind: 'task', projectId, entityId: action.taskId, title: firstLine(action.description ?? before.description ?? '') });
          announceProjectChange(projectId);
        }
      } catch {
        failed += 1;
      }
    }
    return {
      version: 1,
      autoDone: created.length,
      autoFailed: failed,
      created,
      refs: Object.fromEntries(refsRef.current),
      review: classification.requiresReview ? 'pending' : 'none',
      affected: [],
    };
  };

  const confirmDestructive = async (): Promise<void> => {
    if (busy || !record) return;
    setBusy(true);
    setError(undefined);
    const removed: AiAffectedEntity[] = [];
    try {
      for (const action of classification.reviewActions) {
        const projectId = resolveProject(action);
        const targets = affected.filter((entity) => entity.actionId === action.id);
        const snapshots = await taskRepository.list(projectId);
        for (const entity of targets) {
          const before = snapshots.find((task) => task.id === entity.entityId);
          if (!before) continue;
          await taskRepository.delete(projectId, entity.entityId);
          journalRef.current.push({ projectId, undo: () => restoreTask(taskRepository, before) });
          removed.push(entity);
        }
        announceProjectChange(projectId);
      }
      setOutcome('applied');
      persist({ ...record, review: 'applied', affected: removed });
      setAffected(removed);
      setCanUndo(journalRef.current.length > 0);
      setPhase('result');
      toast.success(`Удалено ${removed.length} ${pluralizeTasks(removed.length)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выполнить удаление');
    } finally {
      setBusy(false);
    }
  };

  const reject = (): void => {
    if (busy || !record) return;
    setOutcome('rejected');
    persist({ ...record, review: 'rejected', affected: [] });
    setAffected([]);
    setPhase('result');
  };

  const undo = async (): Promise<void> => {
    if (undoing || journalRef.current.length === 0) return;
    setUndoing(true);
    let undone = 0;
    for (const entry of [...journalRef.current].reverse()) {
      try {
        await entry.undo();
        announceProjectChange(entry.projectId);
        undone += 1;
      } catch { /* остальные независимые операции всё равно откатываем */ }
    }
    journalRef.current = [];
    setCanUndo(false);
    setUndoing(false);
    toast.success(`Отменено действий: ${undone}`);
    setAffected([]);
  };

  if (!user) return null;

  if (phase === 'running') {
    return (
      <section className="not-prose mt-3 flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-xs text-muted-foreground" aria-label={plan.title}>
        <Loader2 className="size-3.5 animate-spin" />
        Применяю действия…
      </section>
    );
  }

  if (phase === 'review') {
    return (
      <AiDestructiveReviewCard
        entities={affected}
        loading={resolving}
        busy={busy}
        error={error}
        onReject={reject}
        onConfirm={() => void confirmDestructive()}
      />
    );
  }

  const summary = record ? resultSummary(record, outcome) : plan.title;
  const listed = outcome === 'rejected' ? (record?.created ?? []) : [...(record?.created ?? []), ...affected];
  return (
    <AiActionResultCard
      outcome={outcome}
      title={summary}
      entities={listed}
      undoing={undoing}
      canUndo={canUndo}
      onUndo={() => void undo()}
    />
  );
}

function storedPhase(stored: StoredRecord | null): Phase {
  if (!stored) return 'running';
  return stored.review === 'pending' ? 'review' : 'result';
}

function resultSummary(record: StoredRecord, outcome: AiActionOutcome): string {
  const parts: string[] = [];
  if (record.autoDone > 0) parts.push(`Выполнено действий: ${record.autoDone}`);
  if (record.autoFailed > 0) parts.push(`не удалось: ${record.autoFailed}`);
  if (outcome === 'rejected') parts.push('удаление отклонено — ничего не удалено');
  else if (record.review === 'applied') parts.push(`удалено ${record.affected.length} ${pluralizeTasks(record.affected.length)}`);
  return parts.length > 0 ? capitalize(parts.join(', ')) : 'Изменений не потребовалось';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function firstLine(value: string): string {
  return value.split('\n')[0]?.trim() || 'Без названия';
}

// Отпечаток плана нужен только когда сообщение ещё не имеет id (оптимистичный рендер):
// иначе журнал применения привязывается к идентификатору сообщения.
function planFingerprint(plan: AiActionPlan): string {
  const source = JSON.stringify(plan);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }
  return `fp${(hash >>> 0).toString(36)}`;
}

function readRecord(key: string): StoredRecord | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRecord;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeRecord(key: string, record: StoredRecord): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
  } catch { /* приватный режим/переполненное хранилище — журнал не критичен для рендера */ }
}

async function restoreTask(repository: ReturnType<typeof useContainer>['taskRepository'], task: Task): Promise<void> {
  await repository.create(task.projectId, {
    description: task.description ?? '', icon: task.icon, cover: task.cover, coverPosition: task.coverPosition,
    status: task.status, ralphMode: task.ralphMode, assigneeUserId: task.assignee.userId,
    deadline: task.deadline, startDate: task.startDate, parentTaskId: task.parentTaskId, priority: task.priority,
  });
}

function announceProjectChange(projectId: string, createdTaskId?: string): void {
  const detail = { projectId };
  window.dispatchEvent(new CustomEvent('pf:project-changed', { detail }));
  window.dispatchEvent(new CustomEvent('pf:task-changed', { detail }));
  window.dispatchEvent(new CustomEvent('pf:project-activity-changed', { detail }));
  if (createdTaskId) {
    window.dispatchEvent(new CustomEvent('pf:task-created', { detail: { projectId, taskId: createdTaskId } }));
  }
}
