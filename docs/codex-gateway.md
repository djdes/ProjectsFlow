# Codex-шлюз: текст и картинки по подписке для любых проектов

Любой проект (сайт, бот, скрипт, ИИ-агент в другом репозитории) может отдать ProjectsFlow
задачу «упрости текст», «напиши пост», «сократи», «переведи» или «нарисуй картинку». Исполняет
её диспетчер Ralph локальным `codex exec` по подписке ChatGPT — без платных API-ключей OpenAI.

```
проект ──POST──▶ projectsflow.ru (очередь) ◀──claim/complete── Ralph (codex exec, подписка)
   ▲                                                                   │
   └──────────── GET …?wait=25 (long-poll) ◀──── результат ────────────┘
```

## Доступ

- **Адрес:** `https://projectsflow.ru/api`
- **Авторизация:** `Authorization: Bearer <токен агента>` со scope `account`
  (Профиль → «Доступ для агентов» → «Создать токен»). Проектный токен получит 403.
- ⚠ Account-токен видит credentials всех проектов своего аккаунта. Для чужих проектов
  заводите отдельный служебный аккаунт без проектов и выдавайте его токен — тогда утечка
  токена из `.env` проекта ничего, кроме шлюза, не открывает.
- В проекте храните как `CODEX_GATEWAY_URL` / `CODEX_GATEWAY_TOKEN` в `.env`, не в коде.

## Текст — `/api/ai/text-jobs`

```http
POST /api/ai/text-jobs
Content-Type: application/json

{ "instructions": "Перепиши проще, до 600 символов, для владельца ресторана",
  "input": "Исходный текст…" }
```

| Поле | Обязательно | Лимит | Смысл |
|---|---|---|---|
| `input` | да | 1..100 000 символов | текст для обработки; без `instructions` — сам запрос («Напиши пост про …») |
| `instructions` | нет | до 20 000 символов | что сделать с `input` |

Ответ `202 { id, status: "queued", createdAt }`.

```http
GET /api/ai/text-jobs/{id}?wait=25      # ждёт до wait секунд (0..60)
```

Всегда `200 { id, status, text, error, createdAt, finishedAt }`. `status`: `queued` → `running` →
`succeeded` (в `text` готовый результат) | `failed` | `cancelled` (`error` — причина).
Повторяйте GET, пока статус не станет терминальным; обычно ответ готов за 10–40 секунд.

Модель отвечает только итоговым текстом — без «Конечно, вот ваш пост:» и без обёртки в
code block, если инструкция сама не просит код. Нужен JSON — опишите формат в `instructions`
и разберите `text` у себя.

**Лимиты и сбои:** 300 задач в час на аккаунт (`429`). Если диспетчер не запущен, задача ждёт
и через 15 минут получает `cancelled` (`dispatcher_timeout`) — ставьте свой таймаут клиента
(рекомендуется 5 минут) и не держите пользователя в ожидании дольше.

| Код | Причина |
|---|---|
| 400 | неверное тело (пустой `input`, лишние поля, превышен лимит) |
| 401 / 403 | нет токена / токен не account-scope |
| 404 | задачи нет или она чужая |
| 429 | лимит 300 в час |
| 503 | на сервере не настроен диспетчер по умолчанию |

## Картинки — `/api/ai/image-jobs`

```http
POST /api/ai/image-jobs            multipart/form-data: prompt (≤8000), width, height (256..4096),
                                   images[] — до 8 референсов PNG/JPEG по 6 МБ
GET  /api/ai/image-jobs/{id}       { id, status, error, imageUrl }
GET  /api/ai/image-jobs/{id}/image PNG, когда status = succeeded
GET  /api/ai/image-jobs/quota      { active, remaining, releaseAfterSeconds[] }
```

Лимит: две генерации одновременно и двадцать за скользящие сутки на аккаунт.

## Примеры

**curl**

```bash
ID=$(curl -s -X POST "$CODEX_GATEWAY_URL/ai/text-jobs" \
  -H "Authorization: Bearer $CODEX_GATEWAY_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructions":"Упрости","input":"Сложный текст"}' | jq -r .id)
curl -s "$CODEX_GATEWAY_URL/ai/text-jobs/$ID?wait=60" -H "Authorization: Bearer $CODEX_GATEWAY_TOKEN"
```

**TypeScript (Node 18+)**

```ts
export async function codexText(input: string, instructions?: string, timeoutMs = 300_000): Promise<string> {
  const base = process.env.CODEX_GATEWAY_URL ?? 'https://projectsflow.ru/api';
  const headers = { Authorization: `Bearer ${process.env.CODEX_GATEWAY_TOKEN}`, 'Content-Type': 'application/json' };
  const created = await fetch(`${base}/ai/text-jobs`, { method: 'POST', headers, body: JSON.stringify({ input, instructions }) });
  if (created.status !== 202) throw new Error(`codex-gateway: POST ${created.status} ${await created.text()}`);
  const { id } = await created.json() as { id: string };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/ai/text-jobs/${id}?wait=55`, { headers });
    if (!res.ok) throw new Error(`codex-gateway: GET ${res.status}`);
    const job = await res.json() as { status: string; text: string | null; error: string | null };
    if (job.status === 'succeeded' && job.text) return job.text;
    if (job.status === 'failed' || job.status === 'cancelled') throw new Error(`codex-gateway: ${job.status} ${job.error}`);
  }
  throw new Error(`codex-gateway: timeout, job ${id}`);
}
```

## Как устроено внутри

- Очередь — таблица `ai_prompt_jobs`, `mode = 'text'` (db/180), `input_text` — JSON-конверт
  `{ v: 1, instructions, input }`. Маршрут — [server/src/presentation/ai-text/routes.ts](../server/src/presentation/ai-text/routes.ts).
- Диспетчер по умолчанию (`AI_PROMPT_DEFAULT_DISPATCHER_EMAIL`) — аккаунт Ralph. Ralph берёт
  все не-`assistant` job'ы и запускает `ai-job-worker.ps1` на каждую задачу; ветка `Do-Text`
  разбирает конверт и вызывает `Invoke-PfLlmText` (`llm-client.psm1` → локальный `codex exec`,
  модель и effort — из `config.local.json` Ralph). Сервер такие job'ы сам не исполняет.
- Зависшие text-job'ы снимает `AiPromptJobCleanup` через 15 минут, завершённые хранятся 7 дней.
