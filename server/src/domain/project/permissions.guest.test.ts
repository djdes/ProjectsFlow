import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMember, capGuestRole } from './permissions.js';

// Гость общего проекта (db/182) ведёт задачи, но не проект.
test('guest editor works with tasks', () => {
  const guest = { role: 'editor' as const, guest: true };
  for (const action of ['read_project', 'create_task', 'update_task', 'move_task', 'create_comment', 'manage_attachments', 'delegate_task_to_agent'] as const) {
    assert.equal(canMember(guest, action), true, action);
  }
});

test('guest never reaches project settings, secrets, publishing or the dispatcher', () => {
  const guest = { role: 'editor' as const, guest: true };
  for (const action of [
    'update_project',
    'read_secret',
    'manage_kb',
    'invite_member',
    'manage_file_sync',
    'set_multi_task_worker',
    'view_monitoring',
    'manage_monitoring',
    'delete_project',
    'set_project_dispatcher',
    'set_publish_settings',
    'manage_public_link',
  ] as const) {
    assert.equal(canMember(guest, action), false, action);
  }
  // Без флага гостя — обычная матрица ролей.
  assert.equal(canMember({ role: 'editor' }, 'update_project'), true);
});

test('capGuestRole keeps viewers and caps everyone else at editor', () => {
  assert.equal(capGuestRole('owner'), 'editor');
  assert.equal(capGuestRole('lead'), 'editor');
  assert.equal(capGuestRole('editor'), 'editor');
  assert.equal(capGuestRole('viewer'), 'viewer');
});
