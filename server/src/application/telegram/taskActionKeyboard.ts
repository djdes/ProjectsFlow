import type { InlineKeyboardMarkup } from './TelegramClient.js';
import type { TaskStatus } from '../../domain/task/Task.js';

// Kinds задачных TG-уведомлений, к которым автоматически прицепляем инлайн-действия
// «Завершить/Комментировать» и регистрируем reply→комментарий. НЕ включаем:
//  - task_done (завершать нечего), ralph_* (свой reply-поток), server_alert (не задача).
//  Карточка назначения ответственного шлётся композером с этой же клавиатурой явно.
//  task_digest_item намеренно не включён: в ежедневной сводке проекта действия — компактные
//  ссылки внутри самого сообщения, а не большая inline-клавиатура под ним. task_digest_card —
//  карточка личной сводки пространства (db/161): кнопки и reply→комментарий как у уведомлений.
export const TASK_ACTION_KINDS: ReadonlySet<string> = new Set([
  'task_changed',
  'team_task_changed',
  'comment',
  'comment_on_my_task',
  'mention',
  'status_change',
  'task_assignee_changed',
  'task_digest_card',
]);

// Callback data stays below Telegram's 64-byte limit: prefix + UUID is at most 41
// bytes, including delete confirmation. Notification actions are routed before the
// composer (tp/td/tc/tx/da/dd/...) and browse (bt:) callbacks.
export function taskActionKeyboard(taskId: string, status?: TaskStatus): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        ...(status === 'manual' ? [] : [{ text: '▶️ В работу', callback_data: `nw:${taskId}` }]),
        { text: '✅ Готово', callback_data: `nd:${taskId}` },
      ],
      [
        { text: '💬 Комментировать', callback_data: `nc:${taskId}` },
        { text: '🗑 Удалить', callback_data: `nx:${taskId}` },
      ],
      [{ text: '👁 Посмотреть задачу', callback_data: `bt:t:${taskId}` }],
    ],
  };
}

export function taskDeleteKeyboard(taskId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [[
    { text: '🗑 Да, в корзину', callback_data: `nx:y:${taskId}` },
    { text: 'Оставить', callback_data: `nx:n:${taskId}` },
  ]] };
}

// Клавиатура после завершения — только «Отменить» (персистентно, до нажатия).
export function taskCompletedKeyboard(taskId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `nu:${taskId}` }]],
  };
}

// Клавиатура предложения закрыть задачу (db/101). callback_data 'pd:'/'px:' (proposal
// done/dismiss) + UUID(36) = 39 байт ≤ 64. Префиксы не пересекаются с nd/nc/nu/bt/tp/…
// — роутинг в HandleTelegramWebhook разводит их. Подтвердить может любой участник.
export function closeProposalKeyboard(proposalId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Закрыть', callback_data: `pd:${proposalId}` },
        { text: '✕ Не она', callback_data: `px:${proposalId}` },
      ],
    ],
  };
}

// Клавиатура предложения после разрешения — пусто (кнопки убираем правкой сообщения).
export function closeProposalResolvedKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [] };
}

// Клавиатура для задачи, которая УЖЕ завершена на момент уведомления (напр. статус сменился
// на «Готово»): «Завершить» бессмысленно → показываем «Посмотреть» (bt:t: — тот же browse-роут,
// что и в композере). «Комментировать» остаётся.
export function taskViewKeyboard(taskId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '👁 Посмотреть', callback_data: `bt:t:${taskId}` },
        { text: '💬 Комментировать', callback_data: `nc:${taskId}` },
      ],
    ],
  };
}
