import type { HelpRepository } from './HelpRepository';
import type { SupportSource } from '@/domain/help/Support';
import { SUPPORT_MESSAGE_MAX_LENGTH } from '@/domain/help/Support';

export type SubmitSupportErrorCode = 'empty' | 'too_long' | 'rate_limited' | 'unknown';

// Доменная ошибка use-case'а. Транспортные ошибки (HttpError) мапятся в неё в
// инфраструктурном адаптере (HttpHelpRepository), чтобы use-case оставался чистым.
export class SubmitSupportError extends Error {
  constructor(
    public readonly code: SubmitSupportErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SubmitSupportError';
  }
}

// Отправка обращения в поддержку. Валидация длины здесь (single source of truth —
// доменная константа); транспортные ошибки уже нормализованы репозиторием.
export class SubmitSupport {
  constructor(private readonly repo: HelpRepository) {}

  async execute(message: string, source: SupportSource = 'app'): Promise<void> {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      throw new SubmitSupportError('empty', 'Введите сообщение');
    }
    if (trimmed.length > SUPPORT_MESSAGE_MAX_LENGTH) {
      throw new SubmitSupportError('too_long', `Не больше ${SUPPORT_MESSAGE_MAX_LENGTH} символов`);
    }
    await this.repo.submitSupport({ message: trimmed, source });
  }
}
