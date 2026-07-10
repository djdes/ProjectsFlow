import type { InlineKeyboardMarkup } from './TelegramClient.js';

// Kinds задачных TG-уведомлений, к которым автоматически прицепляем инлайн-действия
// «Завершить/Комментировать» и регистрируем reply→комментарий. НЕ включаем:
//  - task_done (завершать нечего), ralph_* (свой reply-поток), server_alert (не задача),
//  - делегирование (у него свои кнопки «Принять/Отказать» — приходит с явным replyMarkup).
// task_digest_item — карточка задачи из ежедневной сводки (личный TG).
export const TASK_ACTION_KINDS: ReadonlySet<string> = new Set([
  'comment',
  'comment_on_my_task',
  'mention',
  'status_change',
  'task_digest_item',
]);

// callback_data ≤ 64 байт: 'nd:'/'nc:'/'nu:' (3) + UUID(36) = 39 байт. Префиксы nd/nc/nu
// (notification: done/comment/undo) НЕ пересекаются с конструктором (tp/td/tc/tx/da/dd/…)
// и browse (bt:) — роутинг в HandleTelegramWebhook разводит их до фолбэка на композер.
export function taskActionKeyboard(taskId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Завершить', callback_data: `nd:${taskId}` },
        { text: '💬 Комментировать', callback_data: `nc:${taskId}` },
      ],
    ],
  };
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
