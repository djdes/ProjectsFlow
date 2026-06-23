import { z } from 'zod';

// body может быть пустым, если есть вложения (валидацию «пусто без вложений» делает сервис).
export const editMessageSchema = z.object({
  body: z.string().min(1, 'Введите текст').max(8000),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

export const markReadSchema = z.object({
  lastReadSeq: z.coerce.number().int().nonnegative(),
});
