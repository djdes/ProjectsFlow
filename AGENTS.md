# Codex project instructions

## Repository workflow

### Обязательная синхронизация с GitHub

- **Всегда в начале работы, перед созданием ветки и перед коммитом/PR/push**
  выполняй `git fetch github --prune`. Если GitHub-remote называется иначе,
  используй его фактическое имя. `origin` может указывать на сервер, а не на GitHub:
  синхронизация только с таким `origin` не выполняет это правило.
- Сравни локальную ветку с актуальной основной веткой GitHub. Новую рабочую ветку
  создавай от свежей `github/main`; перед коммитом и push интегрируй новые изменения
  GitHub через rebase/merge. Примеры с `origin/main` в других документах относятся
  к remote GitHub и должны учитывать его фактическое имя.
- Сохраняй все чужие и незакоммиченные изменения. При грязной или сильно разошедшейся
  рабочей папке используй отдельный worktree от актуального GitHub. Запрещены
  destructive reset, отбрасывание правок и force-push ради синхронизации.
- После проверок обязательно коммить изменения задачи, отправляй feature-ветку
  в GitHub и проверяй, что удалённая ветка содержит коммит. Открывай PR в `main`;
  не пушь напрямую в `main` и не мержи PR без согласия владельца.
- Если fetch, интеграция или push не удались, сообщи конкретную причину.
  Не объявляй репозиторий синхронизированным без проверки.

Read `CLAUDE.md` before changing this repository and follow its project conventions.
It is the shared source for architecture, commands, migrations and deployment rules.

- Keep the existing React/Vite client and Express/MariaDB server stack.
- Implement features from domain and application ports through infrastructure to UI.
  Presentation accesses HTTP repositories through the DI container.
- Reuse the existing UI primitives and design tokens; keep user-facing text in Russian.
- Enforce access on the server as well as in the interface. Cover permission changes
  with meaningful domain/API tests and verify affected UI states.
- Add database migrations as new `db/NNN_*.sql` files; do not rewrite deployed migrations.
- Run relevant tests, typecheck and lint. Distinguish existing failures from regressions.
- After completing the requested work and required checks, always commit and push
  the task changes unless the user explicitly asks otherwise. Preserve unrelated work.
- Production deploys only through pull requests. Never push directly to `main`:
  push to a feature branch (`feat/…`, `fix/…`, `chore/…`) and open a PR into `main`.
  Merge only after the PR checks are green and the repository owner approves.
  Do not run manual deploys (`npm run deploy`, workflow dispatch) unless the owner asks.
- Do not change nginx or commit credentials. Follow the commit/kanban workflow in
  `CLAUDE.md` when a commit is requested; do not move tasks to done without authorization.

## Playwright and interface-reference work

Before any Playwright, Browser MCP, CDP, or visual reference-site work, fully read
`C:\Users\Yaroslav\simplifications\Инструкция работы с playwright для codex.md`
and follow it as the primary procedure for the whole flow.

- Connect to the user's existing Chrome through CDP; do not launch a replacement browser when that Chrome is available.
- Treat reference-site research as a clean-room study of observable behavior only.
- Complete the repository audit and reference capture before production implementation.
- Keep the reference tab open, do not log out, do not inspect secrets or private source code, and do not perform destructive actions.
- Use a separate tab for local ProjectsFlow verification and retain the required reference/actual/diff artifacts.

The latest user message defines `COPY_PROJECT` and `COPY_ZONE`. If it names multiple projects, research only the stated zone in each reference and combine the observed interaction patterns into an original ProjectsFlow implementation.
