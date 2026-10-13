import type { WorkspaceKind } from '../../../domain/workspace/Workspace.js';
import type { TelegramChatWorkspaceRepository } from '../TelegramChatWorkspaceRepository.js';

// Пространство, которое бот может предложить на выбор.
export type WorkspaceOption = {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly kind: WorkspaceKind;
};

export type ComposerWorkspaceDeps = {
  // Пространства, где пользователь участник.
  readonly listForUser: (userId: string) => Promise<readonly WorkspaceOption[]>;
  // Состоит ли человек в пространстве (ответственный задачи без проекта).
  readonly isMember: (workspaceId: string, userId: string) => Promise<boolean>;
  readonly chats: TelegramChatWorkspaceRepository;
};

// Сколько помнить выбор в личном чате с ботом: там контекст меняется день ото дня, и вчерашний
// выбор сегодня скорее ошибка, чем подсказка. В группе выбор живёт, пока не выберут другое:
// группа обычно про одну команду.
export const PRIVATE_CHOICE_TTL_MS = 12 * 60 * 60 * 1000;

export type WorkspaceDecisionReason = 'only' | 'assignee' | 'group' | 'remembered';

export type WorkspaceDecision =
  | {
      readonly kind: 'resolved';
      readonly workspaceId: string;
      readonly reason: WorkspaceDecisionReason;
    }
  | { readonly kind: 'ask'; readonly options: readonly WorkspaceOption[] };

// Личное пространство первым, дальше командные по имени — в этом порядке идут кнопки.
export function sortWorkspaceOptions(options: readonly WorkspaceOption[]): WorkspaceOption[] {
  return [...options].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'default' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ru');
  });
}

// Telegram отдаёт группам и супергруппам отрицательные id, личным чатам — положительные.
export function isGroupChat(chatId: number): boolean {
  return chatId < 0;
}

/**
 * Где можно создать «Входящие» для задач черновика: свои пространства, а если задача без
 * проекта отдаётся другому человеку — только те, где он тоже состоит (его «Входящие» живут в
 * общем пространстве). Без общих пространств подходящих вариантов нет.
 */
export async function allowedWorkspaces(
  deps: Pick<ComposerWorkspaceDeps, 'isMember'>,
  mine: readonly WorkspaceOption[],
  delegateIds: readonly string[],
): Promise<WorkspaceOption[]> {
  if (delegateIds.length === 0) return [...mine];
  const shared: WorkspaceOption[] = [];
  for (const workspace of mine) {
    const members = await Promise.all(delegateIds.map((id) => deps.isMember(workspace.id, id)));
    if (members.every(Boolean)) shared.push(workspace);
  }
  return shared;
}

/**
 * Решает, в «Входящие» какого пространства бот кладёт задачи без проекта. Сигналы по силе,
 * первый однозначный решает:
 *  1. пространство одно (с учётом ответственного) — оно;
 *  2. для поручения коллеге несколько общих пространств — спросить;
 *  3. для своих задач группа привязана к сводке — то пространство;
 *  4. для своих задач прошлый выбор в этом чате (в личке — не старше PRIVATE_CHOICE_TTL_MS);
 *  5. иначе — спросить кнопками.
 *
 * Активное пространство веб-интерфейса НЕ сигнал: это случайное состояние браузера, и личная
 * заметка из Telegram уезжала из-за него в командное пространство. Задачи с проектом сюда не
 * относятся вовсе — их пространство задаёт проект.
 *
 * null — у пользователя нет пространств: решать не из чего, вызывающий оставляет прежнее
 * поведение.
 */
export async function resolveDraftWorkspace(
  deps: ComposerWorkspaceDeps,
  input: {
    readonly userId: string;
    readonly chatId: number;
    // Ответственные (не автор) задач, которые лягут во «Входящие».
    readonly delegateIds: readonly string[];
    readonly now: Date;
  },
): Promise<WorkspaceDecision | null> {
  const mine = sortWorkspaceOptions(await deps.listForUser(input.userId));
  if (mine.length === 0) return null;
  let candidates = await allowedWorkspaces(deps, mine, input.delegateIds);
  if (candidates.length === 1) {
    return { kind: 'resolved', workspaceId: candidates[0]!.id, reason: input.delegateIds.length ? 'assignee' : 'only' };
  }

  // Поручение относится к общим пространствам автора и исполнителей. Контекст группы
  // и прошлый выбор для другой задачи не разрешают неоднозначность этого поручения.
  if (input.delegateIds.length > 0) return { kind: 'ask', options: candidates };

  if (isGroupChat(input.chatId)) {
    const linked = new Set(await deps.chats.linkedWorkspaceIds(input.chatId));
    const inGroup = candidates.filter((workspace) => linked.has(workspace.id));
    if (inGroup.length === 1) {
      return { kind: 'resolved', workspaceId: inGroup[0]!.id, reason: 'group' };
    }
    // Группа привязана к нескольким пространствам — выбор только среди них.
    if (inGroup.length > 1) candidates = inGroup;
  }

  const choice = await deps.chats.getChoice(input.chatId, input.userId);
  if (choice && candidates.some((workspace) => workspace.id === choice.workspaceId)) {
    const fresh =
      isGroupChat(input.chatId) ||
      input.now.getTime() - choice.chosenAt.getTime() <= PRIVATE_CHOICE_TTL_MS;
    if (fresh) return { kind: 'resolved', workspaceId: choice.workspaceId, reason: 'remembered' };
  }

  return { kind: 'ask', options: candidates };
}
