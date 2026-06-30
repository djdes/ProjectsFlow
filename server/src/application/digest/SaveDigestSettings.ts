import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type { DigestSettings } from '../../domain/digest/DigestSettings.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { DigestSettingsRepository, SaveDigestSettingsInput } from './DigestSettingsRepository.js';

type Deps = ProjectAccessDeps & {
  readonly settings: DigestSettingsRepository;
  // Для резолва названия группы через getChat. Опционально — без него резолв вернёт null.
  readonly telegram?: TelegramClient;
};

export class SaveDigestSettings {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    userId: string,
    input: SaveDigestSettingsInput,
  ): Promise<DigestSettings> {
    // Editor+ может настраивать сводку/группу проекта (как update_project).
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    return this.deps.settings.save(projectId, input);
  }

  // Резолв названия Telegram-группы по chat_id через бота (getChat). Editor+ (как настройка
  // группы). Мягкий фоллбэк: бот не в группе / нет прав / клиент без getChat → { title: null }.
  // Не сохраняет — вызывающий код подставит title в форму и сохранит как обычно.
  async resolveGroupTitle(
    projectId: string,
    userId: string,
    chatId: number,
  ): Promise<{ title: string | null }> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const getChat = this.deps.telegram?.getChat;
    if (!getChat) return { title: null };
    const info = await getChat.call(this.deps.telegram, chatId).catch(() => null);
    return { title: info?.title ?? null };
  }
}
