import { HttpError } from '@/lib/HttpError';

const STATUS_MESSAGE: Record<number, string> = {
  403: 'Недостаточно прав для этого действия.',
  409: 'Данные уже изменились. Обновите страницу и повторите действие.',
  422: 'Проверьте введённые данные.',
  429: 'Слишком много запросов. Подождите немного и повторите.',
  500: 'Сервис временно недоступен.',
  502: 'Сервис временно недоступен.',
  503: 'Сервис временно недоступен.',
  504: 'Сервис не успел ответить. Повторите действие.',
};

export function actionErrorMessage(error: unknown, fallback = 'Не удалось выполнить действие'): string {
  if (error instanceof HttpError) {
    const base = error.body.message?.trim() || STATUS_MESSAGE[error.status] || fallback;
    const requestId =
      typeof error.body.requestId === 'string' && error.body.requestId.trim()
        ? ` Код запроса: ${error.body.requestId}.`
        : '';
    return `${base}${requestId}`;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function isRetryableActionError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return true;
  return error.status === 409 || error.status === 429 || error.status >= 500;
}
