# Telegram-группы с проектами и конвейер «оркестратор → исполнитель → ревьюер»

Дата: 2026-11-17
Статус: черновик на утверждение владельцем
Связано: `2026-11-12-telegram-work-groups-design.md` (рабочие группы — уже в main),
репозиторий `djdes/CSharpFixer` (источник идей конвейера), Ralph (`C:/www/ralph`).

## Задача (от владельца)

1. Объединить CSharpFixer с основным воркером PF (Ralph): отдельный процесс, отдельный проект
   и переменные `CSHARP_FIXER_*` не нужны.
2. В пространстве — Telegram-группы. Бота пригласили в группу → группа сама появляется в
   пространстве черновиком. Для группы выбираются доступные проекты (в любой момент добавить
   или убрать). На `@ProjectsFlow_Bot` бот понимает, в какой он группе и какие проекты ей
   доступны.
3. Бот видит участников группы; у кого есть аккаунт PF — синхронизируются с пространством и
   группой.
4. Из CSharpFixer взять схему «оркестратор + исполнитель + ревьюер» для всех проектов.
5. Понятно и надёжно показывать в PF, что делают оркестратор, исполнитель и ревьюер.

## Что уже есть (не переделываем)

- Рабочие группы `workspace_telegram_groups` (db/181): подключение по `startgroup=wg_<code>`
  только администратором группы, `/id`, приветствие при ручном добавлении, перенос при
  миграции в супергруппу, онбординг людей без аккаунта (`telegram_group_onboardings`).
- Гейт упоминания бота, создание задач «как отправитель», «Входящие» владельца группы.
- CSharpFixer-маршрут в `TelegramComposerService` по `CSHARP_FIXER_CHAT_ID` с HMAC-подписью
  источника и ответом reply в исходный топик.

## 1. Группа появляется черновиком

- Событие `my_chat_member` (бот стал `member`/`administrator`) или `new_chat_members` с ботом
  в группе, которая ещё не рабочая → создаём `workspace_telegram_groups` со статусом `draft`.
- Пространство для черновика: пространство пригласившего (`from` события), если его Telegram
  привязан и он руководитель/владелец ровно одного командного пространства; иначе — бот в
  группе отвечает кнопкой выбора пространства (личка, только пригласившему). Пригласивший
  без привязки → черновик не создаётся, бот пишет id и ссылку на подключение (как сейчас).
- **Черновик ничего не открывает:** задачи из группы не принимаются, люди не добавляются.
  В настройках пространства карточка «Новая группа «…» ждёт подтверждения» → «Подключить» /
  «Отклонить». Подтверждает владелец/руководитель пространства. Причина: иначе любой, кто
  добавит бота в свою группу, получит вход в чужое пространство.
- Существующий путь `startgroup=wg_<code>` сразу создаёт `active` (код уже выдан руководителем).
- Бот удалён из группы (`my_chat_member` → `left`/`kicked`) → `status='disconnected'`,
  открытые онбординги отменяются (как при отключении сейчас).

Миграция:

```sql
ALTER TABLE workspace_telegram_groups
  ADD COLUMN status ENUM('draft','active','disconnected') NOT NULL DEFAULT 'active',
  ADD COLUMN mode ENUM('standard','incident') NOT NULL DEFAULT 'standard',
  ADD COLUMN invited_by_tg_user_id BIGINT NULL;
```

`TELEGRAM_ALLOWED_UPDATES` дополняется `my_chat_member` и `chat_member`.

## 2. Проекты группы

```sql
CREATE TABLE telegram_group_projects (
  tg_chat_id  BIGINT   NOT NULL,
  project_id  CHAR(36) NOT NULL,
  added_by_user_id CHAR(36) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id, project_id),
  CONSTRAINT fk_tgp_group FOREIGN KEY (tg_chat_id)
    REFERENCES workspace_telegram_groups (tg_chat_id) ON DELETE CASCADE,
  CONSTRAINT fk_tgp_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
```

- Проект можно выбрать только из пространства группы. Перенос проекта в другое пространство
  удаляет связь.
- UI: в карточке рабочей группы — мультивыбор проектов (чипы + «Добавить проект»), сохраняется
  сразу, без отдельной кнопки.
- Пустой список = как сейчас (все проекты пространства) — обратная совместимость с группами,
  подключёнными до этой фичи.
- На `@ProjectsFlow_Bot` композер получает `allowedProjectIds` группы:
  - `projectMention` / `fuzzyMatch` / AI-выбор проекта ищут только среди них;
  - один проект в списке → выбирается без вопросов;
  - явно назван проект вне списка → «В этой группе доступны: A, B». Задача не создаётся
    в чужом проекте.
- Определение проекта по жалобе — перенос идеи `catalog.json` CSharpFixer: у проекта поле
  `aliases` (привычные названия, «в конфиге», «в планере») и `description`; ИИ-выбор получает
  их в промпте. Read-only решение «цель исправления vs образец „сделай как в …“» — как в
  CSharpFixer.

## 3. Режим группы `incident` (замена CSharpFixer-чата)

`mode='incident'` — то, что сейчас делает чат `CSHARP_FIXER_CHAT_ID`, но настройкой группы:

- писать может любой участник группы, аккаунт PF не нужен; задача создаётся от владельца
  привязки группы (`added_by_user_id`), реальный автор сохраняется в подписанном источнике;
- задача идёт в выбранный из `allowedProjectIds` проект, `ralphMode='silent'`, сначала
  `backlog`, `todo` — только после сохранения вложений (как сейчас);
- результат — reply на исходное сообщение в том же топике, простым языком, без ссылок на Git;
- подпись HMAC остаётся. Ключ — общий секрет сервер ↔ Ralph (`TELEGRAM_ORIGIN_SIGNING_KEY`),
  а `chatId`/`projectId` берутся из группы, а не из env.

Переход: группа из `CSHARP_FIXER_CHAT_ID` становится рабочей группой YesBeat с
`mode='incident'` и списком C#-проектов; затем env-переменные и `csharpFixerIntake`-ветки
удаляются, `csharp-fixer-origin` маркер читается ещё один релиз для старых задач.

## 4. Участники группы

Ограничение Telegram: бот **не может получить полный список участников**. Доступно:
`getChatAdministrators`, `getChatMemberCount`, события `chat_member` (только если бот —
администратор группы) и авторы сообщений.

```sql
CREATE TABLE telegram_group_members (
  tg_chat_id  BIGINT NOT NULL,
  tg_user_id  BIGINT NOT NULL,
  status      ENUM('member','admin','left') NOT NULL,
  source      ENUM('admins','join','message') NOT NULL,
  seen_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id, tg_user_id)
);
```

- При активации группы — снимок администраторов; дальше — `chat_member` и каждый автор
  сообщения обновляют запись.
- Участник с привязанным Telegram и аккаунтом PF:
  - уже в пространстве → ничего;
  - удалён руководителем (`workspace_member_removals`) → не возвращается;
  - иначе — по настройке группы `autoJoin`: `off` — как сейчас, кнопка «Вступить» при первом
    сообщении; `on` — добавляется редактором автоматически с уведомлением руководителю.
    По умолчанию `off` (решение владельца — открытый вопрос, см. ниже).
- Вышел из группы (`chat_member` → `left`) → запись `left`; из пространства **не** удаляем.
- В карточке группы: «Участники: N в Telegram, M связаны с PF» + список связанных.

## 5. Конвейер Ralph: оркестратор → исполнитель → ревьюер

Из CSharpFixer в Ralph переносится оркестрация, Codex остаётся тем же (`gpt-6.1-sol`, `low`).

**Оркестратор** — код Ralph (`dispatch.ps1`), не модель. Он:
1. сохраняет состояние попытки до побочных эффектов (журнал на диске, как `JobStore`);
2. готовит checkout (существующие preflight / workspace-guard);
3. запускает **исполнителя** — `codex exec` в проекте (как сейчас), но без права push:
   публикацию делает оркестратор;
4. сам выполняет `checks` проекта (сборка/тесты) — ненулевой код → замечания исполнителю;
5. запускает **ревьюера** — новая read-only сессия Codex: исходный запрос, diff, журналы
   проверок; ответ по JSON Schema `{approved, summary, findings[]}`;
6. не одобрено → замечания исполнителю, повтор 3–5, до `maxReviewAttempts` (3);
7. исчерпано → **эскалация**: тот же исполнитель с `reasoningEffort=medium` продолжает
   сохранённые изменения со всей историей замечаний, до `maxEscalationReviewAttempts` (3);
   ревьюер остаётся `low`;
8. одобрение привязано к Git tree; изменение дерева после ревью (в т.ч. hooks) блокирует push;
9. commit + push → `delivery` → `healthChecks` (если заданы) → `done`/`pending_approval`;
10. ничего не получилось → задача остаётся у ответственного с журналом, без «готово».

Настройки проекта (новый блок в `projects-map.json`, позже — в настройках проекта PF):

```json
"pipeline": {
  "review": true,
  "checks":       [{ "name": "build", "command": ["dotnet","build","-c","Release"], "timeoutSeconds": 600 }],
  "delivery":     [],
  "healthChecks": [],
  "maxReviewAttempts": 3,
  "maxEscalationReviewAttempts": 3
}
```

Без блока `pipeline` проект работает как сейчас (исполнитель сам собирает и пушит). Включение —
по проекту, первым — C#-проекты из каталога CSharpFixer, затем остальные.

## 6. Контракт live-ленты для ролей

Без миграций: `kind` и `payload` событий уже свободные.

- Сессия конвейера: `agentName='ralph-orchestrator'`. Одна сессия на попытку; старые сессии
  `ralph-worker` рендерятся как раньше (всё — исполнитель).
- Каждое событие несёт `payload.actor: 'orchestrator' | 'executor' | 'reviewer'`
  (нет поля → `executor`) и опционально `payload.round` (номер цикла исправления, с 1) и
  `payload.escalated: true` (исполнитель `medium`). Для `assistant_text` — `text` как сейчас,
  `payload = {actor, round}`.
- Новые виды:

| kind | payload |
| --- | --- |
| `stage` | `{actor:'orchestrator', stage, status, title?, detail?, round?}`; `stage`: `prepare` `execute` `checks` `review` `publish` `deliver` `health` `done` `blocked`; `status`: `started` `passed` `failed` `skipped` |
| `check_result` | `{actor:'orchestrator', phase:'checks'\|'delivery'\|'health', name, command:string[], exitCode, durationMs, outputTail?}` |
| `review_verdict` | `{actor:'reviewer', round, approved, summary, findings:[{severity:'blocker'\|'major'\|'minor', file?, line?, text}]}` |
| `handoff` | `{actor:'orchestrator', from, to, reason, round, escalated?}` — замечания переданы исполнителю, эскалация |

UI (`LiveTab`): шкала этапов сверху по `stage`; реплики ролей — разные аватары/цвета;
шум инструментов исполнителя свёрнут в «журнал раунда N»; вердикт ревьюера — карточка с
замечаниями; проверки — компактные карточки с кодом выхода и хвостом вывода по клику.
Неизвестные `kind`/`actor` не ломают ленту.

## Порядок реализации

1. UI ролей в `LiveTab` на фикстурах + исправление багов ленты (не зависит от остального).
2. Ralph: `pipeline` для одного проекта (C#Config), события по контракту §6.
3. Группы: `draft`, `telegram_group_projects`, выбор проекта из списка.
4. `mode='incident'`, перенос чата CSharpFixer, удаление `CSHARP_FIXER_*`.
5. Участники: `chat_member`, снимок админов, `autoJoin`.
6. Остановка процесса CSharpFixer, архив репозитория.

## Открытые вопросы владельцу

1. `autoJoin`: связанных с PF участников группы добавлять молча или кнопкой «Вступить»?
2. Черновик группы подтверждает только владелец пространства или и руководители?
3. Включать ли `review` по умолчанию для всех проектов после пилота (дороже по токенам ×2–3)?
