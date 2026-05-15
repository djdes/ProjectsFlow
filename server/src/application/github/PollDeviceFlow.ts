import type { GithubConnection } from '../../domain/github/GithubConnection.js';
import {
  GithubDeviceFlowExpiredError,
  GithubDeviceFlowPendingError,
  GithubDeviceFlowSlowDownError,
} from '../../domain/github/errors.js';
import type { GithubApiClient } from './GithubApiClient.js';
import type { GithubTokenRepository } from './GithubTokenRepository.js';

type DeviceFlowEntry = {
  readonly deviceCode: string;
  readonly intervalMs: number;
  readonly expiresAt: Date;
};

type Deps = {
  readonly api: GithubApiClient;
  readonly tokens: GithubTokenRepository;
  readonly getDeviceCode: (userId: string) => DeviceFlowEntry | null;
  readonly updateInterval: (userId: string, newIntervalMs: number) => void;
  readonly clearDeviceCode: (userId: string) => void;
  readonly now: () => Date;
};

// Результат вызывающему: либо «ещё ждём», либо «connected», либо ошибка.
export type PollResult =
  | { readonly kind: 'pending' }
  | { readonly kind: 'connected'; readonly connection: GithubConnection };

export class PollDeviceFlow {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<PollResult> {
    const entry = this.deps.getDeviceCode(userId);
    if (!entry) throw new GithubDeviceFlowExpiredError();
    if (entry.expiresAt.getTime() <= this.deps.now().getTime()) {
      this.deps.clearDeviceCode(userId);
      throw new GithubDeviceFlowExpiredError();
    }

    const result = await this.deps.api.pollAccessToken(entry.deviceCode);

    switch (result.kind) {
      case 'pending':
        throw new GithubDeviceFlowPendingError();
      case 'slow_down':
        this.deps.updateInterval(userId, result.newInterval * 1000);
        throw new GithubDeviceFlowSlowDownError(result.newInterval);
      case 'expired':
      case 'denied':
        this.deps.clearDeviceCode(userId);
        throw new GithubDeviceFlowExpiredError();
      case 'success': {
        const user = await this.deps.api.getAuthenticatedUser(result.accessToken);
        const connection = await this.deps.tokens.upsert({
          userId,
          accessToken: result.accessToken,
          scopes: result.scopes,
          githubLogin: user.login,
          githubUserId: user.id,
        });
        this.deps.clearDeviceCode(userId);
        return { kind: 'connected', connection };
      }
    }
  }
}
