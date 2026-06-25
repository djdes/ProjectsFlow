import type { User } from '@/domain/user/User';
import type { NotificationPrefs } from '@/domain/notifications/NotificationPrefs';
import type { KanbanDefaultColors } from '@/domain/kanban/KanbanSettings';
import type { UiPrefs } from '@/domain/user/UiPrefs';
import type {
  UpdateProfileInput,
  UserRepository,
} from '@/application/user/UserRepository';
import { HttpError, httpClient } from './httpClient';

type UserDto = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
  createdAt: string;
};

function fromDto(dto: UserDto): User {
  return {
    id: dto.id,
    email: dto.email,
    displayName: dto.displayName,
    avatarUrl: dto.avatarUrl,
    isAdmin: dto.isAdmin ?? false,
  };
}

export class HttpUserRepository implements UserRepository {
  async getCurrent(): Promise<User> {
    const { user } = await httpClient.get<{ user: UserDto }>('/auth/me');
    return fromDto(user);
  }

  async updateProfile(input: UpdateProfileInput): Promise<User> {
    const { user } = await httpClient.patch<{ user: UserDto }>('/auth/me', input);
    return fromDto(user);
  }

  // multipart/form-data: httpClient под JSON, поэтому fetch вручную (как в attachments).
  async uploadAvatar(file: File): Promise<User> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/auth/me/avatar', {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const text = await res.text();
    const data = text
      ? (JSON.parse(text) as { user?: UserDto; error?: string; message?: string })
      : null;
    if (!res.ok || !data?.user) {
      const msg = data?.message ?? data?.error ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return fromDto(data.user);
  }

  async getDefaultNotificationPrefs(): Promise<NotificationPrefs> {
    const { prefs } = await httpClient.get<{ prefs: NotificationPrefs }>('/me/notification-prefs');
    return prefs;
  }

  async setDefaultNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
    const { prefs: saved } = await httpClient.put<{ prefs: NotificationPrefs }>('/me/notification-prefs', { prefs });
    return saved;
  }

  async applyDefaultNotificationPrefsToAll(): Promise<number> {
    const { applied } = await httpClient.post<{ applied: number }>('/me/notification-prefs/apply-all', {});
    return applied;
  }

  async getDefaultKanbanColors(): Promise<KanbanDefaultColors> {
    const { colors } = await httpClient.get<{ colors?: unknown }>('/me/kanban-colors');
    // Защита от строкового значения JSON-колонки (старый сервер): нормализуем в объект.
    let val: unknown = colors;
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch {
        return {};
      }
    }
    return val && typeof val === 'object' && !Array.isArray(val) ? (val as KanbanDefaultColors) : {};
  }

  async setDefaultKanbanColors(colors: KanbanDefaultColors): Promise<KanbanDefaultColors> {
    const { colors: saved } = await httpClient.put<{ colors?: KanbanDefaultColors }>(
      '/me/kanban-colors',
      { colors },
    );
    return saved ?? {};
  }

  async getUiPrefs(): Promise<UiPrefs> {
    const { prefs } = await httpClient.get<{ prefs?: unknown }>('/me/ui-prefs');
    // Защита от строкового JSON-значения колонки (старый сервер) — нормализуем в объект.
    let val: unknown = prefs;
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch {
        return {};
      }
    }
    return val && typeof val === 'object' && !Array.isArray(val) ? (val as UiPrefs) : {};
  }

  async setUiPrefs(prefs: UiPrefs): Promise<UiPrefs> {
    const { prefs: saved } = await httpClient.put<{ prefs?: UiPrefs }>('/me/ui-prefs', { prefs });
    return saved ?? {};
  }
}

// Утилита экспортируется чтобы AuthProvider мог достучаться к 401 без двойного дублирования
export { HttpError };
