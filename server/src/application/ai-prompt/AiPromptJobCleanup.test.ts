import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiPromptJobCleanup } from './AiPromptJobCleanup.js';
import type { AiPromptJobMode } from '../../domain/ai-prompt/AiPromptJob.js';

type CancelCall = { olderThan: Date; modes: ReadonlyArray<AiPromptJobMode> };

function makeDeps() {
  const cancels: CancelCall[] = [];
  const deps = {
    aiPromptJobs: {
      cancelStale: async (input: {
        olderThan: Date;
        reason: string;
        statuses: ReadonlyArray<'queued' | 'running'>;
        modes: ReadonlyArray<AiPromptJobMode>;
      }) => {
        cancels.push({ olderThan: input.olderThan, modes: input.modes });
        return 1;
      },
      deleteTerminal: async () => 3,
    },
  } as unknown as ConstructorParameters<typeof AiPromptJobCleanup>[0];
  return { deps, cancels };
}

test('cleanup: у assistant отдельный, более длинный stale-таймаут (15 мин против 5)', async () => {
  const { deps, cancels } = makeDeps();
  const now = new Date('2026-01-01T12:00:00Z');
  const result = await new AiPromptJobCleanup(deps).runOnce(now);

  assert.equal(cancels.length, 2);

  const interactive = cancels.find((c) => !c.modes.includes('assistant'));
  const assistant = cancels.find((c) => c.modes.includes('assistant'));
  assert.ok(interactive && assistant);

  assert.deepEqual([...interactive.modes], ['improve', 'compose', 'compose-advanced']);
  assert.deepEqual([...assistant.modes], ['assistant']);

  assert.equal(now.getTime() - interactive.olderThan.getTime(), 5 * 60 * 1000);
  assert.equal(now.getTime() - assistant.olderThan.getTime(), 15 * 60 * 1000);

  // cancelled суммируется по обоим проходам, deleted — как раньше.
  assert.deepEqual(result, { cancelled: 2, deleted: 3 });
});
