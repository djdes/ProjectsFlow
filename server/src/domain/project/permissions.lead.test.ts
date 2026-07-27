import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, hasOwnerRights } from './permissions.js';

// Руководитель (тимлид) по решению заказчика имеет РОВНО права владельца. Граница проходит
// не здесь, а в requireWorkspaceOwner: состав команды и роли меняет только владелец.
const OWNER_ONLY = [
  'delete_project',
  'remove_member',
  'transfer_ownership',
  'manage_finance',
  'set_project_dispatcher',
  'set_git_token_delegation',
  'set_publish_settings',
  'manage_public_link',
  'manage_app_repo',
] as const;

test('lead проходит все owner-only действия', () => {
  for (const action of OWNER_ONLY) {
    assert.equal(can('lead', action), true, action);
  }
});

test('editor и viewer в owner-only действия по-прежнему не проходят', () => {
  for (const action of OWNER_ONLY) {
    assert.equal(can('editor', action), false, action);
    assert.equal(can('viewer', action), false, action);
  }
});

test('hasOwnerRights: владелец и руководитель — да, остальные — нет', () => {
  assert.equal(hasOwnerRights('owner'), true);
  assert.equal(hasOwnerRights('lead'), true);
  assert.equal(hasOwnerRights('editor'), false);
  assert.equal(hasOwnerRights('viewer'), false);
});

test('lead сохраняет и обычные права участника', () => {
  assert.equal(can('lead', 'read_project'), true);
  assert.equal(can('lead', 'create_task'), true);
  assert.equal(can('lead', 'assign_task'), true);
});
