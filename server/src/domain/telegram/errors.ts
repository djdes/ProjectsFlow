// Ошибки рабочих Telegram-групп пространства (db/181).

// Бот не видит группу по этому id (его там нет или id неверный).
export class TelegramGroupNotFoundError extends Error {
  constructor() {
    super('Бот не нашёл группу. Добавьте @ProjectsFlow_Bot в группу и проверьте id.');
    this.name = 'TelegramGroupNotFoundError';
  }
}

// Подключить группу к пространству может только её администратор в Telegram: иначе любой
// участник чужой группы перехватил бы её задачи в своё пространство.
export class TelegramGroupNotAdminError extends Error {
  constructor() {
    super('Подключить группу может только её администратор в Telegram.');
    this.name = 'TelegramGroupNotAdminError';
  }
}

// Группа уже рабочая у другого пространства. Имя чужого пространства не раскрываем.
export class TelegramGroupTakenError extends Error {
  constructor() {
    super('Группа уже подключена к другому пространству. Сначала отключите её там.');
    this.name = 'TelegramGroupTakenError';
  }
}

// Для проверки участия в группе нужен привязанный Telegram.
export class TelegramNotLinkedError extends Error {
  constructor() {
    super('Подключите Telegram в профиле, чтобы добавить группу по id.');
    this.name = 'TelegramNotLinkedError';
  }
}

// Бот не настроен (нет токена/username) — ссылку на группу не собрать.
export class TelegramBotUnavailableError extends Error {
  constructor() {
    super('Telegram-бот не настроен на сервере.');
    this.name = 'TelegramBotUnavailableError';
  }
}
