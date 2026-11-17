import assert from 'node:assert/strict';
import test from 'node:test';
import { canDeleteTaskTemplate, taskTemplateSummary, type WorkspaceTaskTemplate } from './WorkspaceTaskTemplate';

const template: WorkspaceTaskTemplate = {
  id: 'tpl-1',
  workspaceId: 'ws-1',
  name: 'Планёрка',
  description: 'Планёрка\n- [ ] Собрать статусы\n- [ ] Разослать итоги\nПросто текст',
  priority: 2,
  taskType: 'bug',
  recurrence: { kind: 'weekdays' },
  createdBy: 'u-author',
  createdAt: new Date('2026-11-01T00:00:00Z'),
};

test('the summary lists priority, type, recurrence and the checklist size', () => {
  assert.equal(taskTemplateSummary(template), 'Высокий · Баг · По будням · чеклист 2');
  assert.equal(
    taskTemplateSummary({ ...template, priority: null, taskType: null, recurrence: null, description: 'Без деталей' }),
    '',
  );
});

test('a template is deleted by its author, a lead or the owner', () => {
  assert.ok(canDeleteTaskTemplate(template, 'u-author', 'editor'));
  assert.ok(canDeleteTaskTemplate(template, 'u-other', 'lead'));
  assert.ok(canDeleteTaskTemplate(template, 'u-other', 'owner'));
  assert.ok(!canDeleteTaskTemplate(template, 'u-other', 'editor'));
  assert.ok(!canDeleteTaskTemplate({ ...template, createdBy: null }, undefined, 'viewer'));
});
