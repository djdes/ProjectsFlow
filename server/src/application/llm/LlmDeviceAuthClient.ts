import type { LlmAccountInfo, LlmCredentials } from '../../domain/llm/LlmConnection.js';

// OAuth провайдера: вход по коду (device code) и обновление токенов.

export type LlmDeviceCodeGrant = {
  readonly userCode: string;
  readonly deviceAuthId: string;
  readonly verificationUrl: string;
  readonly intervalSec: number;
  readonly expiresInSec: number;
};

export type LlmTokenGrant = {
  readonly credentials: LlmCredentials;
  readonly account: LlmAccountInfo;
};

export type LlmDevicePollResult =
  | { readonly status: 'pending' }
  | { readonly status: 'approved'; readonly grant: LlmTokenGrant };

export type LlmDeviceAuthClient = {
  // Бросает LlmDeviceAuthUnavailableError, если вход по коду не включён для аккаунта.
  requestDeviceCode(): Promise<LlmDeviceCodeGrant>;
  // Подтверждён ли код; при подтверждении сразу меняет его на токены.
  pollDeviceCode(input: { deviceAuthId: string; userCode: string }): Promise<LlmDevicePollResult>;
  // Бросает LlmRefreshRejectedError, если refresh-токен больше не действует.
  refresh(refreshToken: string): Promise<LlmTokenGrant>;
};
