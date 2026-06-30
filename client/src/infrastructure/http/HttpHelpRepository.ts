import type { HelpRepository, SubmitSupportInput } from '@/application/help/HelpRepository';
import { SubmitSupportError } from '@/application/help/SubmitSupport';
import { HttpError, httpClient } from './httpClient';

export class HttpHelpRepository implements HelpRepository {
  async submitSupport(input: SubmitSupportInput): Promise<void> {
    try {
      await httpClient.post<{ ok: boolean }>('/help/contact-support', {
        message: input.message,
        source: input.source,
      });
    } catch (e) {
      throw mapError(e);
    }
  }
}

function mapError(e: unknown): SubmitSupportError {
  if (e instanceof HttpError) {
    if (e.status === 429) {
      return new SubmitSupportError('rate_limited', 'Слишком много обращений. Попробуйте позже.');
    }
    if (e.status === 400) {
      // Серверная zod-валидация (например, превышение длины) — трактуем как too_long.
      return new SubmitSupportError('too_long', e.body?.message ?? 'Проверьте сообщение');
    }
  }
  return new SubmitSupportError('unknown', e instanceof Error ? e.message : String(e));
}
