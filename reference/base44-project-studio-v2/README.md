# Base44 project Studio — clean-room reference v2

Наблюдаемая зона: editor shell проекта в режимах Preview и Dashboard — левая AI-панель,
верхняя панель инструментов, route/device controls, сворачивание чата и переходы между
режимами. Исследование выполнено через Playwright, подключённый к уже открытому Chrome
по CDP. Проект Base44 не изменялся и не публиковался.

Персональные сообщения, аватары и логотип проекта на сохранённых изображениях
маскируются. Приватные API, cookies, токены и исходный код референса не исследовались.

Состав:

- `repository-audit.md` — аудит существующей архитектуры ProjectsFlow;
- `behavior.md` — наблюдаемая логика;
- `geometry.json` — измерения shell в нескольких состояниях и viewport;
- `scroll-map.json` — владельцы прокрутки;
- `state-machine.json` — состояния и переходы;
- `scenarios.json` — воспроизводимые сценарии;
- `accessibility.md` — семантика и keyboard-аудит;
- `actual/` — безопасные DOM/accessibility snapshots;
- `screenshots/` — desktop/tablet/mobile reference captures.
