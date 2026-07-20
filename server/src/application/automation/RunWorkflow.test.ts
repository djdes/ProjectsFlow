import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_CONSECUTIVE_FIRES,
  type WorkflowAction,
  type WorkflowEvent,
  type WorkflowRule,
  type WorkflowTrigger,
} from '../../domain/automation/WorkflowRule.js';
import type { ProjectWorkflowRepository } from './ManageWorkflows.js';
import {
  EffectWorkflowActionRunner,
  RunWorkflow,
  activityKindToWorkflowEvent,
  type WorkflowActionContext,
  type WorkflowActionRunner,
} from './RunWorkflow.js';

const PROJECT_ID = 'project-1';

// Минимальный in-memory репозиторий правил для движка.
class MemWorkflowRepo implements ProjectWorkflowRepository {
  rules: WorkflowRule[] = [];
  async listByProject(projectId: string): Promise<readonly WorkflowRule[]> {
    return this.rules.filter((r) => r.projectId === projectId);
  }
  async getById(projectId: string, id: string): Promise<WorkflowRule | null> {
    return this.rules.find((r) => r.projectId === projectId && r.id === id) ?? null;
  }
  async countByProject(projectId: string): Promise<number> {
    return this.rules.filter((r) => r.projectId === projectId).length;
  }
  async insert(rule: WorkflowRule): Promise<void> {
    this.rules.push(rule);
  }
  async update(): Promise<WorkflowRule | null> {
    return null;
  }
  async delete(): Promise<boolean> {
    return false;
  }
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx >= 0) this.rules[idx] = { ...this.rules[idx]!, enabled };
  }
  async recordRun(id: string, status: string, at: string): Promise<void> {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx >= 0) this.rules[idx] = { ...this.rules[idx]!, lastStatus: status, lastRunAt: at };
  }
}

function makeRule(
  id: string,
  trigger: WorkflowTrigger,
  action: WorkflowAction,
): WorkflowRule {
  return {
    id,
    projectId: PROJECT_ID,
    name: id,
    trigger,
    action,
    enabled: true,
    lastStatus: null,
    lastRunAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

test('правило «задача → done ⇒ Telegram» отрабатывает', async () => {
  const repo = new MemWorkflowRepo();
  repo.rules.push(
    makeRule(
      'r1',
      { type: 'task_status_changed', status: 'done' },
      { type: 'send_telegram', message: 'Готово' },
    ),
  );
  const calls: Array<{ action: WorkflowAction; ctx: WorkflowActionContext }> = [];
  const runner: WorkflowActionRunner = {
    async run(_projectId, action, ctx) {
      calls.push({ action, ctx });
      return null; // send_telegram не порождает события
    },
  };
  const engine = new RunWorkflow({ workflows: repo, runner });

  await engine.handle(PROJECT_ID, { kind: 'task_status_changed', taskId: 'task-9', status: 'done' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.action, { type: 'send_telegram', message: 'Готово' });
  assert.equal(calls[0]!.ctx.taskId, 'task-9');
  assert.equal(repo.rules[0]!.lastStatus, 'ok');
});

test('несовпадающее событие не запускает правило', async () => {
  const repo = new MemWorkflowRepo();
  repo.rules.push(
    makeRule(
      'r1',
      { type: 'task_status_changed', status: 'done' },
      { type: 'send_telegram', message: 'Готово' },
    ),
  );
  let called = 0;
  const engine = new RunWorkflow({
    workflows: repo,
    runner: {
      async run() {
        called += 1;
        return null;
      },
    },
  });

  // Другой статус — не совпадает.
  await engine.handle(PROJECT_ID, { kind: 'task_status_changed', taskId: 't', status: 'todo' });
  // Другой вид события — не совпадает.
  await engine.handle(PROJECT_ID, { kind: 'task_created', taskId: 't' });

  assert.equal(called, 0);
});

test('выключенное правило не срабатывает', async () => {
  const repo = new MemWorkflowRepo();
  const rule = makeRule(
    'r1',
    { type: 'task_created' },
    { type: 'send_telegram', message: 'x' },
  );
  repo.rules.push({ ...rule, enabled: false });
  let called = 0;
  const engine = new RunWorkflow({
    workflows: repo,
    runner: {
      async run() {
        called += 1;
        return null;
      },
    },
  });
  await engine.handle(PROJECT_ID, { kind: 'task_created', taskId: 't' });
  assert.equal(called, 0);
});

// КРИТИЧЕСКИЙ ТЕСТ (раздел 4 плана, риск зацикливания). Правило, действие которого порождает
// событие, совпадающее с его же триггером, зациклилось бы навсегда. Движок обязан оборвать
// каскад: исполнить не более MAX_CONSECUTIVE_FIRES раз из одного корня, затем ПОГАСИТЬ правило.
test('каскад обрывается после 3 срабатываний и гасит правило', async () => {
  const repo = new MemWorkflowRepo();
  repo.rules.push(
    makeRule(
      'loop',
      { type: 'task_status_changed', status: 'done' },
      // Действие условно возвращает то же событие (симуляция будущего действия, меняющего статус).
      { type: 'set_priority', priority: 1 },
    ),
  );
  let runs = 0;
  const loopingRunner: WorkflowActionRunner = {
    async run(): Promise<WorkflowEvent | null> {
      runs += 1;
      // Порождаем событие, совпадающее с собственным триггером правила → самоцикл.
      return { kind: 'task_status_changed', taskId: 'task-1', status: 'done' };
    },
  };
  const engine = new RunWorkflow({ workflows: repo, runner: loopingRunner });

  await engine.handle(PROJECT_ID, { kind: 'task_status_changed', taskId: 'task-1', status: 'done' });

  // Ровно MAX_CONSECUTIVE_FIRES исполнений, дальше движок отказал вместо бесконечности.
  assert.equal(runs, MAX_CONSECUTIVE_FIRES);
  assert.equal(repo.rules[0]!.enabled, false);
  assert.equal(repo.rules[0]!.lastStatus, 'disabled:cascade');
});

test('ошибка действия не роняет движок и не каскадит', async () => {
  const repo = new MemWorkflowRepo();
  repo.rules.push(
    makeRule('r', { type: 'task_created' }, { type: 'send_telegram', message: 'x' }),
  );
  const engine = new RunWorkflow({
    workflows: repo,
    runner: {
      async run(): Promise<WorkflowEvent | null> {
        throw new Error('telegram_down');
      },
    },
  });
  await engine.handle(PROJECT_ID, { kind: 'task_created', taskId: 't' });
  assert.match(repo.rules[0]!.lastStatus ?? '', /^error:/);
});

test('EffectWorkflowActionRunner маршрутизирует действия в нужные эффекты', async () => {
  const seen: string[] = [];
  const runner = new EffectWorkflowActionRunner({
    delegate: async (_p, taskId, uid) => {
      seen.push(`delegate:${taskId}:${uid}`);
    },
    setPriority: async (_p, taskId, priority) => {
      seen.push(`priority:${taskId}:${priority}`);
    },
    sendTelegram: async (_p, message) => {
      seen.push(`tg:${message}`);
    },
    triggerWebhook: async (_p, event) => {
      seen.push(`wh:${event}`);
    },
  });
  await runner.run(PROJECT_ID, { type: 'delegate', assigneeUserId: 'u1' }, { taskId: 't1' });
  await runner.run(PROJECT_ID, { type: 'set_priority', priority: 2 }, { taskId: 't1' });
  await runner.run(PROJECT_ID, { type: 'send_telegram', message: 'hi' }, { taskId: 't1' });
  await runner.run(PROJECT_ID, { type: 'trigger_webhook', event: 'task.created' }, { taskId: 't1' });
  assert.deepEqual(seen, ['delegate:t1:u1', 'priority:t1:2', 'tg:hi', 'wh:task.created']);
});

test('delegate/set_priority без taskId в контексте — no-op (нет задачи)', async () => {
  let delegated = 0;
  const runner = new EffectWorkflowActionRunner({
    delegate: async () => {
      delegated += 1;
    },
  });
  const follow = await runner.run(
    PROJECT_ID,
    { type: 'delegate', assigneeUserId: 'u1' },
    { taskId: null },
  );
  assert.equal(delegated, 0);
  assert.equal(follow, null);
});

test('activityKindToWorkflowEvent мапит статус и создание, игнорирует прочее', () => {
  assert.deepEqual(activityKindToWorkflowEvent('task_created', { taskId: 't1' }), {
    kind: 'task_created',
    taskId: 't1',
  });
  assert.deepEqual(
    activityKindToWorkflowEvent('task_status_changed', { taskId: 't1', newStatus: 'done' }),
    { kind: 'task_status_changed', taskId: 't1', status: 'done' },
  );
  // Без newStatus событие не строим.
  assert.equal(activityKindToWorkflowEvent('task_status_changed', { taskId: 't1' }), null);
  // Прочие виды — не транслируются.
  assert.equal(activityKindToWorkflowEvent('member_added', {}), null);
});
