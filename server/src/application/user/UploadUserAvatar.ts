import { randomUUID } from 'node:crypto';
import type { AttachmentStorage } from '../task/AttachmentStorage.js';
import type { UserRepository } from './UserRepository.js';
import type { User } from '../../domain/user/User.js';

// Расширение файла по mime — чтобы served-URL отдавал корректный Content-Type.
// Принимаем любые растровые форматы (включая webp/avif); неизвестные → bin (отдадутся как
// octet-stream, аватар не отрисуется — фолбэк на инициалы).
const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

export class InvalidAvatarTypeError extends Error {
  readonly code = 'invalid_avatar_type';
  constructor() {
    super('Можно загрузить только изображение');
    this.name = 'InvalidAvatarTypeError';
  }
}

type Deps = {
  readonly users: UserRepository;
  readonly storage: AttachmentStorage;
};

// Загрузка пользовательского аватара: кладём бинарь в storage под avatars/{userId}/{uuid}.{ext}
// и сохраняем served-URL в users.avatar_url. URL сам кодирует storage-key — отдельная колонка
// не нужна. Новый аватар = новый uuid → старый кэш не мешает (immutable).
export class UploadUserAvatar {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; mimeType: string; data: Buffer }): Promise<User> {
    if (!input.mimeType.startsWith('image/')) throw new InvalidAvatarTypeError();
    const ext = EXT_BY_MIME[input.mimeType] ?? 'bin';
    const fileName = `${randomUUID()}.${ext}`;
    const storageKey = `avatars/${input.userId}/${fileName}`;
    await this.deps.storage.put({ storageKey, data: input.data, mimeType: input.mimeType });
    const url = `/api/avatars/${input.userId}/${fileName}`;
    return this.deps.users.setAvatarUrl(input.userId, url);
  }
}
