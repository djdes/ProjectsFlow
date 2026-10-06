import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LlmAccessService } from './LlmAccessService.js';
import { LlmGateway, type BlockedToolCall } from './LlmGateway.js';
import { LlmRouter } from './LlmRouter.js';
import type { LlmRawRequest, LlmTransport } from './LlmTransport.js';
import { InMemoryLlmConnections } from './llmTestDoubles.js';
import { blockToolCallOutsideWorkspace, isInsideWorkspace } from './workspaceToolCallPolicy.js';

const ROOT = 'C:\\Users\\ralph\\AppData\\Local\\projectsflow-ralph\\ws\\proj-1';
const now = (): Date => new Date('2026-10-06T10:00:00Z');

function call(args: Record<string, unknown>, name = 'exec_command'): Record<string, unknown> {
  return { type: 'function_call', id: 'fc_1', call_id: 'call_1', name, arguments: JSON.stringify(args), status: 'completed' };
}

test('workdir: внутри рабочей папки — можно, снаружи и через «..» — нельзя', () => {
  assert.equal(isInsideWorkspace(ROOT, ROOT), true);
  assert.equal(isInsideWorkspace('src\\app', ROOT), true);
  assert.equal(isInsideWorkspace(ROOT.toUpperCase() + '\\src', ROOT), true);
  assert.equal(isInsideWorkspace(ROOT.replace(/\\/g, '/') + '/src', ROOT), true);
  assert.equal(isInsideWorkspace('..', ROOT), false);
  assert.equal(isInsideWorkspace('src\\..\\..\\proj-2', ROOT), false);
  assert.equal(isInsideWorkspace(ROOT + '-evil', ROOT), false);
  assert.equal(isInsideWorkspace('C:\\www\\ralph', ROOT), false);
  assert.equal(isInsideWorkspace('\\www\\ralph', ROOT), false);
  assert.equal(isInsideWorkspace('\\\\?\\C:\\www', ROOT), false);
  assert.equal(isInsideWorkspace('\\\\server\\share', ROOT), false);
  assert.equal(isInsideWorkspace('C:www', ROOT), false);
  assert.equal(isInsideWorkspace('src', null), false);
});

test('вызов команды вне рабочей папки или с чужой оболочкой подменяется заблокированным', () => {
  assert.equal(blockToolCallOutsideWorkspace(call({ cmd: 'git status' }), ROOT), null);
  assert.equal(blockToolCallOutsideWorkspace(call({ cmd: 'npm test', workdir: 'client' }), ROOT), null);
  assert.equal(blockToolCallOutsideWorkspace(call({ cmd: 'dir', shell: 'powershell' }), ROOT), null);
  assert.equal(blockToolCallOutsideWorkspace({ type: 'message', content: [] }, ROOT), null);
  assert.equal(blockToolCallOutsideWorkspace(call({ input: 'x' }, 'mcp__projectsflow__pf_get_task'), ROOT), null);

  const outside = blockToolCallOutsideWorkspace(call({ cmd: 'type config.local.json', workdir: 'C:\\www\\ralph' }), ROOT);
  assert.equal(outside?.violation, 'workdir_outside_workspace');
  assert.deepEqual(outside?.item, {
    type: 'function_call',
    id: 'fc_1',
    call_id: 'call_1',
    name: 'blocked_by_projectsflow__workdir_outside_workspace',
    arguments: '{}',
    status: 'completed',
  });
  assert.equal(blockToolCallOutsideWorkspace(call({ cmd: 'ls', workdir: 'src' }), null)?.violation, 'workdir_outside_workspace');
  assert.equal(blockToolCallOutsideWorkspace(call({ cmd: 'ls', shell: 'bash' }), ROOT)?.violation, 'shell_not_allowed');
  assert.equal(
    blockToolCallOutsideWorkspace(call({ cmd: 'x', shell: 'C:\\tmp\\powershell.exe' }), ROOT)?.violation,
    'shell_not_allowed',
  );
  assert.equal(
    blockToolCallOutsideWorkspace(
      { type: 'local_shell_call', id: 'ls_1', call_id: 'c2', action: { type: 'exec', command: ['dir'], working_directory: 'D:\\' } },
      ROOT,
    )?.item['name'],
    'blocked_by_projectsflow__workdir_outside_workspace',
  );
});

function makeGateway(transport: LlmTransport, blocked: BlockedToolCall[] = []) {
  const connections = new InMemoryLlmConnections();
  connections.seed({});
  return new LlmGateway({
    router: new LlmRouter({ connections, provider: 'chatgpt', now }),
    access: new LlmAccessService({
      connections,
      authClient: {
        requestDeviceCode: async () => {
          throw new Error('not used');
        },
        pollDeviceCode: async () => ({ status: 'pending' as const }),
        refresh: async () => {
          throw new Error('not used');
        },
      },
      now,
    }),
    transport,
    connections,
    onToolCallBlocked: (event) => blocked.push(event),
    now,
  });
}

test('шлюз: подменяет модель в теле и проверяет вызовы относительно рабочей папки', async () => {
  const requests: LlmRawRequest[] = [];
  const transport: LlmTransport = {
    async generateText() {
      throw new Error('not used');
    },
    async forward(_access, request) {
      requests.push(request);
      return { status: 200, headers: {}, body: null };
    },
  };
  const blocked: BlockedToolCall[] = [];
  const gateway = makeGateway(transport, blocked);
  const body = Buffer.from(JSON.stringify({ model: 'gpt-5.5', input: [], tools: [{ type: 'function', name: 'exec_command' }] }));

  await gateway.forward({ billedUserId: 'u1', subpath: '', body, headers: {}, upstreamModel: 'gpt-6.1-sol', workspaceRoot: ROOT });
  const sent = JSON.parse(requests[0]!.body.toString('utf8'));
  assert.equal(sent.model, 'gpt-6.1-sol');
  assert.deepEqual(sent.tools, [{ type: 'function', name: 'exec_command' }]);

  const transform = requests[0]!.transformOutputItem!;
  assert.equal(transform(call({ cmd: 'git status' })), null);
  assert.equal(transform(call({ cmd: 'dir', workdir: 'C:\\' }))?.['name'], 'blocked_by_projectsflow__workdir_outside_workspace');
  assert.deepEqual(blocked, [{ billedUserId: 'u1', workspaceRoot: ROOT, violation: 'workdir_outside_workspace' }]);

  // Без модели в заголовке тело уходит байт в байт.
  await gateway.forward({ billedUserId: 'u1', subpath: '', body, headers: {}, workspaceRoot: ROOT });
  assert.equal(requests[1]!.body, body);
});
