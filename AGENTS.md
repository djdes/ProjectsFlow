# Codex project instructions

## Repository workflow

Read `CLAUDE.md` before changing this repository and follow its project conventions.
It is the shared source for architecture, commands, migrations and deployment rules.

- Always start work by running `git fetch origin --prune` and updating local branches and
  commits against `origin/main` (`git checkout main && git pull --ff-only origin main`,
  create feature branches off fresh `origin/main`, and rebase/merge `origin/main` into active
  feature branches before committing or pushing so branches never lag behind remote).
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


## Работа с Git: обязательный `git fetch` и актуализация коммитов и веток

- **Перед началом любой работы в git-репозитории (и в начале сессии):** обязательно выполняй `git fetch --all --prune`, проверяй статус веток и свежие коммиты (`git status -sb`, `git branch -vv`, `git log --oneline -n 5 HEAD..origin/main` или `origin/master`) и актуализируй локальную ветку (`git pull --rebase --autostash`), чтобы никогда не работать поверх устаревшей ревизии и не создавать конфликтов с удалёнными коммитами и CI/CD.
- **Новые ветки** создавай только от актуального состояния `origin/main` (`origin/master`).
