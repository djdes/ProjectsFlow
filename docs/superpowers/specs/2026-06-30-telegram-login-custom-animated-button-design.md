# Привязка Telegram: своя анимированная кнопка вместо iframe-виджета

Дата: 2026-06-30
Статус: реализован

## Проблема (от пользователя)

В профиле в карточке «Telegram-уведомления» пропала кнопка привязки — «нигде нет кнопки».
Раньше была. Нужно вернуть и сделать «классную, анимированную».

## Причина

Кнопка — это встраиваемый **Telegram Login Widget** (`telegram-widget.js` с `data-*`
атрибутами), который рендерит свой `<iframe>` с синей кнопкой. Минусы:

1. **Нельзя стилизовать/анимировать** — это cross-origin iframe Telegram.
2. **Молча не рендерится**, если домен не зарегистрирован в BotFather (`/setdomain`) или это
   localhost — iframe пустой. Отсюда «кнопка исчезла».

## Решение

Перестаём полагаться на iframe. Грузим `telegram-widget.js` только ради глобального
`window.Telegram.Login.auth(...)` и дёргаем popup-логина **со своей кнопки**. Это документированный
способ кастомной кнопки, callback отдаёт тот же `TelegramLoginPayload`, дальше — прежний `connect`.

`Telegram.Login.auth` требует числовой `bot_id` (часть токена до «:») — он публичный (его и так
знает Login Widget). Прокидываем его в статус-DTO.

### Server (Clean Arch)

- `GetTelegramStatus`: в DTO и Deps добавлено `botId: string | null`.
- `index.ts`: `botId: telegramBotToken.split(':')[0] ?? null` в DI `getTelegramStatus`.
- Роут `/me/telegram` уже отдаёт весь DTO (`res.json(status)`) — `botId` доезжает до фронта.

### Client

- `application/telegram/TelegramRepository.ts`: `TelegramStatus.botId: string | null`
  (адаптер `HttpTelegramRepository` — passthrough, правок не нужно).
- `presentation/components/profile/TelegramSection.tsx`:
  - Убран iframe-инжект (`widgetContainerRef`, `data-onauth`, `window.__pfTgAuth`).
  - Эффект грузит `telegram-widget.js` один раз (когда не привязан и есть `botId`).
  - `startTelegramLogin()` → `window.Telegram.Login.auth({ bot_id, request_access:'write' }, cb)`;
    `cb(user)` → `handleTgAuth` (прежняя логика connect + авто-открытие бота на Start).
  - Своя кнопка: Telegram-градиент, белый глиф-самолётик, hover-lift, бегущий блик.

### Анимация (gated)

CSS в `globals.css`: `.pf-tg-login-btn` (градиент) + `::after` бегущий блик
(`@keyframes pf-tg-shine`, ease-in-out, пауза в конце). Hover-lift/масштаб глифа — Tailwind
`transition`. Всё под `html.pf-no-motion` и `prefers-reduced-motion` глушится (блик `opacity:0`).

## Ограничение (вне кода)

И popup, и iframe требуют домен в BotFather (`/setdomain`). На незарегистрированном домене/
localhost логин Telegram не откроется — это конфиг бота, не код. На прод-домене (где виджет
раньше работал) — работает.

## Затронуто

- `server/src/application/telegram/GetTelegramStatus.ts`, `server/src/index.ts`
- `client/src/application/telegram/TelegramRepository.ts`
- `client/src/presentation/components/profile/TelegramSection.tsx`
- `client/src/styles/globals.css`
