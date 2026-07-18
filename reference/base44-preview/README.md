# Base44 Preview — clean-room audit

Дата наблюдения: 18 июля 2026 года. Источник изучен только через доступный пользователю интерфейс в отдельном Chrome-профиле Playwright. Настройки и данные приложения не изменялись.

## Что изучено

- верхняя панель Preview/Dashboard;
- выбор маршрута результата;
- обновление превью;
- desktop/tablet/mobile размеры;
- Canvas;
- Edit mode;
- выбор DOM-элемента с синей рамкой, element toolbar и быстрыми правками;
- меню дополнительных действий;
- Publish dialog.

Главный вывод: это не поле для произвольной внешней ссылки. Поле `Home` управляет маршрутом внутри результата: `/`, `/catalog`, `/checkout`; динамический `/product/:slug` показывается как маршрут, требующий параметр. Повторная проверка Edit mode подтвердила реальный DOM-inspector: hover/select, tag label, рамку, floating toolbar, AI regeneration, prompt для выбранного элемента, theme/custom colors, element actions и code/source actions.

Для ProjectsFlow переносится вся самостоятельная clean-room модель: встроенный результат, безопасный выбор пути, адаптивные размеры, перезагрузка, DOM-inspector, локальные патчи с undo/redo, точечные AI-задачи, code inspector и Canvas-карта страниц.

Секреты из iframe URL и API-фрагментов удалены из артефактов. Скриншоты API маскированы.

## Артефакты

- `behavior.md` — наблюдаемая логика;
- `geometry.json` — размеры и компоновка;
- `scroll-map.json` — области прокрутки;
- `state-machine.json` — состояния окна;
- `scenarios.json` — воспроизводимые сценарии;
- `accessibility.md` — доступность;
- `repository-audit.md` — сопоставление с ProjectsFlow;
- `screenshots/` — фактические состояния;
- `actual/` — очищенные снимки DOM/контролов.
