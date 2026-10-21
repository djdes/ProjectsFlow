import type { ImageGeneration } from '@/domain/image-generation/ImageGeneration';
export interface ImageGenerationRepository {
  list(): Promise<ImageGeneration[]>;
  create(prompt: string): Promise<ImageGeneration>;
}
