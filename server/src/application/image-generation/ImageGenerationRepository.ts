import type { ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
export type ImageGenerationQuota = {
  active: number;
  remaining: number;
  // One UTC-based duration per job in the rolling 24-hour window, by expiry.
  releaseAfterSeconds: number[];
};
export interface ImageGenerationRepository {
  quota(userId: string): Promise<ImageGenerationQuota>;
  create(job: Pick<ImageGeneration, 'id' | 'userId' | 'dispatcherUserId' | 'prompt' | 'conversationId'>): Promise<ImageGeneration>;
  list(userId: string, conversationId?: string): Promise<ImageGeneration[]>;
  get(id: string): Promise<ImageGeneration | null>;
  claim(dispatcherUserId: string, claimToken: string): Promise<ImageGeneration | null>;
  complete(id: string, claimToken: string, storageKey: string | null, error: string | null): Promise<boolean>;
}
