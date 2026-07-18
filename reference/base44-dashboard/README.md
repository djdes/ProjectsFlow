# Base44 Dashboard — clean-room audit

Дата наблюдения: 18 июля 2026 года. Исследование выполнено через доступный пользователю интерфейс в отдельном Chrome-профиле Playwright. Данные, роли, настройки и публикация не изменялись.

Изучены Overview, Users, Data, Analytics, Marketing, Domains, Integrations, Security, Code, Agents, Workflows, Logs, API и Settings, включая адаптивный Overview.

Главный вывод: для ProjectsFlow особенно ценна связка `Preview + Data + Logs + Users`. Это превращает результат воркера из внешней ссылки в управляемое приложение. Копировать весь Base44 не нужно: маркетинг, кредиты, code editor, агентный конструктор и upsell-экраны не решают текущую задачу ProjectsFlow.

## Артефакты

- `behavior.md` — логика разделов;
- `geometry.json` — размеры и адаптивность;
- `scroll-map.json` — области прокрутки;
- `state-machine.json` — состояния Dashboard/Data;
- `scenarios.json` — основные сценарии;
- `accessibility.md` — наблюдения по доступности;
- `repository-audit.md` — сопоставление с текущим кодом ProjectsFlow;
- `screenshots/` и `actual/` — фактические состояния с удалёнными секретами.
