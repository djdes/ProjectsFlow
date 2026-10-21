import { ImageGenerationError, type ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
import type { ImageGenerationRepository } from './ImageGenerationRepository.js';
import type { AttachmentStorage } from '../task/AttachmentStorage.js';

export class ImageGenerationService {
  constructor(private readonly deps: { jobs: ImageGenerationRepository; storage: AttachmentStorage; dispatcherUserId: string; idGen: () => string }) {}
  async create(userId: string, prompt: string): Promise<ImageGeneration> {
    const text = prompt.trim();
    if (!text || text.length > 8000) throw new ImageGenerationError(400, 'Введите описание фотографии — до 8000 символов');
    if (!this.deps.dispatcherUserId) throw new ImageGenerationError(503, 'Генерация фотографий пока недоступна');
    return this.deps.jobs.create({ id: this.deps.idGen(), userId, prompt: text, dispatcherUserId: this.deps.dispatcherUserId });
  }
  list(userId: string): Promise<ImageGeneration[]> { return this.deps.jobs.list(userId); }
  async owned(userId: string, id: string): Promise<ImageGeneration> {
    const job = await this.deps.jobs.get(id);
    if (!job || job.userId !== userId) throw new ImageGenerationError(404, 'Фотография не найдена');
    return job;
  }
  async image(userId: string, id: string): Promise<Buffer> {
    const job = await this.owned(userId, id);
    if (job.status !== 'succeeded' || !job.storageKey) throw new ImageGenerationError(409, 'Фотография ещё не готова');
    const file = await this.deps.storage.read(job.storageKey);
    if (!file) throw new ImageGenerationError(404, 'Фотография не найдена');
    return file.data;
  }
  async claim(dispatcherUserId: string): Promise<ImageGeneration | null> {
    this.requireDispatcher(dispatcherUserId);
    return this.deps.jobs.claim(dispatcherUserId, this.deps.idGen());
  }
  async complete(dispatcherUserId: string, id: string, claimToken: string, image?: Buffer): Promise<void> {
    this.requireDispatcher(dispatcherUserId);
    const job = await this.deps.jobs.get(id);
    if (!job || job.dispatcherUserId !== dispatcherUserId || job.claimToken !== claimToken) throw new ImageGenerationError(404, 'Задание не найдено');
    if (job.status === 'succeeded' || job.status === 'failed') return;
    if (job.status !== 'running') throw new ImageGenerationError(409, 'Задание не выполняется');
    let key: string | null = null;
    if (image) {
      if (image.length < 24 || image.length > 24 * 1024 * 1024 || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || image.toString('ascii',12,16) !== 'IHDR') {
        throw new ImageGenerationError(400, 'Некорректное изображение PNG');
      }
      key = `generated-images/${job.userId}/${job.id}.png`;
      await this.deps.storage.put({ storageKey: key, data: image, mimeType: 'image/png' });
    }
    await this.deps.jobs.complete(id, claimToken, key, image ? null : 'Не удалось создать фотографию. Попробуйте ещё раз.');
  }
  private requireDispatcher(id: string): void {
    if (!this.deps.dispatcherUserId || id !== this.deps.dispatcherUserId) throw new ImageGenerationError(403, 'Недостаточно прав');
  }
}
