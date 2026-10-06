import type { LlmConnectionOwner, LlmProvider } from './LlmConnection.js';

// Незавершённый вход по коду: код показан человеку, сервер ждёт подтверждения на сайте
// провайдера. Хранится в БД, а не в памяти процесса, — переживает перезапуск сервера.
export type LlmDeviceLogin = {
  readonly id: string;
  readonly owner: LlmConnectionOwner;
  readonly provider: LlmProvider;
  readonly userCode: string;
  readonly deviceAuthId: string;
  readonly verificationUrl: string;
  readonly intervalSec: number;
  readonly expiresAt: Date;
  readonly createdBy: string;
  readonly createdAt: Date;
};
