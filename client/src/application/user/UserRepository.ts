import type { User } from '@/domain/user/User';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';

export type UpdateProfileInput = {
  readonly displayName: string;
  readonly email: string;
};

export interface UserRepository {
  getCurrent(): Promise<User>;
  updateProfile(input: UpdateProfileInput): Promise<User>;
  getDefaultNotificationPrefs(): Promise<NotificationPrefs>;
  setDefaultNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs>;
  applyDefaultNotificationPrefsToAll(): Promise<number>;
}
