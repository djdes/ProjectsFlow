# Codex project instructions

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
