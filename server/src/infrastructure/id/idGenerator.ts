import { randomUUID } from 'node:crypto';

// UUID v4 — для users/sessions/projects.id.
// Когда понадобится lexicographically-sortable id (ULID/UUIDv7), сменим тут.
export const idGenerator = (): string => randomUUID();
