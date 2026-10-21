import type { ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
export interface ImageGenerationRepository {
  create(job: Pick<ImageGeneration, 'id' | 'userId' | 'dispatcherUserId' | 'prompt'>): Promise<ImageGeneration>;
  list(userId: string): Promise<ImageGeneration[]>;
  get(id: string): Promise<ImageGeneration | null>;
  claim(dispatcherUserId: string, claimToken: string): Promise<ImageGeneration | null>;
  complete(id: string, claimToken: string, storageKey: string | null, error: string | null): Promise<boolean>;
}
