import type { ImageGeneration } from '@/domain/image-generation/ImageGeneration';
export interface ImageGenerationRepository {
  list(conversationId?: string): Promise<ImageGeneration[]>;
  create(prompt: string, conversationId?: string): Promise<ImageGeneration>;
}
