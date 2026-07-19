import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import type { TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { AiAction, AiActionPlan } from '@/domain/ai-action/AiAction';
import { aiActionProjectTarget } from '@/domain/ai-action/AiAction';
import type { AiActionBatch, AiActionBatchStatus } from '@/domain/ai-action/AiActionBatch';
import { canUndoAiActionBatch } from '@/domain/ai-action/AiActionBatch';
import type { AiActionBatchResult } from '@/application/ai-action/AiActionBatchRepository';
import {
  batchDestructiveEntities,
  batchListedEntities,
  batchOutcome,
  buildBatchPlanItems,
  isDestructiveBatchItemType,
  summarizeBatch,
} from '@/application/ai-action/aiActionBatchPlan';
import { classifyAiActionPlan } from '@/application/ai-action/classifyAiActionPlan';
import type { DestructiveTarget } from '@/application/ai-action/ResolveDestructiveTargets';
import { AiDestructiveReviewCard, pluralizeTasks } from './AiDestructiveReviewCard';
import { AiActionResultCard, type AiActionOutcome } from './AiActionResultCard';

export type { AiAction, AiActionPlan } from '@/domain/ai-action/AiAction';

const ACTION_BLOCK = /```projectsflow-actions\s*([\s\S]*?)```/iu;
const STATUSES = new Set<TaskStatus>(['backlog', 'todo', 'in_progress', 'awaiting_clarification', 'done', 'manual']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// Один и тот же план не должен уйти на сервер дважды из-за StrictMode/двойного
// монтирования до того, как вернётся ответ create. Серверная идемпотентность всё равно
// поймает дубль, но лишний круглый рейс и мигание карточки нам не нужны.
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

export function AiActionPlanCard({
  plan,
  defaultProjectId,
  messageId,
  conversationId,
  onBatchStatusChange,
}: {
  plan: AiActionPlan;
  defaultProjectId?: string;
  messageId?: string;
  conversationId?: string;
  // Нужен блоку шагов: «Требуется подтверждение» стоит НАД телом ответа, а карточка
  // подтверждения — под ним, поэтому статус приходится поднимать в сообщение.
  onBatchStatusChange?: (status: AiActionBatchStatus | null) => void;
}): React.ReactElement | null {
  const { projectRepository, taskRepository, resolveDestructiveTargets, aiActionBatchRepository } = useContainer();
  const { user } = useCurrentUser();
  const classification = useMemo(() => classifyAiActionPlan(plan), [plan]);
  // Ключ идемпотентности: id сообщения. Отпечаток плана — запасной вариант для
  // оптимистичного рендера, когда сообщение ещё не получило серверный id.
  const idempotencyKey = useMemo(
    () => (messageId && UUID.test(messageId) ? messageId : planFingerprint(plan)),
    [messageId, plan],
  );

  const [batch, setBatch] = useState<AiActionBatch | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const refsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    onBatchStatusChange?.(batch?.status ?? null);
  }, [batch?.status, onBatchStatusChange]);

  const resolveProject = (action: AiAction): string => {
    const target = aiActionProjectTarget(action);
    const value = target.projectId ?? (target.projectRef ? refsRef.current.get(target.projectRef) : undefined) ?? defaultProjectId;
    if (!value) throw new Error('Не указан проект для действия');
    return value;
  };

  const resolveProjectOrNull = (action: AiAction): string | null => {
    try { return resolveProject(action); } catch { return null; }
  };

  // Единственная точка входа: сначала журналируем план на сервере, и только если сервер
  // ответил «этот батч новый», исполняем действия. Раньше эту роль играл localStorage —
  // он не переживал приватный режим, другое устройство и очистку хранилища.
  useEffect(() => {
    if (!user || !conversationId) return;
    if (inFlight.has(idempotencyKey)) return;
    inFlight.add(idempotencyKey);
    void (async () => {
      try {
        // Список объектов под удаление резолвится ДО создания батча: только так каждая
        // удаляемая задача получает собственную строку журнала и, значит, собственный откат.
        const targets: DestructiveTarget[] = classification.reviewActions.map((action) => ({
          action, projectId: resolveProject(action),
        }));
        const affected = targets.length > 0 ? await resolveDestructiveTargets.execute(targets) : [];

        const created = await aiActionBatchRepository.create({
          conversationId,
          messageId: messageId && UUID.test(messageId) ? messageId : null,
          idempotencyKey,
          title: plan.title,
          projectId: defaultProjectId ?? null,
          items: buildBatchPlanItems(classification.autoActions, affected, resolveProjectOrNull),
        });
        setBatch(created.batch);

        if (created.replayed || classification.autoActions.length === 0) return;
        const results = await applySafeActions();
        setBatch(await aiActionBatchRepository.recordResults(created.batch.id, results));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Не удалось выполнить действия');
      } finally {
        inFlight.delete(idempotencyKey);
        setPreparing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- план и ключ неизменны для смонтированного сообщения; перезапуск по смене user/repo привёл бы к повторному исполнению
  }, [idempotencyKey, conversationId, user?.id]);

  const applySafeActions = async (): Promise<AiActionBatchResult[]> => {
    const results: AiActionBatchResult[] = [];
    for (const action of classification.autoActions) {
      try {
        if (action.type === 'create_project') {
          const project = await projectRepository.create({ name: action.name });
          refsRef.current.set(action.id, project.id);
          results.push({ actionId: action.id, entityId: project.id, projectId: null, status: 'done' });
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
          results.push({ actionId: action.id, entityId: task.id, projectId, status: 'done' });
          announceProjectChange(projectId, task.id);
        } else if (action.type === 'update_task') {
          const projectId = resolveProject(action);
          const before = (await taskRepository.list(projectId)).find((task) => task.id === action.taskId);
          if (!before) throw new Error('Задача не найдена или уже удалена');
          await taskRepository.update(projectId, action.taskId, { description: action.description, deadline: action.deadline, priority: action.priority });
          if (action.status && action.status !== before.status) await taskRepository.move(projectId, action.taskId, { targetStatus: action.status, beforeTaskId: null, afterTaskId: null });
          results.push({
            actionId: action.id,
            entityId: action.taskId,
            projectId,
            status: 'done',
            // Снимок уезжает на сервер — благодаря ему откат правки работает и после F5,
            // и из другой вкладки.
            before: {
              description: before.description ?? '',
              status: before.status,
              deadline: before.deadline ?? null,
              priority: before.priority ?? null,
            },
          });
          announceProjectChange(projectId);
        }
      } catch (cause) {
        results.push({
          actionId: action.id,
          entityId: null,
          projectId: resolveProjectOrNull(action),
          status: 'failed',
          errorMessage: cause instanceof Error ? cause.message : 'Действие не выполнено',
        });
      }
    }
    return results;
  };

  const confirmDestructive = async (): Promise<void> => {
    if (busy || !batch) return;
    setBusy(true);
    setError(undefined);
    try {
      const results: AiActionBatchResult[] = [];
      const touched = new Set<string>();
      for (const item of batch.items) {
        if (!isDestructiveBatchItemType(item.type) || !item.entityId || !item.projectId) continue;
        try {
          await taskRepository.delete(item.projectId, item.entityId);
          results.push({ actionId: item.actionId, entityId: item.entityId, projectId: item.projectId, status: 'done' });
        } catch (cause) {
          results.push({
            actionId: item.actionId, entityId: item.entityId, projectId: item.projectId, status: 'failed',
            errorMessage: cause instanceof Error ? cause.message : 'Не удалось удалить задачу',
          });
        }
        touched.add(item.projectId);
      }
      const applied = await aiActionBatchRepository.apply(batch.id, results);
      setBatch(applied);
      for (const projectId of touched) announceProjectChange(projectId);
      const removed = results.filter((item) => item.status === 'done').length;
      toast.success(`Удалено ${removed} ${pluralizeTasks(removed)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выполнить удаление');
    } finally {
      setBusy(false);
    }
  };

  const reject = async (): Promise<void> => {
    if (busy || !batch) return;
    setBusy(true);
    try {
      setBatch(await aiActionBatchRepository.reject(batch.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отклонить действия');
    } finally {
      setBusy(false);
    }
  };

  // Откат целиком серверный: он опирается на entity id и before-снимки в журнале, а не
  // на замыкания этой вкладки, поэтому доступен и после перезагрузки.
  const undo = async (): Promise<void> => {
    if (undoing || !batch) return;
    setUndoing(true);
    try {
      const touched = new Set(batch.items.flatMap((item) => (item.projectId ? [item.projectId] : [])));
      const undone = await aiActionBatchRepository.undo(batch.id);
      setBatch(undone);
      for (const projectId of touched) announceProjectChange(projectId);
      const count = undone.items.filter((item) => item.status === 'undone').length;
      toast.success(`Отменено действий: ${count}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось отменить действия');
    } finally {
      setUndoing(false);
    }
  };

  if (!user) return null;

  if (!batch || (preparing && batch.status !== 'pending_review')) {
    return (
      <section className="not-prose mt-3 flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-xs text-muted-foreground" aria-label={plan.title}>
        {error ? error : <><Loader2 className="size-3.5 animate-spin" />Применяю действия…</>}
      </section>
    );
  }

  if (batch.status === 'pending_review') {
    return (
      <AiDestructiveReviewCard
        entities={batchDestructiveEntities(batch)}
        loading={preparing}
        busy={busy}
        error={error}
        onReject={() => void reject()}
        onConfirm={() => void confirmDestructive()}
      />
    );
  }

  const outcome: AiActionOutcome = batchOutcome(batch.status);
  return (
    <AiActionResultCard
      outcome={outcome}
      title={resultSummary(batch, outcome)}
      entities={batchListedEntities(batch, outcome)}
      undoing={undoing}
      canUndo={canUndoAiActionBatch(batch)}
      onUndo={() => void undo()}
    />
  );
}

function resultSummary(batch: AiActionBatch, outcome: AiActionOutcome): string {
  if (outcome === 'undone') return 'Действия отменены';
  const counts = summarizeBatch(batch);
  const parts: string[] = [];
  if (counts.done > 0) parts.push(`Выполнено действий: ${counts.done}`);
  if (counts.failed > 0) parts.push(`не удалось: ${counts.failed}`);
  if (outcome === 'rejected') parts.push('удаление отклонено — ничего не удалено');
  else if (counts.removed > 0) parts.push(`удалено ${counts.removed} ${pluralizeTasks(counts.removed)}`);
  return parts.length > 0 ? capitalize(parts.join(', ')) : 'Изменений не потребовалось';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Отпечаток плана нужен только когда сообщение ещё не имеет серверного id
// (оптимистичный рендер): иначе ключ идемпотентности — сам id сообщения.
function planFingerprint(plan: AiActionPlan): string {
  const source = JSON.stringify(plan);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }
  return `fp${(hash >>> 0).toString(36)}`;
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
