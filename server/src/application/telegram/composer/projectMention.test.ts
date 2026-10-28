import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProjectMention } from './projectMention.js';

test('natural project references use the accessible ProjectsFlow project', () => {
  const projects = [{ id: 'pf', name: 'ProjectsFlow' }, { id: 'docs', name: 'DocsFlow' }];
  for (const text of ['в проджекте исправить кнопку воркер', 'Исправить кнопку в Проджекте, воркер', 'для проджекта обновить вёрстку', 'в ProjectsFlow исправить кнопку']) {
    assert.equal(matchProjectMention(text, projects)?.id, 'pf');
  }
  assert.equal(matchProjectMention('В DocsFlow поправить шаблон воркер', projects)?.id, 'docs');
});

test('natural references do not grant access or choose between ambiguous projects', () => {
  assert.equal(matchProjectMention('в проджекте поправить кнопку', [{ id: 'docs', name: 'DocsFlow' }]), null);
  assert.equal(matchProjectMention('в проджекте поправить кнопку', [{ id: 'a', name: 'ProjectsFlow' }, { id: 'b', name: 'ProjectsFlow' }]), null);
  assert.equal(matchProjectMention('написать слово проджект', [{ id: 'pf', name: 'ProjectsFlow' }]), null);
});

test('адрес сайта — не упоминание проекта, конец предложения — упоминание', () => {
  const projects = [{ id: 'tf', name: 'TasksFlow' }, { id: 'pf', name: 'ProjectsFlow' }];
  // Прод, 28.10.2026: «задачи … будут в tasksflow.ru» прикалывал всё сообщение к TasksFlow.
  assert.equal(matchProjectMention('задачи которые повторяются ежедневно будут в tasksflow.ru', projects), null);
  assert.equal(matchProjectMention('смотри в tasksflow/app', projects), null);
  assert.equal(matchProjectMention('ссылка в projectsflow.ru', projects), null);
  assert.equal(matchProjectMention('поправить кнопку в TasksFlow.', projects)?.id, 'tf');
  assert.equal(matchProjectMention('в TasksFlow, срочно', projects)?.id, 'tf');
});
