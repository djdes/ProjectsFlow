import type { User } from '@/domain/user/User';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';
import type { KanbanDefaultColors } from '@/domain/kanban/KanbanSettings';
import type { UiPrefs } from '@/domain/user/UiPrefs';
import type { UserRepository, UpdateProfileInput } from '@/application/user/UserRepository';
import { seedUser } from './seed-data';

const LATENCY_MS = 120;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

export class MockUserRepository implements UserRepository {
  private current: User = seedUser;
  private defaultPrefs: NotificationPrefs = {};

  getCurrent(): Promise<User> {
    return delay(this.current);
  }

  updateProfile(input: UpdateProfileInput): Promise<User> {
    this.current = { ...this.current, displayName: input.displayName, email: input.email };
    return delay(this.current);
  }

  getDefaultNotificationPrefs(): Promise<NotificationPrefs> {
    return delay(this.defaultPrefs);
  }

  setDefaultNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
    this.defaultPrefs = prefs;
    return delay(this.defaultPrefs);
  }

  applyDefaultNotificationPrefsToAll(): Promise<number> {
    return delay(3);
  }

  private defaultKanbanColors: KanbanDefaultColors = {};

  getDefaultKanbanColors(): Promise<KanbanDefaultColors> {
    return delay(this.defaultKanbanColors);
  }

  setDefaultKanbanColors(colors: KanbanDefaultColors): Promise<KanbanDefaultColors> {
    this.defaultKanbanColors = colors;
    return delay(this.defaultKanbanColors);
  }

  private uiPrefs: UiPrefs = {};

  getUiPrefs(): Promise<UiPrefs> {
    return delay(this.uiPrefs);
  }

  setUiPrefs(prefs: UiPrefs): Promise<UiPrefs> {
    this.uiPrefs = { ...this.uiPrefs, ...prefs };
    return delay(this.uiPrefs);
  }
}
