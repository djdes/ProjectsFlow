# @projectsflow/app-client

Тонкий клиент к **App Runtime** приложения ProjectsFlow — вход/регистрация конечных
пользователей приложения и CRUD по таблицам объявленной схемы. Чистый ESM без зависимостей,
работает в браузере без шага сборки: воркер встраивает `index.js` в сгенерированный
статический сайт как есть.

## Модель

- Каждый проект с включённым бэкендом = отдельный SQLite-файл на нашем сервере (квота 100 МБ).
- Фронт приложения обслуживается со своего поддомена `<slug>.projectsflow.ru` и ходит в тот же
  origin (`/api/*`), поэтому `baseUrl` по умолчанию пустой.
- Авторизация конечного пользователя — серверная сессия: после `signIn` клиент хранит токен
  (в `localStorage`) и шлёт его как `Authorization: Bearer <token>`.
- Доступ к данным определяется правилами таблицы (`anyone` / `authenticated` / `owner`),
  заданными в схеме приложения. `owner`-строки автоматически привязываются к `owner_id`.

## Использование

```js
import { createClient } from './app-client/index.js';

const pf = createClient(); // same-origin

// авторизация
await pf.auth.signUp('user@example.com', 'секрет');
const me = await pf.auth.signIn('user@example.com', 'секрет');
const current = await pf.auth.user(); // { id, email } | null
await pf.auth.signOut();

// данные (таблица 'posts' из схемы приложения)
const posts = await pf.from('posts').select({
  filter: { owner_id: me.id },
  sort: 'created_at',
  dir: 'desc',
  limit: 20,
});
const created = await pf.from('posts').insert({ title: 'Привет' });
await pf.from('posts').update(created.id, { title: 'Правка' });
await pf.from('posts').delete(created.id);
```

## Ошибки

Любой не-2xx ответ бросает `AppClientError` с полями `status` (HTTP) и `code`:
`user_exists` (409), `auth_failed` (401), `access_denied` (403), `storage_full` (413),
`bad_request` (400), `not_provisioned` (404).

## Тесты

```bash
node --test packages/app-client/index.test.mjs
```
