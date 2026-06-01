import { randomBytes, randomUUID } from 'node:crypto';

// UUID v4 — для users/sessions/projects.id.
// Когда понадобится lexicographically-sortable id (ULID/UUIDv7), сменим тут.
export const idGenerator = (): string => randomUUID();

// Короткий id (12 символов, base64url) для telegram_task_drafts.id: UUID в 36 символов
// не влезает в callback_data (≤64 байта) рядом с префиксом+индексом. 9 байт = 72 бита
// энтропии → коллизии ничтожны для короткоживущих (TTL ~30 мин) черновиков.
export const shortIdGenerator = (): string => randomBytes(9).toString('base64url');
