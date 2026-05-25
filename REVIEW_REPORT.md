# Review fixes — safe subset (2026-05-25)

Из полного ревью бэка/фронта/MCP оставили только **внутренние atomic'и +
rate-limiters + redaction логов**. Всё, что меняет наблюдаемое поведение
(permissions, валидации, side-effects на disconnect и т.д.), вынесено
в "Deferred" для отдельного обсуждения.

## Что в этом PR

13 файлов, +151/-29. Никаких поведенческих изменений для существующих юзеров.

### Atomicity / orphan-prevention

- **`createWithOwnerMembership(input)`** на `ProjectRepository` —
  атомарно создаёт проект и owner-membership в одной TX. Старый код делал
  `repo.create` + `members.add` последовательно: крэш между ними оставлял
  orphan-проект, который никто (даже создатель) не мог открыть через
  `requireProjectAccess`. Использован в `CreateProject` + `GetOrCreateInbox`.
- **`DrizzleGithubTokenRepository.upsert`** — `INSERT … ON DUPLICATE KEY UPDATE`
  вместо `DELETE → INSERT`. Атомарно на стороне MySQL. Раньше крэш между двумя
  запросами wipe'ал юзеру GitHub-токен без замены.

### Rate-limiters (anti-brute-force, anti-DoS)

- **`/api/auth/login`** — 10 попыток на `(IP, email)` за 10 минут.
  Не защищает от distributed brute-force, но осложняет single-host enum.
- **`/api/agent/device/approve`** — 5 попыток на `(user, IP)` в минуту.
  User-code 8 chars × 28-char alphabet ≈ 38 бит — brute-force без лимита
  тривиален и даёт session-fixation на чужой MCP-pairing.
- **`/api/agent/device/authorize`** — 30 запросов/IP в минуту.
  Anonymous endpoint, держит pending-pairing'и 10 минут в Map'е без size-cap'а.

Все три используют существующий `InMemoryRateLimiter` (тот же, что для
`/agent/repo-usage` / `/agent/repo-access-requests`).

### Refuse-to-boot в prod без HMAC-secret

- **`server/src/index.ts`** — если `NODE_ENV=production` и не задан ни
  `REPO_ACCESS_HMAC_SECRET`, ни `SECRETS_MASTER_KEY` — процесс падает на старте
  с понятной ошибкой вместо тихого fallback'а на захардкоженный
  `'dev-repo-access-secret'` (виден в репо). В dev fallback сохранён.

### Log redaction + best-effort cleanup

- **`sessionFromCookie`** теперь логирует только `e.message`, не весь error.
  Раньше malformed cookie мог триггерить mysql2-error со схемой/quotes в логе.
- **`RevokeAgentToken.clearDispatcherForUser`** обёрнуто в try/catch.
  Раньше падение второй операции отдавало 500, хотя token уже revoked.
  Теперь token revoke = user-facing успех, dispatcher cleanup = best-effort
  с логом (TODO в комменте: cron-задача "снимать диспетчеров без active tokens").

### Frontend

- **`NotificationsPage`** диспатчит `NOTIFICATIONS_CHANGED_EVENT` после
  `markRead` / `markAllRead`. Sidebar-bage обновляется мгновенно вместо
  ≤60-секундного polling'а.

### Cleanup

- **`errorHandler.ts`** — удалён dead-code (`invite_email_mismatch` entry +
  import). Этот entry попал в HEAD из частичного мерджа и не имел thrower'а
  после реверта invite-email-check.
- **`http.ts`** — убран `rateLimiter:` из `projectsRouter` deps. Тоже
  частичный остаток мерджа (router его не принимает в Deps).

## Что отложили (Deferred — нужно отдельное решение)

Все эти находки реальны, но фикс меняет поведение, которое уже видят юзеры,
и риск сломать прод выше, чем смягчает security risk в краткосрочке.

### Behavior-changing security findings

1. **CRITICAL: viewer может стать dispatcher'ом и получить owner'ский GitHub PAT.**
   Цепочка из 4 запросов от viewer-membership до plaintext OAuth-токена со
   scope `repo`. Фикс: `set_project_dispatcher: 'viewer' → 'owner'` в
   `domain/project/permissions.ts:59`. **Почему отложили:** меняет UX в
   `DispatcherSection` (viewer больше не видит кнопки). Нужно отдельно
   обсудить новый UX (показывать только текущего диспетчера и кнопку
   "Запросить смену" → notify owner'у?).

2. **HIGH: invite accept не сверяет email.** Любой, кто перехватит URL,
   присоединяется в проект. Фикс: сверять `invite.email` с `user.email`.
   **Почему отложили:** ломает существующие инвайты, выданные на email A,
   но принимаемые юзером, который залогинен под email B. Нужно решить —
   считаем это feature (forward invite другу) или bug.

3. **HIGH: KB path traversal (`..` сегменты).** Регэкс `^[a-z0-9_./-]+\.md$`
   пропускает `../../etc/passwd.md`. GitHub Contents API обычно отбивает,
   но defense-in-depth fail. **Почему отложили:** если где-то есть legitimate
   KB-документы с `..` в пути (маловероятно, но возможно после миграций),
   refine их отвергнет.

4. **HIGH: gitRepoUrl scheme validation.** Сейчас можно сохранить
   `javascript:fetch(...)` — рендерится в admin-панели как `<a href>` и
   admin кликает. **Почему отложили:** narrowing разрешённых схем
   (`http`, `https`, `git`, `ssh`, `git+ssh`) может отвергнуть существующие
   URL'ы (например, с redmine, gitlab-self-hosted с нестандартной схемой).
   Лучше — sanitize на рендере (block `javascript:` / `data:` на стороне
   `<a>`), но это тоже отдельный change.

5. **MEDIUM: DisconnectGithub не сбрасывает delegation enabled=false.**
   Reconnect с другим GH-аккаунтом → старый consent применяется к новому
   токену. **Почему отложили:** silent side-effect на existing-flow disconnect/
   reconnect. Юзер может ожидать что delegation сохранится при смене email
   GitHub-аккаунта.

6. **MEDIUM: CheckGitCollision раскрывает project name.** Logged-in юзер
   может маппить public GitHub-репо на внутренние project names. **Почему
   отложили:** UI зависит от name'а ("этот репо уже используется в проекте
   X — запросить вступление?"). Без name'а UX становится менее информативным
   ("в каком-то проекте"). Нужно UX-решение.

7. **MEDIUM: join-requests rate-limit (1/час/pair, 10/час/user).**
   **Почему отложили:** 1/час может быть слишком жёстко — иногда первый
   запрос затерялся, юзер хочет повторить. Нужно обсудить лимиты или ввести
   "у тебя уже есть pending request на этот проект" вместо 429.

### Encryption at rest, GitHub Apps, /api/agent/me leak

Не пытался фиксить — это полноценные отдельные эпики:

- Secrets и `user_github_tokens.access_token` лежат plaintext. Envelope
  encryption через `SECRETS_MASTER_KEY` (env уже упомянут в CLAUDE.md, но
  нигде не используется). Нужна миграция, fallback-логика.
- `GET /api/agent/me` возвращает full GitHub OAuth token любому agent-token'у.
  Должен ходить через per-project `/git-token` endpoint. Нужно
  убедиться, что MCP-клиент это переживает (он сейчас может полагаться на
  это поле для repo discovery).
- GitHub Apps вместо user-OAuth — repo-scoped и short-lived. Большая миграция.

### Correctness bugs из ревью (отдельные тикеты)

- TransferProjectOwnership не обновляет `projects.ownerId` (рассинхрон с
  `project_members.role`). Фикс меняет поведение — после transfer KB-write
  начнёт использовать токен нового owner'а; если у него нет connected GitHub,
  KB-flow сломается там, где раньше работал. Отдельный эпик "ownership transfer
  hardening" — переключение использований `project.ownerId` на membership.
- EnqueueAgentJob TOCTOU — два параллельных enqueue для одной task создают
  два active-job'а. Нужен unique-индекс.
- DeleteTask не TX + не чистит attachments/commits. Inline-комментарий это
  признаёт. Накапливаются orphan-rows + файлы на диске.
- AcceptProjectInvite не TX (member.add + invite.markAccepted).
- RemoveProjectMember не сбрасывает dispatcher / delegation удалённого.
- MoveTask: float midpoint без rebalance — после ~52 drag-drop'ов между
  одной парой соседей коллапсирует precision.
- Comment author в TaskDialog показывает текущего юзера для ВСЕХ комментариев
  ("single-tenant TODO"). Active bug в multi-tenant.
- ConnectGithubDialog stale poll-result race.
- KbDocumentViewer показывает stale doc при переключении.
- MCP findings: `pf_create_project.git` не `.strict()`, Windows ACL,
  config env precedence, `readFileSync` без try/catch.

## Verification

- `tsc --noEmit` server/client/mcp ✅
- `eslint` client ✅
- `tsc -p` server build ✅
- `vite build` client ✅

Браузером не тестировал. Сценарии для проверки перед merge:

- логин (rate-limiter не должен мешать нормальной попытке)
- создание проекта (atomic — должно работать как раньше)
- GitHub disconnect/connect (без побочных эффектов)
- mark notification as read (badge в sidebar должен обновляться сразу)
- revoke agent-token (даже если cleanup упадёт, UI получает 200/204)

## Что НЕ деплоить / следить

- В production обязательно задать `REPO_ACCESS_HMAC_SECRET` или
  `SECRETS_MASTER_KEY` в env, иначе процесс не стартует. В dev fallback есть.
- Login rate-limit может cap'нуть legitimate юзера если он 10 раз подряд
  ошибся паролем за 10 минут. Окно small enough, но за этим стоит смотреть
  логи первое время.
