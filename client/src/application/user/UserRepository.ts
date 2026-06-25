import type { User } from '@/domain/user/User';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';
import type { KanbanDefaultColors } from '@/domain/kanban/KanbanSettings';
import type { UiPrefs } from '@/domain/user/UiPrefs';

export type UpdateProfileInput = {
  readonly displayName: string;
  readonly email: string;
};

export interface UserRepository {
  getCurrent(): Promise<User>;
  updateProfile(input: UpdateProfileInput): Promise<User>;
  // Загрузка аватара (multipart). Возвращает обновлённого юзера с новым avatarUrl.
  uploadAvatar(file: File): Promise<User>;
  getDefaultNotificationPrefs(): Promise<NotificationPrefs>;
  setDefaultNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs>;
  applyDefaultNotificationPrefsToAll(): Promise<number>;

  // Глобальные дефолтные цвета канбан-колонок (профиль). {} = встроенные дефолты.
  getDefaultKanbanColors(): Promise<KanbanDefaultColors>;
  setDefaultKanbanColors(colors: KanbanDefaultColors): Promise<KanbanDefaultColors>;

  // Персональные UI-настройки клиента (за аккаунтом). {} = дефолты. setUiPrefs мержит.
  getUiPrefs(): Promise<UiPrefs>;
  setUiPrefs(prefs: UiPrefs): Promise<UiPrefs>;
}
