# Accessibility audit

## Хорошая семантика

- Preview/Dashboard представлены как radio-like controls с `aria-checked`, поэтому взаимоисключение доступно assistive technology.
- Edit и Canvas используют `aria-pressed`.
- Большинство icon-only действий имеют понятные имена: `Hide chat panel`, `Refresh preview`, device preview,
  `More actions`, `Speech to text`.
- Participants открывается как настоящий `role=dialog`; закрывается `Escape`, внутри есть `Close` и `Invite`.
- Popup-меню закрываются `Escape`.

## Обнаруженные пробелы

- Поле маршрута с placeholder `/page` не имело доступного имени. Требуется `aria-label="Preview route"` или label.
- Кнопка группы участников не имела accessible name. Требуется, например, `aria-label="Project participants"`.
- На mobile не обнаружена доступная кнопка `Hide/Show chat panel`; responsive shell должен давать явный способ
  переключить chat/preview и не полагаться только на fullscreen.
- Некоторые compact icon actions зависят от tooltip. Tooltip не заменяет accessible name.
- В DOM одновременно наблюдались два overlap iframe с одинаковым title `App Preview`. Скрытый frame должен иметь
  `aria-hidden=true`, inert/removed semantics или уникальное имя, иначе screen reader может объявлять дубль.

## Keyboard acceptance criteria для реализации

1. Tab-order идёт слева направо по верхней панели, затем по активной области, без попадания в скрытую панель.
2. `Space`/`Enter` переключают Preview/Dashboard, Edit, Canvas и device.
3. Route combobox поддерживает ArrowUp/ArrowDown, Enter, Escape и сообщает active descendant.
4. Открытый dialog удерживает focus; Escape закрывает; focus возвращается на participants trigger.
5. При скрытии chat его controls получают `inert`/не участвуют в tab-order, но состояние job сохраняется.
6. На `prefers-reduced-motion: reduce` flex transition отключается или сокращается.
7. Toolbar при 200% zoom остаётся достижимым без перекрытия Publish и без горизонтального page scroll.
