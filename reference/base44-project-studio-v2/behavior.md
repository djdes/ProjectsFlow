# Наблюдаемая логика Project Studio

## Компоновка

Studio занимает viewport и не прокручивает документ целиком. Верхняя панель имеет высоту около 52 px. Ниже неё
левая AI-панель и правый workspace являются независимыми областями. В Preview правую область занимает iframe/canvas,
в Dashboard — собственный scroll-контейнер с настройками приложения.

На desktop открытый чат занимает около 360 px. Скрытие не удаляет состояние чата: меняется только доля flex-layout,
а выполняющееся действие и история остаются. Кнопка сразу меняет подпись `Hide chat panel` ↔ `Show chat panel`, затем
ширина плавно меняется. CSS-переход — `flex-grow 500ms cubic-bezier(0.4, 0, 0.2, 1)`; полный визуальный цикл с
подготовительной фазой занимает примерно 1,3 секунды. Освободившееся место полностью получает workspace.

## Preview

- `Preview` и `Dashboard` — взаимоисключающие radio-состояния.
- `Edit mode` — toggle (`aria-pressed`). Он остаётся на том же URL и добавляет `Undo`/`Redo`.
- `Canvas` — отдельный toggle и URL `/editor/canvas`; вместо iframe появляются zoom-controls.
- Поле пути показывает текущую страницу. Dropdown содержит известные маршруты и шаблонные/предлагаемые страницы.
- Кнопка устройства циклически переключает desktop → tablet → mobile → desktop. Desktop заполняет workspace,
  tablet использует 768×1024, mobile — 373×665; уменьшенные canvas центрируются.
- Refresh не исследовался кликом, чтобы не вмешиваться в состояние проекта.
- Publish не нажимался.

## Dashboard

Переход ведёт на `/editor/workspace/overview`. Чат и общий top-level shell сохраняются, но preview-only элементы
(`Edit`, `Canvas`, refresh, route и device) исчезают. В правой части наблюдались секции видимости приложения,
приглашения пользователей и platform badge. Возврат в Preview восстанавливает его toolbar и состояние shell.

Dashboard добавляет собственную левую навигацию внутри правого workspace: `Overview`, `Users`, `Data`, `Analytics`,
`Marketing`, `Domains`, `Integrations`, `Security`, `Code`, `Agents`, `Workflows`, `Logs`, `API`, `Settings` и поиск.
У `Data` и `Marketing` есть disclosure-стрелки, `Workflows` помечен `New`. В clean-room проходе открывался только
`Overview`; остальные пункты зафиксированы как видимая информационная архитектура, но не активировались.

## Меню и диалоги

Dropdown проекта содержит `App overview`, `Users`, `Security`, `App settings`. Меню `More actions` содержит действия
тестирования, GitHub, файлов страницы, мониторинга активности, ZIP-экспорта и справки. Меню закрываются `Escape`.

Клик по группе участников открывает модальный dialog с затемнением/blur и действиями `Close`/`Invite`. Персональные
данные не записывались. Отдельной кнопки перехода в «полный чат» в исследованном состоянии не обнаружено.

## AI-панель

Панель состоит из заголовка проекта, собственного scroll-контейнера истории, suggestions и закреплённого composer.
Composer содержит attachment/add, model/automation mode, discuss, speech-to-text и send. Скролл истории не двигает
toolbar или preview. При скрытии панель не размонтирует проектный контекст.

## Что важно перенести в ProjectsFlow

1. Один владелец состояния shell для Preview и Dashboard, а не две расходящиеся разметки.
2. Независимые scroll owners и отсутствие page-level scroll.
3. Сохранение chat session/job при скрытии панели и переходе Preview ↔ Dashboard.
4. Явная state machine для workspace mode, editor mode и device mode.
5. Адаптивное схлопывание необязательных подписей toolbar до иконок до того, как появится горизонтальный скролл.
6. Route chooser с доступным label и keyboard navigation; у референса label фактически отсутствовал — это не нужно
   копировать как дефект.
