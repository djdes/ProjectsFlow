# Codex project instructions

## Repository workflow

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
