import type { ImageGenerationRepository } from '@/application/image-generation/ImageGenerationRepository';
import type { ImageGeneration } from '@/domain/image-generation/ImageGeneration';
import { httpClient } from './httpClient';
export class HttpImageGenerationRepository implements ImageGenerationRepository {
  async list(conversationId?: string): Promise<ImageGeneration[]> { return (await httpClient.get<{items:ImageGeneration[]}>('/ai/image-jobs' + (conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''))).items; }
  create(prompt: string, conversationId?: string): Promise<ImageGeneration> { return httpClient.post('/ai/image-jobs', {prompt, ...(conversationId ? {conversationId} : {})}); }
}
