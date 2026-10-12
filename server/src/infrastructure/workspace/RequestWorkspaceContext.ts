import { AsyncLocalStorage } from 'node:async_hooks';
import type { ActiveWorkspace } from '../../application/workspace/activeWorkspace.js';

// A request keeps its workspace even if another tab changes the account preference.
export class RequestWorkspaceContext {
  private readonly storage = new AsyncLocalStorage<{ userId: string; workspace: ActiveWorkspace | null }>();

  get(userId: string): { workspace: ActiveWorkspace | null } | undefined {
    const scope = this.storage.getStore();
    return scope?.userId === userId ? scope : undefined;
  }

  run(userId: string, workspace: ActiveWorkspace | null, next: () => void): void {
    this.storage.run({ userId, workspace }, next);
  }
}
