import type { ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
export type ImageGenerationQuota = {
  active: number;
  remaining: number;
  // One UTC-based duration per job in the rolling 24-hour window, by expiry.
  releaseAfterSeconds: number[];
};
// Неудачная генерация для диагностики: кто, когда, с каким промптом и с какой ошибкой.
export type ImageGenerationFailure = ImageGeneration & { userEmail: string | null; userName: string | null };
export type ImageGenerationFailureQuery = {
  // null — по всем пользователям (только для администратора).
  userId: string | null;
  hours: number;
  limit: number;
  // Подстрока в промпте, тексте ошибки, email или имени пользователя.
  query?: string;
};
export interface ImageGenerationRepository {
  listFailures(q: ImageGenerationFailureQuery): Promise<ImageGenerationFailure[]>;
  quota(userId: string): Promise<ImageGenerationQuota>;
  create(job: Pick<ImageGeneration, 'id' | 'userId' | 'dispatcherUserId' | 'prompt' | 'conversationId'>): Promise<ImageGeneration>;
  list(userId: string, conversationId?: string): Promise<ImageGeneration[]>;
  get(id: string): Promise<ImageGeneration | null>;
  claim(dispatcherUserId: string, claimToken: string): Promise<ImageGeneration | null>;
  complete(id: string, claimToken: string, storageKey: string | null, error: string | null): Promise<boolean>;
}
