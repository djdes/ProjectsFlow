import type { User } from '@/domain/user/User';
import type { UserRepository } from './UserRepository';

// Загрузка аватара пользователя. Возвращает обновлённого юзера (с новым avatarUrl),
// который presentation кладёт в AuthContext через applyUserUpdate.
export class UploadAvatar {
  constructor(private readonly repo: UserRepository) {}

  execute(file: File): Promise<User> {
    return this.repo.uploadAvatar(file);
  }
}
