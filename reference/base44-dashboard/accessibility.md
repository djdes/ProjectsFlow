# Доступность Dashboard

## Хорошо

- desktop navigation has text labels in addition to icons;
- mobile uses a large section selector instead of squeezing the sidebar;
- forms have visible labels;
- active section and tabs are visually distinct;
- Data filters and row editor use predictable panels.

## Риски

- wide Data tables require horizontal scrolling;
- icon-only controls rely on tooltip/aria labels;
- row editing in an overlay needs focus trapping and focus return;
- dense permissions matrices need keyboard cell navigation;
- empty/disabled plan states can be confused with unavailable data;
- logs and API snippets can expose secrets if masking is not enforced.

ProjectsFlow should provide keyboard grid navigation, visible focus, sticky first column, responsive card fallback on narrow screens, confirmation for destructive row operations and automatic secret masking.
