import { StorageQuotaExceededError } from '../../domain/app-backend/errors.js';

// Гейт квоты: если текущий размер БД проекта уже достиг лимита — запись запрещена
// (чтение продолжает работать, проверка вызывается только на insert/update).
export function assertWithinQuota(usageBytes: number, limitBytes: number): void {
  if (usageBytes >= limitBytes) {
    throw new StorageQuotaExceededError(usageBytes, limitBytes);
  }
}
