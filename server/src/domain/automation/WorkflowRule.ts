// Домен правил «событие → действие» проекта (db/139, срез 8 Workflows).
//
// Наша логика — НЕ общий workflow-движок, а конструктор правил над УЖЕ существующими
// сущностями (задачи, статусы, дедлайны, участники, вебхуки среза 6). Ключевое
// проектное ограничение (раздел 4 плана): и триггеры, и действия — ЗАМКНУТЫЕ наборы,
// проверяемые статически. Никаких пользовательских выражений над данными: правило не
// вычисляет ничего над содержимым записей, оно лишь сопоставляет тип события с
// фиксированным условием и запускает фиксированное действие. Это закрывает разом и класс
// оракульных атак (нет фильтров/сравнений над скрытыми колонками), и произвольный код.
//
// Чистый слой: без HTTP/DB/DOM/crypto. Парсинг/валидация здесь, побочные эффекты — в
// application (RunWorkflow) и infrastructure (репозиторий).

import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '../task/Task.js';
import { WEBHOOK_EVENTS, type WebhookEvent } from '../integrations/ProjectWebhook.js';

// === Замкнутые наборы ===

// Типы триггеров. Замкнутость — защита и стабильный контракт (раздел 4 плана).
export const WORKFLOW_TRIGGER_TYPES = [
  'task_created', // задача создана
  'task_status_changed', // задача перешла в конкретный статус
  'task_deadline_approaching', // до дедлайна задачи осталось ≤ N часов
  'webhook_received', // пришёл именованный входящий вебхук
] as const;
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

// Типы действий. delegate/set_priority меняют задачу; send_telegram/trigger_webhook — наружу.
export const WORKFLOW_ACTION_TYPES = [
  'delegate', // переназначить задачу указанному участнику
  'set_priority', // выставить приоритет задачи
  'send_telegram', // отправить фиксированный текст в Telegram проекта
  'trigger_webhook', // дёрнуть исходящий вебхук проекта (срез 6) фиксированным событием
] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

// Максимум правил на проект — граница фан-аута и злоупотребления.
export const MAX_WORKFLOWS_PER_PROJECT = 30;

// Потолок глубины каскада: одно срабатывание порождает событие, которое запускает
// следующее правило, и т.д. Глубже — обрываем (раздел 4 плана, риск зацикливания).
export const MAX_CASCADE_DEPTH = 5;

// Сколько раз одно правило может сработать в пределах ОДНОГО корневого события, прежде чем
// сервер его отключит. Защита от правила, которое порождает событие, запускающее себя же:
// после 3 срабатываний подряд из одного корня правило гасится (enabled → false).
export const MAX_CONSECUTIVE_FIRES = 3;

// Верхняя граница длины произвольного текста сообщения в Telegram. Это ЗАРАНЕЕ заданный
// пользователем статический текст, а НЕ выражение над данными записи — интерполяции нет.
export const MAX_TELEGRAM_MESSAGE_LEN = 1000;

// === Триггеры (discriminated union по type) ===

export type WorkflowTrigger =
  | { readonly type: 'task_created' }
  | { readonly type: 'task_status_changed'; readonly status: TaskStatus }
  // hoursBefore: за сколько часов до дедлайна правило считается активным (1..168).
  | { readonly type: 'task_deadline_approaching'; readonly hoursBefore: number }
  // key: имя входящего вебхука (замкнуто валидацией по длине/алфавиту, не выражение).
  | { readonly type: 'webhook_received'; readonly key: string };

// === Действия (discriminated union по type) ===

export type WorkflowAction =
  | { readonly type: 'delegate'; readonly assigneeUserId: string }
  | { readonly type: 'set_priority'; readonly priority: TaskPriority }
  | { readonly type: 'send_telegram'; readonly message: string }
  | { readonly type: 'trigger_webhook'; readonly event: WebhookEvent };

export type WorkflowRule = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly trigger: WorkflowTrigger;
  readonly action: WorkflowAction;
  readonly enabled: boolean;
  // Итог последнего запуска для журнала в UI ('ok' | 'skipped:max_depth' | 'error:…' | …).
  readonly lastStatus: string | null;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
};

// === Событие исполнения (runtime occurrence, вход RunWorkflow) ===
// Отделено от триггера правила: триггер — условие подписки, событие — конкретный факт.
export type WorkflowEvent =
  | { readonly kind: 'task_created'; readonly taskId: string | null }
  | { readonly kind: 'task_status_changed'; readonly taskId: string | null; readonly status: TaskStatus }
  // hoursRemaining: сколько часов осталось до дедлайна на момент проверки планировщиком.
  | { readonly kind: 'task_deadline_approaching'; readonly taskId: string | null; readonly hoursRemaining: number }
  | { readonly kind: 'webhook_received'; readonly key: string };

// === Ошибки ===

export class WorkflowRuleInvalidError extends Error {
  constructor(message = 'invalid_workflow_rule') {
    super(message);
    this.name = 'WorkflowRuleInvalidError';
  }
}

export class WorkflowRuleNotFoundError extends Error {
  constructor() {
    super('workflow_rule_not_found');
    this.name = 'WorkflowRuleNotFoundError';
  }
}

export class WorkflowLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`workflow_limit_reached:${limit}`);
    this.name = 'WorkflowLimitError';
  }
}

// === Валидаторы (статические, без сети/данных) ===

// key входящего вебхука: короткий машинный идентификатор [a-z0-9_-], 1..64. Замкнутый
// алфавит — чтобы он не превращался в произвольную строку-выражение и был безопасен в URL.
const WEBHOOK_KEY_RE = /^[a-z0-9_-]{1,64}$/;

export function normalizeWorkflowTrigger(raw: unknown): WorkflowTrigger {
  if (!raw || typeof raw !== 'object') throw new WorkflowRuleInvalidError('trigger_not_object');
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string' || !(WORKFLOW_TRIGGER_TYPES as readonly string[]).includes(type)) {
    throw new WorkflowRuleInvalidError(`unknown_trigger:${String(type)}`);
  }
  switch (type as WorkflowTriggerType) {
    case 'task_created':
      return { type: 'task_created' };
    case 'task_status_changed': {
      const status = (raw as { status?: unknown }).status;
      if (typeof status !== 'string' || !(TASK_STATUSES as readonly string[]).includes(status)) {
        throw new WorkflowRuleInvalidError('bad_status');
      }
      return { type: 'task_status_changed', status: status as TaskStatus };
    }
    case 'task_deadline_approaching': {
      const hoursBefore = (raw as { hoursBefore?: unknown }).hoursBefore;
      if (typeof hoursBefore !== 'number' || !Number.isInteger(hoursBefore) || hoursBefore < 1 || hoursBefore > 168) {
        throw new WorkflowRuleInvalidError('bad_hours_before');
      }
      return { type: 'task_deadline_approaching', hoursBefore };
    }
    case 'webhook_received': {
      const key = (raw as { key?: unknown }).key;
      if (typeof key !== 'string' || !WEBHOOK_KEY_RE.test(key)) {
        throw new WorkflowRuleInvalidError('bad_webhook_key');
      }
      return { type: 'webhook_received', key };
    }
  }
}

export function normalizeWorkflowAction(raw: unknown): WorkflowAction {
  if (!raw || typeof raw !== 'object') throw new WorkflowRuleInvalidError('action_not_object');
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string' || !(WORKFLOW_ACTION_TYPES as readonly string[]).includes(type)) {
    throw new WorkflowRuleInvalidError(`unknown_action:${String(type)}`);
  }
  switch (type as WorkflowActionType) {
    case 'delegate': {
      const assigneeUserId = (raw as { assigneeUserId?: unknown }).assigneeUserId;
      if (typeof assigneeUserId !== 'string' || !assigneeUserId.trim() || assigneeUserId.length > 64) {
        throw new WorkflowRuleInvalidError('bad_assignee');
      }
      return { type: 'delegate', assigneeUserId };
    }
    case 'set_priority': {
      const priority = (raw as { priority?: unknown }).priority;
      if (typeof priority !== 'number' || !(TASK_PRIORITIES as readonly number[]).includes(priority)) {
        throw new WorkflowRuleInvalidError('bad_priority');
      }
      return { type: 'set_priority', priority: priority as TaskPriority };
    }
    case 'send_telegram': {
      const message = (raw as { message?: unknown }).message;
      if (typeof message !== 'string') throw new WorkflowRuleInvalidError('bad_message');
      const trimmed = message.trim();
      if (!trimmed || trimmed.length > MAX_TELEGRAM_MESSAGE_LEN) {
        throw new WorkflowRuleInvalidError('bad_message');
      }
      return { type: 'send_telegram', message: trimmed };
    }
    case 'trigger_webhook': {
      const event = (raw as { event?: unknown }).event;
      if (typeof event !== 'string' || !(WEBHOOK_EVENTS as readonly string[]).includes(event)) {
        throw new WorkflowRuleInvalidError('bad_webhook_event');
      }
      return { type: 'trigger_webhook', event: event as WebhookEvent };
    }
  }
}

export function normalizeWorkflowName(raw: unknown): string {
  if (typeof raw !== 'string') throw new WorkflowRuleInvalidError('bad_name');
  const name = raw.trim();
  if (!name || name.length > 120) throw new WorkflowRuleInvalidError('bad_name');
  return name;
}

// Совпадает ли правило с конкретным событием исполнения. Только сопоставление типа и
// фиксированного поля — без каких-либо вычислений над данными записи.
export function triggerMatchesEvent(trigger: WorkflowTrigger, event: WorkflowEvent): boolean {
  switch (trigger.type) {
    case 'task_created':
      return event.kind === 'task_created';
    case 'task_status_changed':
      return event.kind === 'task_status_changed' && event.status === trigger.status;
    case 'task_deadline_approaching':
      // Срабатывает, когда до дедлайна осталось не больше порога правила.
      return event.kind === 'task_deadline_approaching' && event.hoursRemaining <= trigger.hoursBefore;
    case 'webhook_received':
      return event.kind === 'webhook_received' && event.key === trigger.key;
  }
}
