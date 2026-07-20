import type { ActivityKind, ActivityPayload } from '../../domain/activity/ActivityEvent.js';
import type { TaskPriority, TaskStatus } from '../../domain/task/Task.js';
import type { WebhookEvent } from '../../domain/integrations/ProjectWebhook.js';
import {
  MAX_CASCADE_DEPTH,
  MAX_CONSECUTIVE_FIRES,
  triggerMatchesEvent,
  type WorkflowAction,
  type WorkflowEvent,
  type WorkflowRule,
} from '../../domain/automation/WorkflowRule.js';
import { ActivityRecorder, type RecordInput } from '../activity/ActivityRecorder.js';
import { WebhookDispatchingActivityRecorder } from '../integrations/DispatchWebhook.js';
import type { ProjectWorkflowRepository } from './ManageWorkflows.js';

// Контекст исполнения действия: к какой задаче относится сработавшее событие (null для
// событий без задачи, напр. входящий вебхук). Действию НЕ передаётся содержимое записей —
// только id: замкнутый набор действий не вычисляет ничего над данными (раздел 4 плана).
export type WorkflowActionContext = {
  readonly taskId: string | null;
};

// Порт исполнителя действия. Возвращает доменное событие-следствие (для каскада) или null,
// если действие не порождает нового события. Замкнутый набор ТЕКУЩИХ действий (delegate /
// set_priority / send_telegram / trigger_webhook) не порождает событий, совпадающих с
// каким-либо триггером (нет действия «создать задачу» или «сменить статус»), поэтому
// самоцикл сейчас невозможен ПО ПОСТРОЕНИЮ. Возврат события оставлен как сейм для будущих
// действий; защита от каскада (ниже) — обязательная страховка на этот случай.
export interface WorkflowActionRunner {
  run(
    projectId: string,
    action: WorkflowAction,
    context: WorkflowActionContext,
  ): Promise<WorkflowEvent | null>;
}

type Deps = {
  readonly workflows: ProjectWorkflowRepository;
  readonly runner: WorkflowActionRunner;
  readonly now?: () => Date;
};

// Состояние одного каскада (от одного корневого события). depth — текущая глубина цепочки;
// fires — сколько раз каждое правило уже сработало в этом каскаде (ключ — id правила).
type Cascade = {
  depth: number;
  readonly fires: Map<string, number>;
};

// Извлечь id задачи из события исполнения (для контекста действия).
function eventTaskId(event: WorkflowEvent): string | null {
  return event.kind === 'webhook_received' ? null : event.taskId;
}

// Движок правил «событие → действие». НЕ общий workflow-движок: сопоставляет тип события с
// замкнутым триггером и запускает замкнутое действие. Вся защита от зацикливания — здесь.
export class RunWorkflow {
  constructor(private readonly deps: Deps) {}

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  // Внешний вход: одно событие проекта запускает свежий каскад (глубина 0, пустой счётчик).
  async handle(projectId: string, event: WorkflowEvent): Promise<void> {
    await this.dispatch(projectId, event, { depth: 0, fires: new Map() });
  }

  // Раскрутка одного события внутри каскада. Обрыв по глубине — жёсткий потолок на случай
  // цепочки РАЗНЫХ правил (A→B→A…), где по-правильный счётчик у каждого мал, а суммарная
  // цепь глубока (раздел 4 плана, риск зацикливания).
  private async dispatch(projectId: string, event: WorkflowEvent, cascade: Cascade): Promise<void> {
    if (cascade.depth > MAX_CASCADE_DEPTH) return;
    let rules: readonly WorkflowRule[];
    try {
      rules = await this.deps.workflows.listByProject(projectId);
    } catch {
      return; // чтение правил не должно ронять исходную операцию (best-effort)
    }
    const matched = rules.filter((r) => r.enabled && triggerMatchesEvent(r.trigger, event));
    for (const rule of matched) {
      await this.fireRule(projectId, rule, event, cascade);
    }
  }

  private async fireRule(
    projectId: string,
    rule: WorkflowRule,
    event: WorkflowEvent,
    cascade: Cascade,
  ): Promise<void> {
    const fires = (cascade.fires.get(rule.id) ?? 0) + 1;
    cascade.fires.set(rule.id, fires);
    // Зацикливание: правило порождает событие, запускающее себя же. После MAX_CONSECUTIVE_FIRES
    // срабатываний подряд из ОДНОГО корня гасим правило (enabled → false) и не исполняем.
    if (fires > MAX_CONSECUTIVE_FIRES) {
      try {
        await this.deps.workflows.setEnabled(rule.id, false);
      } catch {
        /* гашение best-effort: даже если запись не удалась, дальше по каскаду не идём */
      }
      await this.recordRun(rule.id, 'disabled:cascade');
      return;
    }

    let follow: WorkflowEvent | null;
    try {
      follow = await this.deps.runner.run(projectId, rule.action, { taskId: eventTaskId(event) });
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 48) : 'unknown';
      await this.recordRun(rule.id, `error:${reason}`);
      return; // при ошибке действия каскад по этой ветке не продолжаем
    }
    await this.recordRun(rule.id, 'ok');

    // Событие-следствие продолжает каскад глубже — под тем же счётчиком fires (один корень).
    if (follow) {
      await this.dispatch(projectId, follow, { depth: cascade.depth + 1, fires: cascade.fires });
    }
  }

  private async recordRun(ruleId: string, status: string): Promise<void> {
    try {
      await this.deps.workflows.recordRun(ruleId, status, this.clock().toISOString());
    } catch {
      /* журнал вторичен */
    }
  }
}

// Исполнитель действий через инъецированные эффекты (реальные сервисы задаются в index.ts).
// Каждый эффект опционален: не сконфигурированный эффект — no-op (действие тихо пропускается),
// чтобы движок оставался рабочим в тестовом окружении без Telegram/задач.
export type WorkflowEffects = {
  readonly delegate?: (projectId: string, taskId: string, assigneeUserId: string) => Promise<void>;
  readonly setPriority?: (projectId: string, taskId: string, priority: TaskPriority) => Promise<void>;
  // taskId — задача сработавшего события (null для событий без задачи, напр. входящего вебхука).
  // Позволяет адресную доставку ответственному по задаче; при null эффект решает сам (no-op/группа).
  readonly sendTelegram?: (projectId: string, message: string, taskId: string | null) => Promise<void>;
  readonly triggerWebhook?: (projectId: string, event: WebhookEvent) => Promise<void>;
};

export class EffectWorkflowActionRunner implements WorkflowActionRunner {
  constructor(private readonly effects: WorkflowEffects) {}

  async run(
    projectId: string,
    action: WorkflowAction,
    context: WorkflowActionContext,
  ): Promise<WorkflowEvent | null> {
    switch (action.type) {
      case 'delegate':
        if (context.taskId && this.effects.delegate) {
          await this.effects.delegate(projectId, context.taskId, action.assigneeUserId);
        }
        return null;
      case 'set_priority':
        if (context.taskId && this.effects.setPriority) {
          await this.effects.setPriority(projectId, context.taskId, action.priority);
        }
        return null;
      case 'send_telegram':
        if (this.effects.sendTelegram) {
          await this.effects.sendTelegram(projectId, action.message, context.taskId);
        }
        return null;
      case 'trigger_webhook':
        if (this.effects.triggerWebhook) await this.effects.triggerWebhook(projectId, action.event);
        return null;
    }
  }
}

// Маппинг вида действия ленты в событие исполнения workflow. null — событие не транслируется
// в правила. Статусы берём из payload (task_status_changed.newStatus). Замкнутый список.
export function activityKindToWorkflowEvent(
  kind: ActivityKind,
  payload: ActivityPayload | null,
): WorkflowEvent | null {
  switch (kind) {
    case 'task_created':
      return { kind: 'task_created', taskId: payload?.taskId ?? null };
    case 'task_status_changed': {
      const status = payload?.newStatus;
      if (!status) return null;
      return { kind: 'task_status_changed', taskId: payload?.taskId ?? null, status: status as TaskStatus };
    }
    default:
      return null;
  }
}

// Декоратор ленты: после записи события (и фан-аута вебхуков базового класса) запускает
// правила workflow. Наследуем WebhookDispatchingActivityRecorder, а не ActivityRecorder,
// чтобы СОХРАНИТЬ доставку вебхуков среза 6 и добавить workflow одним звеном — так «задача →
// done ⇒ сообщение в Telegram» достигается через wiring, без правки MoveTask и мест инъекции.
export class WorkflowDispatchingActivityRecorder extends WebhookDispatchingActivityRecorder {
  constructor(
    deps: ConstructorParameters<typeof ActivityRecorder>[0],
    dispatchWebhook: ConstructorParameters<typeof WebhookDispatchingActivityRecorder>[1],
    private readonly runWorkflow: RunWorkflow,
  ) {
    super(deps, dispatchWebhook);
  }

  override async record(input: RecordInput): Promise<void> {
    await super.record(input);
    const event = activityKindToWorkflowEvent(input.kind, input.payload ?? null);
    if (!event) return;
    // Полностью best-effort и вне критического пути: не ждём и не роняем основную операцию.
    void this.runWorkflow.handle(input.projectId, event).catch(() => {});
  }
}
